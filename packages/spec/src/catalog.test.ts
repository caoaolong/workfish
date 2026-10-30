import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it, afterEach } from 'vitest';
import { scanNodesDir } from './catalog.js';

function makeIo(root: string) {
  return {
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

describe('scanNodesDir', () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('node 运行时扫描有效 echo 节点为 ready', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wf-catalog-'));
    const typesDir = join(tempRoot, 'types');
    const nodesDir = join(tempRoot, 'nodes');
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(join(nodesDir, 'echo'), { recursive: true });
    writeFileSync(
      join(nodesDir, 'echo', 'index.ts'),
      `export const meta = {
  id: 'echo',
  name: 'Echo',
  version: '0.1.0',
  inputs: { message: { type: 'string' } },
  outputs: { result: { type: 'string' } },
};`,
      'utf8',
    );

    const io = makeIo(tempRoot);
    const items = scanNodesDir({
      nodesDir,
      typesDir,
      runtime: 'node',
      ...io,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('echo');
    expect(items[0]?.status).toBe('ready');
    expect(items[0]?.spec?.id).toBe('echo');
    expect(items[0]?.runtime).toBe('node');
    expect(items[0]?.mtime).toBeTruthy();
  });

  it('meta id 与目录名不一致时为 error', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wf-catalog-'));
    const typesDir = join(tempRoot, 'types');
    const nodesDir = join(tempRoot, 'nodes');
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(join(nodesDir, 'wrong-dir'), { recursive: true });
    writeFileSync(
      join(nodesDir, 'wrong-dir', 'index.ts'),
      `export const meta = {
  id: 'other-id',
  name: 'X',
  version: '1.0.0',
  inputs: {},
  outputs: {},
};`,
      'utf8',
    );

    const io = makeIo(tempRoot);
    const items = scanNodesDir({
      nodesDir,
      typesDir,
      runtime: 'node',
      ...io,
    });

    expect(items[0]?.status).toBe('error');
    expect(items[0]?.errors?.some((e) => e.message.includes('目录'))).toBe(true);
  });

  it('引用缺失 type 时为 error', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wf-catalog-'));
    const typesDir = join(tempRoot, 'types');
    const nodesDir = join(tempRoot, 'nodes');
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(join(nodesDir, 'needs-ref'), { recursive: true });
    writeFileSync(
      join(nodesDir, 'needs-ref', 'index.ts'),
      `export const meta = {
  id: 'needs-ref',
  name: 'Needs Ref',
  version: '1.0.0',
  inputs: { payload: { type: 'ref', ref: 'UnknownType' } },
  outputs: {},
};`,
      'utf8',
    );

    const io = makeIo(tempRoot);
    const items = scanNodesDir({
      nodesDir,
      typesDir,
      runtime: 'node',
      ...io,
    });

    expect(items[0]?.status).toBe('error');
    expect(items[0]?.errors?.some((e) => e.message.includes('UnknownType'))).toBe(true);
  });

  it('python 运行时从 main.py 抽取', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wf-catalog-'));
    const typesDir = join(tempRoot, 'types');
    const nodesDir = join(tempRoot, 'nodes');
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(join(nodesDir, 'py-echo'), { recursive: true });
    writeFileSync(
      join(nodesDir, 'py-echo', 'main.py'),
      `meta = {
  "id": "py-echo",
  "name": "PyEcho",
  "version": "0.1.0",
  "inputs": {
    "message": { "type": "string" }
  },
  "outputs": {
    "result": { "type": "string" }
  }
}
`,
      'utf8',
    );

    const io = makeIo(tempRoot);
    const items = scanNodesDir({
      nodesDir,
      typesDir,
      runtime: 'python',
      ...io,
    });

    expect(items[0]?.status).toBe('ready');
    expect(items[0]?.runtime).toBe('python');
    expect(items[0]?.spec?.name).toBe('PyEcho');
  });

  it('加载 typesDir 下 type.json 供 ref 校验', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wf-catalog-'));
    const typesDir = join(tempRoot, 'types');
    const nodesDir = join(tempRoot, 'nodes');
    mkdirSync(typesDir, { recursive: true });
    mkdirSync(join(nodesDir, 'with-ref'), { recursive: true });
    writeFileSync(
      join(typesDir, 'Payload.type.json'),
      JSON.stringify({
        id: 'Payload',
        name: 'Payload',
        fields: { body: { type: 'string' } },
      }),
      'utf8',
    );
    writeFileSync(
      join(nodesDir, 'with-ref', 'index.ts'),
      `export const meta = {
  id: 'with-ref',
  name: 'With Ref',
  version: '1.0.0',
  inputs: { payload: { type: 'ref', ref: 'Payload' } },
  outputs: { out: { type: 'ref', ref: 'Payload' } },
};`,
      'utf8',
    );

    const io = makeIo(tempRoot);
    const items = scanNodesDir({
      nodesDir,
      typesDir,
      runtime: 'node',
      ...io,
    });

    expect(items[0]?.status).toBe('ready');
  });
});
