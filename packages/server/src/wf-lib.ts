import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 脚本公用函数库（wf-lib）。
 * 以文件形式落在工作区 `_wflib/` 下，脚本通过 `import ... from 'wf'`（node，需 tsconfig paths）
 * 或 `from wf import ...`（python，运行器注入 sys.path）使用。
 * 仅在 Workfish 运行中可用：运行器通过环境变量下发会话地址，会话结束后失效。
 */

export const WF_LIB_DIR = '_wflib';
export const WF_TS_CONFIG = 'tsconfig.json';

const WF_TS = `// Workfish 脚本公用函数库（node）。
// 由服务端自动生成，请勿手动修改；升级 Workfish 后会自动保留。
const BASE = process.env.WORKFISH_RUN_URL ?? '';
const SESSION = process.env.WORKFISH_SESSION_ID ?? '';

function assertInside(): void {
  if (!BASE || !SESSION) {
    throw new Error('[wf] 仅可在 Workfish 运行中使用（缺少会话环境变量）');
  }
}

async function postMessage(body: unknown): Promise<Response> {
  const res = await fetch(\`\${BASE}/api/runs/\${SESSION}/messages\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

/** 向后端发送一条纯文本输出（与日志分开展示）。 */
export async function wf_printf(text: string): Promise<void> {
  assertInside();
  const res = await postMessage({ type: 'printf', text: String(text) });
  if (!res.ok) {
    throw new Error(\`[wf] wf_printf 发送失败 (\${res.status})\`);
  }
}

export type WfInputOptions = {
  /** 默认值（前端输入框预填） */
  default?: string;
  /** 密码框（前端掩码显示） */
  password?: boolean;
  /** 多行文本框 */
  multiline?: boolean;
};

let inputSeq = 0;

/**
 * 向后端请求一个参数，阻塞等待用户在前端弹窗中输入后返回。
 * 用户取消运行则抛出 Error。
 */
export async function wf_input(prompt: string, opts: WfInputOptions = {}): Promise<string> {
  assertInside();
  inputSeq += 1;
  const id = \`in-\${Date.now().toString(36)}-\${inputSeq}\`;
  const res = await postMessage({
    type: 'input_request',
    id,
    prompt: String(prompt),
    options: {
      default: opts.default ?? '',
      password: Boolean(opts.password),
      multiline: Boolean(opts.multiline),
    },
  });
  if (res.status === 408) {
    throw new Error('[wf] 等待输入超时');
  }
  if (res.status === 410) {
    throw new Error('[wf] 输入已取消（运行已结束）');
  }
  if (!res.ok) {
    throw new Error(\`[wf] wf_input 失败 (\${res.status})\`);
  }
  const data = (await res.json()) as { value?: unknown; cancelled?: boolean };
  if (data?.cancelled) {
    throw new Error('[wf] 输入已取消');
  }
  const value = data?.value;
  return typeof value === 'string' ? value : String(value ?? '');
}
`;

const WF_PY = `"""Workfish 脚本公用函数库（python）。

由服务端自动生成，请勿手动修改；升级 Workfish 后会自动保留。
"""

import json
import os
import urllib.request
import uuid

_BASE = os.environ.get('WORKFISH_RUN_URL', '')
_SESSION = os.environ.get('WORKFISH_SESSION_ID', '')


def _assert_inside():
    if not _BASE or not _SESSION:
        raise RuntimeError('[wf] 仅可在 Workfish 运行中使用（缺少会话环境变量）')


def _post_message(body):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{_BASE}/api/runs/{_SESSION}/messages',
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    return urllib.request.urlopen(req, timeout=660)


def wf_printf(text):
    """向后端发送一条纯文本输出（与日志分开展示）。"""
    _assert_inside()
    try:
        resp = _post_message({'type': 'printf', 'text': str(text)})
        status = resp.status
    except Exception as e:
        raise RuntimeError(f'[wf] wf_printf 发送失败: {e}')
    if status >= 400:
        raise RuntimeError(f'[wf] wf_printf 发送失败 ({status})')


def wf_input(prompt, default='', password=False, multiline=False):
    """向后端请求一个参数，阻塞等待用户在前端弹窗中输入后返回。

    用户取消运行则抛出 RuntimeError。
    """
    _assert_inside()
    req_id = f'in-{uuid.uuid4().hex[:12]}'
    try:
        resp = _post_message({
            'type': 'input_request',
            'id': req_id,
            'prompt': str(prompt),
            'options': {
                'default': str(default),
                'password': bool(password),
                'multiline': bool(multiline),
            },
        })
    except Exception as e:
        raise RuntimeError(f'[wf] wf_input 失败: {e}')
    if resp.status == 408:
        raise RuntimeError('[wf] 等待输入超时')
    if resp.status == 410:
        raise RuntimeError('[wf] 输入已取消（运行已结束）')
    if resp.status >= 400:
        raise RuntimeError(f'[wf] wf_input 失败 ({resp.status})')
    try:
        data = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        raise RuntimeError(f'[wf] wf_input 响应解析失败: {e}')
    if isinstance(data, dict) and data.get('cancelled'):
        raise RuntimeError('[wf] 输入已取消')
    value = data.get('value') if isinstance(data, dict) else None
    return value if isinstance(value, str) else str(value if value is not None else '')
`;

const WF_TSCONFIG = `{
  // Workfish 运行专用：让 tsx 能解析脚本中的 \`import ... from 'wf'\`。请勿手动修改。
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "wf": ["./wf.ts"]
    }
  }
}
`;

export function wfLibDir(workspacePath: string): string {
  return path.join(workspacePath, WF_LIB_DIR);
}

/** 确保工作区 _wflib/（wf.ts / wf.py / tsconfig.json）存在，缺失才写入，不覆盖用户改动 */
export function ensureWfLib(workspacePath: string): string {
  const dir = wfLibDir(workspacePath);
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ['wf.ts', WF_TS],
    ['wf.py', WF_PY],
    [WF_TS_CONFIG, WF_TSCONFIG],
  ];
  for (const [name, content] of files) {
    const full = path.join(dir, name);
    if (!existsSync(full)) {
      writeFileSync(full, content, 'utf8');
    }
  }
  return dir;
}

export function wfTsconfigPath(workspacePath: string): string {
  return path.join(wfLibDir(workspacePath), WF_TS_CONFIG);
}
