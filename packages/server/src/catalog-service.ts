import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  scanNodesDir,
  validateTypeDef,
  validateWorkflowDocument,
  type NodeCatalogItem,
  type TypeDef,
  type WorkflowDocument,
} from '@workfish/spec';
import { loadConfig } from './config.js';

export type WorkflowSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

let nodesCache: NodeCatalogItem[] | undefined;
let typesCache: TypeDef[] | undefined;

export function invalidateCatalogCache(): void {
  nodesCache = undefined;
  typesCache = undefined;
}

function scanOpts(workspacePath: string, runtime: 'node' | 'python') {
  return {
    nodesDir: path.join(workspacePath, 'nodes'),
    typesDir: path.join(workspacePath, 'types'),
    runtime,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    listDirs: (p: string) =>
      readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    listFiles: (p: string) =>
      readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name),
    getMtime: (p: string) => statSync(p).mtime.toISOString(),
  };
}

export function getNodes(force = false): NodeCatalogItem[] {
  if (!force && nodesCache) {
    return nodesCache;
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  nodesCache = scanNodesDir(scanOpts(config.workspacePath, config.runtime));
  return nodesCache;
}

export function getTypes(force = false): TypeDef[] {
  if (!force && typesCache) {
    return typesCache;
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const typesDir = path.join(config.workspacePath, 'types');
  const items: TypeDef[] = [];
  let files: string[];
  try {
    files = readdirSync(typesDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    typesCache = items;
    return items;
  }
  for (const file of files) {
    if (!file.endsWith('.type.json')) {
      continue;
    }
    const fullPath = path.join(typesDir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch {
      continue;
    }
    const result = validateTypeDef(parsed);
    if (result.ok) {
      items.push(result.value);
    }
  }
  typesCache = items;
  return items;
}

export function isSafeWorkflowId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return false;
  }
  return true;
}

export function isSafeTypeId(id: string): boolean {
  return isSafeWorkflowId(id) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id);
}

function typeFilePath(workspacePath: string, id: string): string {
  return path.join(workspacePath, 'types', `${id}.type.json`);
}

export function putTypeById(id: string, body: unknown): TypeDef {
  if (!isSafeTypeId(id)) {
    throw Object.assign(new Error('非法类型 id（需字母开头，仅含字母数字_-）'), {
      code: 'INVALID_REQUEST',
    });
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const result = validateTypeDef(body);
  if (!result.ok) {
    throw Object.assign(new Error('类型校验失败'), {
      code: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }
  if (result.value.id !== id) {
    throw Object.assign(new Error('URL id 与类型 id 不一致'), { code: 'INVALID_REQUEST' });
  }
  const typesDir = path.join(config.workspacePath, 'types');
  mkdirSync(typesDir, { recursive: true });
  writeFileSync(typeFilePath(config.workspacePath, id), `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
  invalidateCatalogCache();
  return result.value;
}

export function deleteTypeById(id: string): void {
  if (!isSafeTypeId(id)) {
    throw Object.assign(new Error('非法类型 id'), { code: 'INVALID_REQUEST' });
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const filePath = typeFilePath(config.workspacePath, id);
  if (!existsSync(filePath)) {
    throw Object.assign(new Error('类型不存在'), { code: 'TYPE_NOT_FOUND' });
  }
  unlinkSync(filePath);
  invalidateCatalogCache();
}

function workflowFilePath(workspacePath: string, id: string): string {
  return path.join(workspacePath, 'workflows', `${id}.workflow.json`);
}

export function listWorkflows(): WorkflowSummary[] {
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const dir = path.join(config.workspacePath, 'workflows');
  if (!existsSync(dir)) {
    return [];
  }
  const summaries: WorkflowSummary[] = [];
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.workflow.json')) {
      continue;
    }
    const fullPath = path.join(dir, file.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch {
      continue;
    }
    const result = validateWorkflowDocument(parsed);
    if (result.ok) {
      summaries.push({
        id: result.value.id,
        name: result.value.name,
        updatedAt: result.value.updatedAt,
      });
    }
  }
  return summaries;
}

export function getWorkflowById(id: string): WorkflowDocument {
  if (!isSafeWorkflowId(id)) {
    throw Object.assign(new Error('非法 workflow id'), { code: 'INVALID_REQUEST' });
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const filePath = workflowFilePath(config.workspacePath, id);
  if (!existsSync(filePath)) {
    throw Object.assign(new Error('工作流不存在'), { code: 'WORKFLOW_NOT_FOUND' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw Object.assign(new Error('工作流文件无法解析'), { code: 'WORKFLOW_INVALID' });
  }
  const result = validateWorkflowDocument(parsed);
  if (!result.ok) {
    throw Object.assign(new Error('工作流文件无效'), {
      code: 'WORKFLOW_INVALID',
      errors: result.errors,
    });
  }
  return result.value;
}

export function putWorkflowById(id: string, body: unknown): WorkflowDocument {
  if (!isSafeWorkflowId(id)) {
    throw Object.assign(new Error('非法 workflow id'), { code: 'INVALID_REQUEST' });
  }
  const config = loadConfig();
  if (!config) {
    throw Object.assign(new Error('尚未初始化'), { code: 'NOT_INITIALIZED' });
  }
  const result = validateWorkflowDocument(body);
  if (!result.ok) {
    throw Object.assign(new Error('工作流校验失败'), {
      code: 'VALIDATION_FAILED',
      errors: result.errors,
    });
  }
  if (result.value.id !== id) {
    throw Object.assign(new Error('URL id 与文档 id 不一致'), { code: 'INVALID_REQUEST' });
  }
  const workflowsDir = path.join(config.workspacePath, 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  const filePath = workflowFilePath(config.workspacePath, id);
  writeFileSync(filePath, `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
  return result.value;
}

export function handleCatalogError(
  e: unknown,
): { status: number; code: string; message: string; details?: Record<string, unknown> } {
  const err = e as Error & { code?: string; errors?: unknown };
  const code = err.code ?? 'INTERNAL_ERROR';
  switch (code) {
    case 'NOT_INITIALIZED':
      return { status: 409, code, message: err.message };
    case 'INVALID_REQUEST':
      return { status: 400, code, message: err.message };
    case 'WORKFLOW_NOT_FOUND':
    case 'TYPE_NOT_FOUND':
      return { status: 404, code, message: err.message };
    case 'WORKFLOW_INVALID':
    case 'ENV_INVALID':
    case 'VALIDATION_FAILED':
      return {
        status: 400,
        code,
        message: err.message,
        ...(err.errors ? { details: { errors: err.errors } } : {}),
      };
    default:
      return { status: 500, code, message: err.message };
  }
}
