import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getAppConfigFilePath } from './paths.js';

export type WorkfishRuntime = 'node' | 'python';

export type WorkfishConfig = {
  version: 1;
  workspacePath: string;
  runtime: WorkfishRuntime;
  runtimePath: string;
  runtimeVersion: string;
  initializedAt: string;
};

export function isWorkfishConfig(value: unknown): value is WorkfishConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.workspacePath === 'string' &&
    (o.runtime === 'node' || o.runtime === 'python') &&
    typeof o.runtimePath === 'string' &&
    typeof o.runtimeVersion === 'string' &&
    typeof o.initializedAt === 'string'
  );
}

export function loadConfig(): WorkfishConfig | undefined {
  const file = getAppConfigFilePath();
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isWorkfishConfig(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeConfig(config: WorkfishConfig): void {
  const file = getAppConfigFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function updateConfig(partial: Partial<WorkfishConfig> & Pick<WorkfishConfig, 'workspacePath'>): WorkfishConfig {
  const existing = loadConfig();
  if (!existing) {
    throw new Error('CONFIG_NOT_FOUND');
  }
  const next: WorkfishConfig = {
    ...existing,
    ...partial,
    workspacePath: path.resolve(partial.workspacePath),
    version: 1,
  };
  writeConfig(next);
  return next;
}
