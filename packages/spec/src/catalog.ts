import { collectRefs } from './compatibility.js';
import { extractMetaFromPy } from './extract-py.js';
import { extractMetaFromTs } from './extract-ts.js';
import type { Diagnostic, NodeCatalogItem, NodeSpec, TypeDef } from './schema.js';
import { validateNodeSpec, validateTypeDef } from './validate.js';

export type ScanNodesDirOpts = {
  nodesDir: string;
  typesDir: string;
  runtime: 'node' | 'python';
  readFile: (p: string) => string;
  listDirs: (p: string) => string[];
  /** 列出目录内文件名（用于加载 typesDir 下 *.type.json） */
  listFiles: (p: string) => string[];
  getMtime?: (p: string) => string;
};

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function loadTypes(opts: ScanNodesDirOpts): Map<string, TypeDef> {
  const map = new Map<string, TypeDef>();
  let files: string[];
  try {
    files = opts.listFiles(opts.typesDir);
  } catch {
    return map;
  }
  for (const file of files) {
    if (!file.endsWith('.type.json')) {
      continue;
    }
    const fullPath = joinPath(opts.typesDir, file);
    let raw: string;
    try {
      raw = opts.readFile(fullPath);
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = validateTypeDef(parsed);
    if (result.ok) {
      map.set(result.value.id, result.value);
    }
  }
  return map;
}

function findEntryPath(
  nodeDir: string,
  runtime: ScanNodesDirOpts['runtime'],
  readFile: ScanNodesDirOpts['readFile'],
): string | undefined {
  if (runtime === 'node') {
    for (const name of ['index.ts', 'index.js']) {
      const full = joinPath(nodeDir, name);
      try {
        readFile(full);
        return full;
      } catch {
        // try next
      }
    }
    return undefined;
  }
  const mainPy = joinPath(nodeDir, 'main.py');
  try {
    readFile(mainPy);
    return mainPy;
  } catch {
    return undefined;
  }
}

function catalogError(
  id: string,
  nodeDir: string,
  runtime: ScanNodesDirOpts['runtime'],
  errors: Diagnostic[],
  entryPath: string | undefined,
  getMtime?: ScanNodesDirOpts['getMtime'],
): NodeCatalogItem {
  const pathForMtime = entryPath ?? nodeDir;
  let mtime = '';
  try {
    mtime = getMtime?.(pathForMtime) ?? '';
  } catch {
    mtime = '';
  }
  return {
    id,
    path: nodeDir,
    status: 'error',
    errors,
    runtime,
    mtime,
  };
}

export function scanNodesDir(opts: ScanNodesDirOpts): NodeCatalogItem[] {
  const types = loadTypes(opts);
  let dirNames: string[];
  try {
    dirNames = opts.listDirs(opts.nodesDir);
  } catch {
    return [];
  }

  const items: NodeCatalogItem[] = [];

  for (const dirName of dirNames) {
    const nodeDir = joinPath(opts.nodesDir, dirName);
    const entryPath = findEntryPath(nodeDir, opts.runtime, opts.readFile);

    if (!entryPath) {
      items.push(
        catalogError(
          dirName,
          nodeDir,
          opts.runtime,
          [{ path: nodeDir, message: '未找到节点入口文件' }],
          undefined,
          opts.getMtime,
        ),
      );
      continue;
    }

    let source: string;
    try {
      source = opts.readFile(entryPath);
    } catch {
      items.push(
        catalogError(
          dirName,
          nodeDir,
          opts.runtime,
          [{ path: entryPath, message: '无法读取节点入口文件' }],
          entryPath,
          opts.getMtime,
        ),
      );
      continue;
    }

    const extracted =
      opts.runtime === 'node' ? extractMetaFromTs(source) : extractMetaFromPy(source);
    if (!extracted.ok) {
      items.push(
        catalogError(dirName, nodeDir, opts.runtime, extracted.errors, entryPath, opts.getMtime),
      );
      continue;
    }

    const validated = validateNodeSpec(extracted.meta);
    if (!validated.ok) {
      items.push(
        catalogError(dirName, nodeDir, opts.runtime, validated.errors, entryPath, opts.getMtime),
      );
      continue;
    }

    const spec: NodeSpec = validated.value;
    const errors: Diagnostic[] = [];

    if (spec.id !== dirName) {
      errors.push({
        path: 'id',
        message: `meta.id「${spec.id}」与目录名「${dirName}」不一致`,
      });
    }

    for (const refId of collectRefs(spec)) {
      if (!types.has(refId)) {
        errors.push({
          path: 'ref',
          message: `未找到类型定义: ${refId}`,
        });
      }
    }

    let mtime = '';
    try {
      mtime = opts.getMtime?.(entryPath) ?? '';
    } catch {
      mtime = '';
    }

    if (errors.length > 0) {
      items.push({
        id: dirName,
        path: nodeDir,
        status: 'error',
        spec,
        errors,
        runtime: opts.runtime,
        mtime,
      });
      continue;
    }

    items.push({
      id: dirName,
      path: nodeDir,
      status: 'ready',
      spec,
      runtime: opts.runtime,
      mtime,
    });
  }

  return items;
}
