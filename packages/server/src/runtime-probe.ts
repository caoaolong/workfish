import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

export type RuntimeKind = 'node' | 'python';

export type RuntimeProbeResult = {
  ok: boolean;
  version?: string;
  path?: string;
  message?: string;
  warning?: string;
};

const NODE_MIN_MAJOR = 18;
const PYTHON_MIN_MAJOR = 3;
const PYTHON_MIN_MINOR = 10;

function parseSemverish(text: string): string | undefined {
  const m = text.match(/(\d+\.\d+\.\d+|\d+\.\d+)/);
  return m?.[1];
}

function compareVersion(a: string, minMajor: number, minMinor = 0): boolean {
  const parts = a.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major > minMajor) {
    return true;
  }
  if (major < minMajor) {
    return false;
  }
  return minor >= minMinor;
}

/** PATH 上的 bare 命令名（如 node、python3）不做 accessSync，仅对含路径或绝对路径尝试 */
function shouldAccessSyncFirst(exe: string): boolean {
  return path.isAbsolute(exe) || exe.includes('/') || exe.includes('\\');
}

function probeSpawn(exe: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      resolve({ stdout, stderr, code: -1 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

function applyVersionPolicy(
  runtime: RuntimeKind,
  exe: string,
  version: string,
): RuntimeProbeResult {
  let warning: string | undefined;
  if (runtime === 'node' && !compareVersion(version, NODE_MIN_MAJOR)) {
    warning = `Node 版本 ${version} 低于建议的 ${NODE_MIN_MAJOR}.x`;
  }
  if (runtime === 'python' && !compareVersion(version, PYTHON_MIN_MAJOR, PYTHON_MIN_MINOR)) {
    warning = `Python 版本 ${version} 低于建议的 ${PYTHON_MIN_MAJOR}.${PYTHON_MIN_MINOR}`;
  }
  return { ok: true, version, path: exe, ...(warning ? { warning } : {}) };
}

async function probeExecutable(
  runtime: RuntimeKind,
  exe: string,
  args: string[],
): Promise<RuntimeProbeResult> {
  if (shouldAccessSyncFirst(exe)) {
    try {
      accessSync(exe, constants.X_OK);
    } catch {
      // Windows 上 node.exe 可能无法 X_OK 检测，仍尝试 spawn
      if (process.platform !== 'win32') {
        return { ok: false, path: exe, message: `未找到可执行文件: ${exe}` };
      }
    }
  }

  const { stdout, stderr, code } = await probeSpawn(exe, args);
  if (code !== 0 && code !== -1) {
    return {
      ok: false,
      path: exe,
      message: (stderr || stdout || '探测失败').trim(),
    };
  }
  if (code === -1) {
    return { ok: false, path: exe, message: `无法启动: ${exe}` };
  }

  const combined = `${stdout}\n${stderr}`.trim();
  const version = parseSemverish(combined);
  if (!version) {
    return { ok: false, path: exe, message: `无法解析版本: ${combined}` };
  }

  return applyVersionPolicy(runtime, exe, version);
}

function pythonCandidates(): { exe: string; args: string[] }[] {
  if (process.platform === 'win32') {
    return [
      { exe: 'python', args: ['--version'] },
      { exe: 'py', args: ['-3', '--version'] },
      { exe: 'python3', args: ['--version'] },
    ];
  }
  return [
    { exe: 'python3', args: ['--version'] },
    { exe: 'python', args: ['--version'] },
  ];
}

export async function probeRuntime(
  runtime: RuntimeKind,
  runtimePath?: string,
): Promise<RuntimeProbeResult> {
  const trimmed = runtimePath?.trim();
  if (trimmed) {
    const args = runtime === 'node' ? ['-v'] : ['--version'];
    return probeExecutable(runtime, trimmed, args);
  }

  if (runtime === 'node') {
    return probeExecutable(runtime, 'node', ['-v']);
  }

  let last: RuntimeProbeResult = { ok: false, message: '未找到 Python 解释器' };
  for (const { exe, args } of pythonCandidates()) {
    const result = await probeExecutable(runtime, exe, args);
    if (result.ok) {
      return result;
    }
    last = result;
  }
  return last;
}
