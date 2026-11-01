import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateMonitorCatalog, type MonitorCatalog } from '@workfish/spec';
import { loadConfig } from './config.js';

const EMPTY_CATALOG: MonitorCatalog = {
  version: 1,
  items: [],
};

function catalogPath(workspacePath: string): string {
  return path.join(workspacePath, 'monitors', 'catalog.json');
}

export function getMonitorCatalog(): MonitorCatalog {
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const filePath = catalogPath(config.workspacePath);
  if (!existsSync(filePath)) {
    return { ...EMPTY_CATALOG, items: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw Object.assign(new Error('监控目录文件无法解析'), { code: 'MONITOR_INVALID' });
  }
  const result = validateMonitorCatalog(parsed);
  if (!result.ok) {
    throw Object.assign(new Error('监控目录文件无效'), {
      code: 'MONITOR_INVALID',
      errors: result.errors,
    });
  }
  return result.value;
}

export function putMonitorCatalog(body: unknown): MonitorCatalog {
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const result = validateMonitorCatalog(body);
  if (!result.ok) {
    throw Object.assign(new Error('监控目录校验失败'), {
      code: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }
  const dir = path.join(config.workspacePath, 'monitors');
  mkdirSync(dir, { recursive: true });
  writeFileSync(catalogPath(config.workspacePath), `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
  return result.value;
}

export function ensureMonitorsDir(workspacePath: string): void {
  const dir = path.join(workspacePath, 'monitors');
  mkdirSync(dir, { recursive: true });
  const filePath = catalogPath(workspacePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(EMPTY_CATALOG, null, 2)}\n`, 'utf8');
  }
}
