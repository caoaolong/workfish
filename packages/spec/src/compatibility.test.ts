import { describe, expect, it } from 'vitest';
import type { FieldSpec, TypeDef } from './schema.js';
import { isCompatible } from './compatibility.js';

function types(entries: [string, TypeDef][]): Map<string, TypeDef> {
  return new Map(entries);
}

describe('isCompatible', () => {
  it('同 primitive 类型相容', () => {
    expect(isCompatible({ type: 'string' }, { type: 'string' }, new Map())).toBe(true);
    expect(isCompatible({ type: 'number' }, { type: 'number' }, new Map())).toBe(true);
  });

  it('不同 primitive 不相容', () => {
    expect(isCompatible({ type: 'string' }, { type: 'number' }, new Map())).toBe(false);
  });

  it('any 与任意类型相容', () => {
    expect(isCompatible({ type: 'any' }, { type: 'string' }, new Map())).toBe(true);
    expect(isCompatible({ type: 'string' }, { type: 'any' }, new Map())).toBe(true);
  });

  it('相同 ref 名称相容', () => {
    const a: FieldSpec = { type: 'ref', ref: 'User' };
    expect(isCompatible(a, { ...a }, new Map())).toBe(true);
  });

  it('缺失 ref 定义不相容', () => {
    const a: FieldSpec = { type: 'ref', ref: 'Missing' };
    expect(isCompatible(a, { type: 'string' }, new Map())).toBe(false);
  });

  it('ref 展开后与 object 浅层 properties 比较', () => {
    const userType: TypeDef = {
      id: 'User',
      name: 'User',
      fields: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };
    const map = types([['User', userType]]);
    const refField: FieldSpec = { type: 'ref', ref: 'User' };
    const objOk: FieldSpec = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    };
    const objBad: FieldSpec = {
      type: 'object',
      properties: {
        name: { type: 'number' },
      },
    };
    expect(isCompatible(refField, objOk, map)).toBe(true);
    expect(isCompatible(objOk, refField, map)).toBe(true);
    expect(isCompatible(refField, objBad, map)).toBe(false);
  });

  it('object 浅层 properties 逐字段相容', () => {
    const source: FieldSpec = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
    };
    const target: FieldSpec = {
      type: 'object',
      properties: {
        a: { type: 'string' },
      },
    };
    const mismatch: FieldSpec = {
      type: 'object',
      properties: {
        a: { type: 'number' },
      },
    };
    expect(isCompatible(source, target, new Map())).toBe(true);
    expect(isCompatible(source, mismatch, new Map())).toBe(false);
  });
});
