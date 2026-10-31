import { describe, expect, it } from 'vitest';
import { isCompatible } from './compatibility.js';

describe('isCompatible', () => {
  it('同 primitive 类型相容', () => {
    expect(isCompatible({ type: 'string' }, { type: 'string' })).toBe(true);
    expect(isCompatible({ type: 'number' }, { type: 'number' })).toBe(true);
  });

  it('不同 primitive 不相容', () => {
    expect(isCompatible({ type: 'string' }, { type: 'number' })).toBe(false);
  });

  it('any 与任意类型相容', () => {
    expect(isCompatible({ type: 'any' }, { type: 'string' })).toBe(true);
    expect(isCompatible({ type: 'string' }, { type: 'any' })).toBe(true);
  });

  it('object 浅层 properties 逐字段相容', () => {
    const source = {
      type: 'object' as const,
      properties: {
        a: { type: 'string' as const },
        b: { type: 'number' as const },
      },
    };
    const target = {
      type: 'object' as const,
      properties: {
        a: { type: 'string' as const },
      },
    };
    const mismatch = {
      type: 'object' as const,
      properties: {
        a: { type: 'number' as const },
      },
    };
    expect(isCompatible(source, target)).toBe(true);
    expect(isCompatible(source, mismatch)).toBe(false);
  });

  it('array 与非 array 不相容', () => {
    expect(isCompatible({ type: 'array' }, { type: 'object' })).toBe(false);
    expect(isCompatible({ type: 'array' }, { type: 'array' })).toBe(false);
  });
});
