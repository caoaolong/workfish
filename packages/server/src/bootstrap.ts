import path from 'node:path';
import { loadConfig, writeConfig, type WorkfishConfig } from './config.js';
import { getDefaultWorkspacePath } from './paths.js';
import { probeRuntime, type RuntimeProbeResult } from './runtime-probe.js';
import { ensureWorkspaceSkeleton } from './workspace.js';

export type BootstrapResponse = {
  initialized: boolean;
  /** 本机默认工作区绝对路径 */
  defaultWorkspacePath: string;
  config?: WorkfishConfig;
  runtimeHealth?: RuntimeProbeResult;
};

export async function getBootstrapState(): Promise<BootstrapResponse> {
  const defaultWorkspacePath = getDefaultWorkspacePath();
  const config = loadConfig();
  if (!config) {
    return { initialized: false, defaultWorkspacePath };
  }

  const runtimeHealth = await probeRuntime(config.runtime, config.runtimePath);
  return {
    initialized: true,
    defaultWorkspacePath,
    config,
    runtimeHealth,
  };
}

export type InitRequest = {
  workspacePath?: string;
  runtime: 'node' | 'python';
  runtimePath?: string;
};

export type InitResponse = {
  config: WorkfishConfig;
  warning?: string;
};

export async function initializeWorkspace(body: InitRequest): Promise<InitResponse> {
  const workspacePath = path.resolve(body.workspacePath ?? getDefaultWorkspacePath());
  const probe = await probeRuntime(body.runtime, body.runtimePath);
  if (!probe.ok) {
    const err = new Error(probe.message ?? '运行时探测失败');
    (err as Error & { code: string }).code = 'RUNTIME_NOT_FOUND';
    throw err;
  }

  ensureWorkspaceSkeleton(workspacePath, body.runtime);

  const config: WorkfishConfig = {
    version: 1,
    workspacePath,
    runtime: body.runtime,
    runtimePath: probe.path ?? body.runtimePath ?? (body.runtime === 'node' ? 'node' : 'python'),
    runtimeVersion: probe.version ?? '',
    initializedAt: new Date().toISOString(),
  };

  writeConfig(config);

  return {
    config,
    ...(probe.warning ? { warning: probe.warning } : {}),
  };
}
