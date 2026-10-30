import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateNodeSpec } from './validate.js';
import { extractMetaFromTs } from './extract-ts.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ts');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('extractMetaFromTs', () => {
  it('从 fixture 抽取对象字面量 meta', () => {
    const source = readFixture('valid-echo.ts');
    const result = extractMetaFromTs(source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta).toMatchObject({
        id: 'echo',
        name: 'Echo',
        version: '0.1.0',
      });
      const validated = validateNodeSpec(result.meta);
      expect(validated.ok).toBe(true);
    }
  });

  it('拒绝函数调用形式的 meta', () => {
    const source = readFixture('invalid-call.ts');
    const result = extractMetaFromTs(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/字面量|函数调用|call/i);
    }
  });

  it('拒绝未导出的 meta', () => {
    const source = `const meta = { id: 'x', name: 'X', version: '1', inputs: {}, outputs: {} };`;
    const result = extractMetaFromTs(source);
    expect(result.ok).toBe(false);
  });

  it('拒绝对象内的标识符引用', () => {
    const source = `export const meta = { id: someId, name: 'X', version: '1', inputs: {}, outputs: {} };`;
    const result = extractMetaFromTs(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.length > 0)).toBe(true);
    }
  });
});
