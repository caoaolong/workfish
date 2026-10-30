import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateNodeSpec } from './validate.js';
import { extractMetaFromPy } from './extract-py.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'py');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('extractMetaFromPy', () => {
  it('从 fixture 抽取 dict 字面量 meta', () => {
    const source = readFixture('valid-echo.py');
    const result = extractMetaFromPy(source);
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
    const source = readFixture('invalid-call.py');
    const result = extractMetaFromPy(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/字面量|函数调用|call/i);
    }
  });

  it('支持单引号字符串', () => {
    const source = `meta = { 'id': 'py', 'name': 'Py', 'version': '1', 'inputs': {}, 'outputs': {} }`;
    const result = extractMetaFromPy(source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta).toMatchObject({ id: 'py' });
    }
  });

  it('拒绝标识符形式的 dict 键', () => {
    const source = `meta = { id: "echo", "name": "Echo", "version": "1", "inputs": {}, "outputs": {} }`;
    const result = extractMetaFromPy(source);
    expect(result.ok).toBe(false);
  });

  it('拒绝字符串形式的 meta 根值', () => {
    const result = extractMetaFromPy('meta = "x"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          path: 'meta',
          message: expect.stringMatching(/dict 字面量|字典/),
        }),
      ]);
    }
  });

  it('拒绝列表形式的 meta 根值', () => {
    const result = extractMetaFromPy('meta = [1]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe('meta');
      expect(result.errors[0]?.message).toMatch(/dict 字面量|字典/);
    }
  });
});
