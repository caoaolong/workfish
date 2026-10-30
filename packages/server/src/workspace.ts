import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { extractMetaFromTs, extractMetaFromPy } from '@workfish/spec';
import type { WorkfishRuntime } from './config.js';
import { ensureEnvironmentsDir } from './environments-service.js';

const EXAMPLE_NODE_TS = `export const meta = {
  id: 'example-echo',
  name: 'Example Echo',
  version: '0.1.0',
  inputs: {
    message: { type: 'string' },
  },
  outputs: {
    result: { type: 'string' },
  },
};

export async function run(inputs: { message?: string }) {
  return { result: inputs.message ?? '' };
}
`;

const EXAMPLE_NODE_PY = `meta = {
  "id": "example-echo",
  "name": "Example Echo",
  "version": "0.1.0",
  "inputs": {
    "message": { "type": "string" }
  },
  "outputs": {
    "result": { "type": "string" }
  }
}

async def run(inputs):
    message = inputs.get("message", "") if isinstance(inputs, dict) else ""
    return {"result": message}
`;

function writeIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }
  writeFileSync(filePath, content, 'utf8');
}

export function ensureWorkspaceSkeleton(workspacePath: string, runtime: WorkfishRuntime): void {
  mkdirSync(path.join(workspacePath, 'types'), { recursive: true });
  mkdirSync(path.join(workspacePath, 'nodes'), { recursive: true });
  mkdirSync(path.join(workspacePath, 'workflows'), { recursive: true });
  ensureEnvironmentsDir(workspacePath);

  const exampleDir = path.join(workspacePath, 'nodes', 'example-echo');
  mkdirSync(exampleDir, { recursive: true });

  if (runtime === 'node') {
    const indexPath = path.join(exampleDir, 'index.ts');
    writeIfMissing(indexPath, EXAMPLE_NODE_TS);
    const extracted = extractMetaFromTs(EXAMPLE_NODE_TS);
    if (!extracted.ok) {
      throw new Error('示例节点 meta 无法被 @workfish/spec 解析');
    }
  } else {
    const mainPath = path.join(exampleDir, 'main.py');
    writeIfMissing(mainPath, EXAMPLE_NODE_PY);
    const extracted = extractMetaFromPy(EXAMPLE_NODE_PY);
    if (!extracted.ok) {
      throw new Error('示例节点 meta 无法被 @workfish/spec 解析');
    }
  }
}

export function isWorkspaceInitialized(workspacePath: string): boolean {
  return existsSync(path.join(workspacePath, 'config.json'));
}
