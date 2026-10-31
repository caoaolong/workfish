import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  scanNodesDir,
  validateWorkflowDocument,
  type NodeCatalogItem,
  type WorkflowDocument,
} from '@workfish/spec';
import { loadConfig } from './config.js';

export type WorkflowSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

let nodesCache: NodeCatalogItem[] | undefined;

export function invalidateCatalogCache(): void {
  nodesCache = undefined;
}

function scanOpts(workspacePath: string, runtime: 'node' | 'python') {
  return {
    nodesDir: path.join(workspacePath, 'nodes'),
    runtime,
    readFile: (p: string) => readFileSync(p, 'utf8'),
    listDirs: (p: string) =>
      readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory())
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

export function isSafeWorkflowId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return false;
  }
  return true;
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
    case 'NODE_NOT_FOUND':
    case 'SESSION_NOT_FOUND':
    case 'ENV_NOT_FOUND':
      return { status: 404, code, message: err.message };
    case 'INPUT_NOT_PENDING':
    case 'SESSION_CLOSED':
      return { status: 409, code, message: err.message };
    case 'SESSION_LIMIT':
      return { status: 429, code, message: err.message };
    case 'RUN_TIMEOUT':
      return { status: 504, code, message: err.message };
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
