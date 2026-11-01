import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { getEnvironmentCatalog } from './environments-service.js';
import { getNodes } from './catalog-service.js';
import { loadConfig } from './config.js';
import { ensureWfLib, wfTsconfigPath, wfLibDir } from './wf-lib.js';

// 与 index.ts 的 HOST/PORT 保持一致（测试可用 WORKFISH_RUN_BASE_URL 覆盖）
const RUN_BASE_URL =
  process.env.WORKFISH_RUN_BASE_URL ?? 'http://127.0.0.1:8787';
const RESULT_MARK = '__WORKFISH_RESULT__';
const RUN_TTL_MS = 10 * 60 * 1000;
const INPUT_WAIT_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 20;
const MAX_EVENTS = 2000;

/** Node 入口由 tsx 负责加载（支持 index.ts / index.js），payload 走临时 JSON 文件 */
const NODE_RUNNER = `import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const MARK = '${RESULT_MARK}';
const entry = process.argv[2];
const payloadPath = process.argv[3];
try {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
  const mod = await import(pathToFileURL(entry).href);
  const run = mod.run ?? mod.default?.run;
  if (typeof run !== 'function') {
    throw new Error('入口模块未导出 run 函数');
  }
  const result = await run(payload.inputs ?? {});
  process.stdout.write(MARK + JSON.stringify(result ?? null) + '\\n');
} catch (e) {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
}
`;

/** Python 入口由 importlib 加载 main.py，run 可为 async 或同步函数 */
const PYTHON_RUNNER = `import asyncio
import importlib.util
import json
import os
import sys
import traceback

MARK = '${RESULT_MARK}'
entry = sys.argv[1]
payload_path = sys.argv[2]

try:
    with open(payload_path, encoding='utf-8') as f:
        payload = json.load(f)
    sys.path.insert(0, os.path.dirname(os.path.abspath(entry)))
    spec = importlib.util.spec_from_file_location('workfish_node_entry', entry)
    if spec is None or spec.loader is None:
        raise RuntimeError('无法加载入口文件')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = getattr(mod, 'run', None)
    if not callable(result):
        raise RuntimeError('入口模块未导出 run 函数')
    out = result(payload.get('inputs', {}))
    if asyncio.iscoroutine(out):
        out = asyncio.run(out)
    sys.stdout.write(MARK + json.dumps(out, ensure_ascii=False, default=str) + '\\n')
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;

export type InputOptions = { default: string; password: boolean; multiline: boolean };

export type RunEvent =
  | { seq: number; type: 'log'; text: string }
  | { seq: number; type: 'printf'; text: string }
  | {
      seq: number;
      type: 'input_request';
      id: string;
      prompt: string;
      options: InputOptions;
    }
  | {
      seq: number;
      type: 'done';
      ok: boolean;
      outputs?: unknown;
      error?: string;
      durationMs: number;
    };

export type NewRunEvent =
  | { type: 'log'; text: string }
  | { type: 'printf'; text: string }
  | { type: 'input_request'; id: string; prompt: string; options: InputOptions }
  | { type: 'done'; ok: boolean; outputs?: unknown; error?: string; durationMs: number };

export type PendingInput = {
  id: string;
  prompt: string;
  options: InputOptions;
  resolve: (answer: { ok: true } | { value: string } | { cancelled: true }) => void;
  reject: (err: Error & { httpStatus?: number }) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type RunSession = {
  id: string;
  nodeId: string;
  status: 'running' | 'done';
  events: RunEvent[];
  seq: number;
  pendingInputs: Map<string, PendingInput>;
  subscribers: Set<ServerResponse>;
  child: ChildProcess | null;
  workDir: string;
  startedAt: number;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  doneNotifiers: Array<() => void>;
  result: {
    ok: boolean;
    outputs?: unknown;
    error?: string;
    code?: string;
    durationMs: number;
  } | null;
};

const sessions = new Map<string, RunSession>();
let sessionSeq = 0;

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function findEntryFile(nodeDir: string, runtime: 'node' | 'python'): string {
  const candidates =
    runtime === 'node'
      ? [path.join(nodeDir, 'index.ts'), path.join(nodeDir, 'index.js')]
      : [path.join(nodeDir, 'main.py')];
  for (const file of candidates) {
    if (existsSync(file)) {
      return file;
    }
  }
  fail('NODE_ENTRY_MISSING', '未找到节点入口文件');
}

let cachedPythonKey = '';
let cachedPythonCmd: string[] | null = null;

/** 解析出真正可 spawn 的 python（bare `python` 可能是 Store 别名，spawn 会 9009） */
async function resolvePythonCmd(configured: string): Promise<string[]> {
  if (cachedPythonKey === configured && cachedPythonCmd) {
    return cachedPythonCmd;
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      env[k] = v;
    }
  }
  const candidates: string[][] = [];
  if (configured.trim()) {
    candidates.push([configured.trim()]);
  }
  candidates.push(['python3'], ['py', '-3'], ['python']);
  for (const [exe, ...preArgs] of candidates) {
    const probe = await runChildOnce(exe, [...preArgs, '--version'], env);
    if (probe.code === 0) {
      cachedPythonKey = configured;
      cachedPythonCmd = [exe, ...preArgs];
      return cachedPythonCmd;
    }
  }
  fail('PYTHON_NOT_FOUND', '未找到可用的 Python 解释器（已尝试 python3 / py -3 / python）');
}

function runChildOnce(
  exe: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

function nextSessionId(): string {
  sessionSeq += 1;
  return `run-${Date.now().toString(36)}-${sessionSeq}`;
}

function pushEvent(session: RunSession, event: NewRunEvent): RunEvent {
  session.seq += 1;
  const full = { ...event, seq: session.seq } as RunEvent;
  session.events.push(full);
  if (session.events.length > MAX_EVENTS) {
    session.events.splice(0, session.events.length - MAX_EVENTS);
  }
  const payload = `data: ${JSON.stringify(full)}\n\n`;
  for (const res of session.subscribers) {
    try {
      res.write(payload);
    } catch {
      // 忽略断开的订阅者（close 时清理）
    }
  }
  return full;
}

function finishSession(
  session: RunSession,
  result: { ok: boolean; outputs?: unknown; error?: string; code?: string },
): void {
  if (session.status === 'done') {
    return;
  }
  session.status = 'done';
  session.result = { ...result, durationMs: Date.now() - session.startedAt };
  if (session.ttlTimer) {
    clearTimeout(session.ttlTimer);
    session.ttlTimer = null;
  }
  // 未答复的输入请求一律按取消结算，唤醒阻塞的子进程
  for (const [, pending] of session.pendingInputs) {
    clearTimeout(pending.timer);
    pending.reject(Object.assign(new Error('会话已结束'), { httpStatus: 410 }));
  }
  session.pendingInputs.clear();
  pushEvent(session, {
    type: 'done',
    ok: result.ok,
    ...(result.ok ? { outputs: result.outputs } : { error: result.error }),
    durationMs: session.result.durationMs,
  });
  for (const notify of session.doneNotifiers) {
    try {
      notify();
    } catch {
      // ignore
    }
  }
  session.doneNotifiers = [];
  // 事件已发送，结束 SSE 流
  for (const res of session.subscribers) {
    try {
      res.end();
    } catch {
      // ignore
    }
  }
  session.subscribers.clear();
  // 结果保留 5 分钟供查询
  setTimeout(() => {
    sessions.delete(session.id);
  }, 5 * 60 * 1000).unref?.();
}

export function getRunSession(id: string): RunSession {
  const session = sessions.get(id);
  if (!session) {
    fail('SESSION_NOT_FOUND', '运行会话不存在或已过期');
  }
  return session!;
}

export async function createRunSession(
  nodeId: string,
  body: unknown,
): Promise<{ sessionId: string }> {
  const config = loadConfig();
  if (!config) {
    fail('NOT_INITIALIZED', '尚未初始化');
  }
  if (sessions.size >= MAX_SESSIONS) {
    fail('SESSION_LIMIT', `同时运行的会话过多（上限 ${MAX_SESSIONS} 个）`);
  }
  const input = (body ?? {}) as { inputs?: unknown; envId?: unknown };
  let inputs: Record<string, unknown> = {};
  if (input.inputs !== undefined) {
    if (typeof input.inputs !== 'object' || input.inputs === null || Array.isArray(input.inputs)) {
      fail('INVALID_REQUEST', 'inputs 必须是对象');
    }
    inputs = input.inputs as Record<string, unknown>;
  }
  let envId: string | undefined;
  if (input.envId !== undefined) {
    if (typeof input.envId !== 'string') {
      fail('INVALID_REQUEST', 'envId 必须是字符串');
    }
    envId = input.envId;
  }

  const item = getNodes().find((n) => n.id === nodeId);
  if (!item) {
    fail('NODE_NOT_FOUND', '节点不存在');
  }
  if (item!.status !== 'ready' || !item!.spec) {
    fail('NODE_NOT_READY', '节点未就绪，无法运行（请先修复 meta 校验错误）');
  }

  let envValues: Record<string, string> = {};
  if (envId) {
    const catalog = getEnvironmentCatalog();
    const env = catalog.items.find((e) => e.id === envId);
    if (!env) {
      fail('ENV_NOT_FOUND', '运行环境不存在');
    }
    envValues = { ...env!.values };
  }

  const sessionId = nextSessionId();
  const workDir = mkdtempSync(path.join(tmpdir(), 'workfish-run-'));
  const session: RunSession = {
    id: sessionId,
    nodeId,
    status: 'running',
    events: [],
    seq: 0,
    pendingInputs: new Map(),
    subscribers: new Set(),
    child: null,
    workDir,
    startedAt: Date.now(),
    ttlTimer: null,
    doneNotifiers: [],
    result: null,
  };
  sessions.set(sessionId, session);
  session.ttlTimer = setTimeout(() => {
    session.child?.kill();
    finishSession(session, { ok: false, error: '运行超时（超过 10 分钟，已终止）', code: 'RUN_TIMEOUT' });
  }, RUN_TTL_MS);

  try {
    const libDir = ensureWfLib(config!.workspacePath);
    const entry = findEntryFile(item!.path, item!.runtime);
    const payloadPath = path.join(workDir, 'payload.json');
    writeFileSync(payloadPath, JSON.stringify({ inputs }), 'utf8');

    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        childEnv[k] = v;
      }
    }
    Object.assign(childEnv, envValues);
    childEnv.WORKFISH_RUN_URL = RUN_BASE_URL;
    childEnv.WORKFISH_SESSION_ID = sessionId;
    childEnv.WORKFISH_NODE_ID = nodeId;

    let exe: string;
    let args: string[];
    if (item!.runtime === 'node') {
      const require = createRequire(import.meta.url);
      const tsxCli = require.resolve('tsx/cli');
      // 让脚本能解析 @workfish/server 依赖（如 mysql2）
      const serverNodeModules = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
      childEnv.NODE_PATH = childEnv.NODE_PATH
        ? `${serverNodeModules}${path.delimiter}${childEnv.NODE_PATH}`
        : serverNodeModules;
      const runnerPath = path.join(workDir, 'node-runner.mjs');
      writeFileSync(runnerPath, NODE_RUNNER, 'utf8');
      exe = process.execPath;
      args = [tsxCli, '--tsconfig', wfTsconfigPath(config!.workspacePath), runnerPath, entry, payloadPath];
    } else {
      const runnerPath = path.join(workDir, 'python-runner.py');
      writeFileSync(runnerPath, PYTHON_RUNNER, 'utf8');
      const pyCmd = await resolvePythonCmd(config!.runtimePath || 'python');
      exe = pyCmd[0]!;
      args = [...pyCmd.slice(1), runnerPath, entry, payloadPath];
      const libPath = wfLibDir(config!.workspacePath);
      childEnv.PYTHONPATH = childEnv.PYTHONPATH ? `${libPath}${path.delimiter}${childEnv.PYTHONPATH}` : libPath;
    }

    const child = spawn(exe, args, { env: childEnv, windowsHide: true });
    session.child = child;

    let outBuf = '';
    let errBuf = '';
    let outputs: unknown;
    let hasResult = false;
    const flushLines = (buf: string, isErr: boolean): string => {
      const parts = buf.split(/\r?\n/);
      const rest = parts.pop() ?? '';
      for (const line of parts) {
        if (!line) {
          continue;
        }
        if (!isErr && line.startsWith(RESULT_MARK)) {
          try {
            outputs = JSON.parse(line.slice(RESULT_MARK.length));
            hasResult = true;
          } catch {
            hasResult = false;
          }
        } else {
          pushEvent(session, { type: 'log', text: line });
        }
      }
      return rest;
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      outBuf = flushLines(outBuf + chunk.toString(), false);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      errBuf = flushLines(errBuf + chunk.toString(), true);
    });
    const finishFromChild = (code: number | null) => {
      if (outBuf.trim()) {
        if (outBuf.trimStart().startsWith(RESULT_MARK)) {
          try {
            outputs = JSON.parse(outBuf.trim().slice(RESULT_MARK.length));
            hasResult = true;
          } catch {
            // ignore
          }
        } else {
          pushEvent(session, { type: 'log', text: outBuf.trim() });
        }
      }
      if (errBuf.trim()) {
        pushEvent(session, { type: 'log', text: errBuf.trim() });
      }
      rmSync(workDir, { recursive: true, force: true });
      if (code === 0 && hasResult) {
        finishSession(session, { ok: true, outputs });
      } else {
        const tail = session.events
          .filter((e) => e.type === 'log')
          .slice(-8)
          .map((e) => (e as { text: string }).text)
          .join('\n');
        finishSession(session, {
          ok: false,
          error: tail || `脚本执行失败（退出码 ${code ?? '?' }）`,
          code: 'RUN_FAILED',
        });
      }
    };
    child.on('error', () => finishFromChild(-1));
    child.on('close', (code) => {
      if (session.status === 'running') {
        finishFromChild(code);
      } else {
        rmSync(workDir, { recursive: true, force: true });
      }
    });
  } catch (e) {
    sessions.delete(sessionId);
    rmSync(workDir, { recursive: true, force: true });
    throw e;
  }

  return { sessionId };
}

/** 子进程上报消息：printf 直接落事件；input_request 挂起等待前端答复（长轮询） */
export function postRunMessage(
  sessionId: string,
  body: unknown,
): Promise<{ ok: true } | { value: string } | { cancelled: true }> {
  const session = getRunSession(sessionId);
  const msg = (body ?? {}) as Record<string, unknown>;
  if (msg.type === 'printf') {
    if (session.status !== 'running') {
      fail('SESSION_CLOSED', '会话已结束');
    }
    pushEvent(session, { type: 'printf', text: String(msg.text ?? '') });
    return Promise.resolve({ ok: true as const });
  }
  if (msg.type === 'input_request') {
    if (session.status !== 'running') {
      const err = Object.assign(new Error('会话已结束'), { code: 410, httpStatus: 410 });
      throw err;
    }
    const id = typeof msg.id === 'string' && msg.id ? msg.id : `in-${Date.now().toString(36)}`;
    const rawOptions = (msg.options ?? {}) as Record<string, unknown>;
    const options = {
      default: typeof rawOptions.default === 'string' ? rawOptions.default : '',
      password: Boolean(rawOptions.password),
      multiline: Boolean(rawOptions.multiline),
    };
    const prompt = typeof msg.prompt === 'string' ? msg.prompt : '请输入';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pendingInputs.delete(id);
        reject(Object.assign(new Error('等待输入超时'), { httpStatus: 408 }));
      }, INPUT_WAIT_MS);
      session.pendingInputs.set(id, {
        id,
        prompt,
        options,
        resolve,
        reject,
        timer,
      });
      pushEvent(session, { type: 'input_request', id, prompt, options });
    });
  }
  fail('INVALID_REQUEST', '未知的消息类型');
}

/** 前端答复输入请求 */
export function answerRunInput(
  sessionId: string,
  body: unknown,
): { ok: true } {
  const session = getRunSession(sessionId);
  const input = (body ?? {}) as { requestId?: unknown; value?: unknown; cancelled?: unknown };
  if (typeof input.requestId !== 'string' || !input.requestId) {
    fail('INVALID_REQUEST', 'requestId 必须是字符串');
  }
  const pending = session.pendingInputs.get(input.requestId);
  if (!pending) {
    fail('INPUT_NOT_PENDING', '输入请求不存在或已结算');
  }
  session.pendingInputs.delete(input.requestId);
  clearTimeout(pending!.timer);
  if (input.cancelled) {
    pending!.resolve({ cancelled: true });
  } else {
    pending!.resolve({ value: typeof input.value === 'string' ? input.value : String(input.value ?? '') });
  }
  return { ok: true };
}

/** 终止会话（kill 子进程） */
export function killRunSession(sessionId: string): { ok: true } {
  const session = getRunSession(sessionId);
  session.child?.kill();
  finishSession(session, { ok: false, error: '运行已取消', code: 'RUN_CANCELLED' });
  return { ok: true };
}

export function waitSessionDone(sessionId: string): Promise<RunSession> {
  const session = getRunSession(sessionId);
  if (session.status === 'done') {
    return Promise.resolve(session);
  }
  return new Promise((resolve) => {
    session.doneNotifiers.push(() => resolve(session));
  });
}

/** SSE 订阅：先重放 since 之后的事件，再转直播；会话结束时自动关闭流 */
export function replayRunEvents(session: RunSession, since: number): RunEvent[] {
  return session.events.filter((e) => e.seq > since);
}

export function addRunSubscriber(session: RunSession, res: ServerResponse): void {
  session.subscribers.add(res);
}

export function removeRunSubscriber(session: RunSession, res: ServerResponse): void {
  session.subscribers.delete(res);
}
