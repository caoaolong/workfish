import { extractMetaFromPy } from './extract-py.js';
import { extractMetaFromTs } from './extract-ts.js';
import type { Diagnostic, NodeCatalogItem, NodeSpec } from './schema.js';
import { validateNodeSpec } from './validate.js';

export type ScanNodesDirOpts = {
  nodesDir: string;
  runtime: 'node' | 'python';
  readFile: (p: string) => string;
  listDirs: (p: string) => string[];
  getMtime?: (p: string) => string;
};

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
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
