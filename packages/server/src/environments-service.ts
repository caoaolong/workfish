import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  validateEnvironmentCatalog,
  type EnvironmentCatalog,
} from '@workfish/spec';
import { loadConfig } from './config.js';

const EMPTY_CATALOG: EnvironmentCatalog = {
  version: 1,
  items: [],
};

function catalogPath(workspacePath: string): string {
  return path.join(workspacePath, 'environments', 'catalog.json');
}

export function getEnvironmentCatalog(): EnvironmentCatalog {
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
    throw Object.assign(new Error('环境目录文件无法解析'), { code: 'ENV_INVALID' });
  }
  const result = validateEnvironmentCatalog(parsed);
  if (!result.ok) {
    throw Object.assign(new Error('环境目录文件无效'), {
      code: 'ENV_INVALID',
      errors: result.errors,
    });
  }
  return result.value;
}

export function putEnvironmentCatalog(body: unknown): EnvironmentCatalog {
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const result = validateEnvironmentCatalog(body);
  if (!result.ok) {
    throw Object.assign(new Error('环境目录校验失败'), {
      code: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }
  const dir = path.join(config.workspacePath, 'environments');
  mkdirSync(dir, { recursive: true });
  writeFileSync(catalogPath(config.workspacePath), `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
  return result.value;
}

export function ensureEnvironmentsDir(workspacePath: string): void {
  const dir = path.join(workspacePath, 'environments');
  mkdirSync(dir, { recursive: true });
  const filePath = catalogPath(workspacePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(EMPTY_CATALOG, null, 2)}\n`, 'utf8');
  }
}
