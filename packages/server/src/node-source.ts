import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  extractMetaFromPy,
  extractMetaFromTs,
  validateNodeSpec,
  type NodeCatalogItem,
  type NodeSpec,
} from '@workfish/spec';
import { getNodes, invalidateCatalogCache } from './catalog-service.js';

export function isSafeNodeId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
    return false;
  }
  return true;
}

export function findNodeEntry(nodeDir: string, runtime: 'node' | 'python'): string | undefined {
  const candidates =
    runtime === 'node'
      ? [path.join(nodeDir, 'index.ts'), path.join(nodeDir, 'index.js')]
      : [path.join(nodeDir, 'main.py')];
  return candidates.find((f) => existsSync(f));
}

function fail(code: string, message: string, errors?: unknown): never {
  throw Object.assign(new Error(message), { code, ...(errors ? { errors } : {}) });
}

/**
 * 在源码中找到 meta 对象字面量的起止位置（处理字符串/注释中的括号干扰）。
 * anchorStart: meta 声明关键字的起始下标；返回对象字面量 { ... } 的 [start, end)。
 */
function findBraceBlock(source: string, braceOpen: number): [number, number] {
  let i = braceOpen;
  let depth = 0;
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1] ?? '';
    if (lineComment) {
      if (ch === '\n') {
        lineComment = false;
      }
      i += 1;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '#') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return [braceOpen, i + 1];
      }
    }
    i += 1;
  }
  fail('META_REWRITE_FAILED', '源码中 meta 对象不完整，无法定位结束位置');
}

function toPythonLiteral(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  // JSON 字面量转为 Python 字面量：仅 true/false/null 需要改写（字符串均为双引号，Python 合法）
  return json
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
}

export function deleteNodeById(id: string): void {
  if (!isSafeNodeId(id)) {
    fail('INVALID_REQUEST', '非法节点 id');
  }
  const item = getNodes().find((n) => n.id === id);
  if (!item) {
    fail('NODE_NOT_FOUND', '节点不存在');
  }
  rmSync(item!.path, { recursive: true, force: true });
  invalidateCatalogCache();
}

export function putNodeMetaById(id: string, body: unknown): NodeCatalogItem {
  if (!isSafeNodeId(id)) {
    fail('INVALID_REQUEST', '非法节点 id');
  }
  const checked = validateNodeSpec(body);
  if (!checked.ok) {
    fail('VALIDATION_FAILED', 'meta 校验失败', checked.errors);
  }
  const meta: NodeSpec = checked.value;
  if (meta.id !== id) {
    fail('INVALID_REQUEST', 'URL id 与 meta.id 不一致（id 不允许修改）');
  }
  const item = getNodes().find((n) => n.id === id);
  if (!item) {
    fail('NODE_NOT_FOUND', '节点不存在');
  }
  const entry = findNodeEntry(item!.path, item!.runtime);
  if (!entry) {
    fail('NODE_ENTRY_MISSING', '未找到节点入口文件');
  }
  const source = readFileSync(entry, 'utf8');
  let next: string;
  if (item!.runtime === 'node') {
    const anchor = source.indexOf('export const meta');
    if (anchor === -1) {
      fail('META_REWRITE_FAILED', '源码中未找到 `export const meta` 声明');
    }
    const eq = source.indexOf('=', anchor);
    const open = source.indexOf('{', eq);
    if (eq === -1 || open === -1) {
      fail('META_REWRITE_FAILED', '源码中 meta 声明格式无法识别');
    }
    const [start, end] = findBraceBlock(source, open);
    next = `${source.slice(0, start)}${JSON.stringify(meta, null, 2)}${source.slice(end)}`;
    const verify = extractMetaFromTs(next);
    if (!verify.ok) {
      fail('META_REWRITE_FAILED', '改写后源码无法解析，未写入');
    }
  } else {
    const anchor = source.search(/^meta\s*=/m);
    if (anchor === -1) {
      fail('META_REWRITE_FAILED', '源码中未找到 `meta = ...` 声明');
    }
    const eq = source.indexOf('=', anchor);
    const open = source.indexOf('{', eq);
    if (eq === -1 || open === -1) {
      fail('META_REWRITE_FAILED', '源码中 meta 声明格式无法识别');
    }
    const [start, end] = findBraceBlock(source, open);
    next = `${source.slice(0, start)}${toPythonLiteral(meta)}${source.slice(end)}`;
    const verify = extractMetaFromPy(next);
    if (!verify.ok) {
      fail('META_REWRITE_FAILED', '改写后源码无法解析，未写入');
    }
  }
  writeFileSync(entry, next, 'utf8');
  invalidateCatalogCache();
  const refreshed = getNodes(true).find((n) => n.id === id);
  if (!refreshed) {
    fail('NODE_NOT_FOUND', '节点不存在');
  }
  return refreshed!;
}
