import { describe, expect, it } from 'vitest';
import { validateNodeSpec, validateWorkflowDocument } from './validate.js';

describe('validateNodeSpec', () => {
  it('accepts a valid NodeSpec', () => {
    const input = {
      id: 'echo',
      name: 'Echo',
      version: '1.0.0',
      inputs: {
        message: { type: 'string' as const },
      },
      outputs: {
        result: { type: 'string' as const },
      },
    };
    const result = validateNodeSpec(input);
    expect(result).toEqual({ ok: true, value: input });
  });

  it('rejects NodeSpec missing id', () => {
    const input = {
      name: 'No Id',
      version: '1.0.0',
      inputs: {},
      outputs: {},
    };
    const result = validateNodeSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path.includes('id'))).toBe(true);
    }
  });

  it('rejects FieldSpec with invalid type', () => {
    const input = {
      id: 'bad-type',
      name: 'Bad Type',
      version: '1.0.0',
      inputs: {
        x: { type: 'not-a-type' },
      },
      outputs: {},
    };
    const result = validateNodeSpec(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects 未知 FieldSpec type（ref 已移除）', () => {
    const input = {
      id: 'with-ref',
      name: 'With Ref',
      version: '1.0.0',
      inputs: {
        payload: { type: 'ref', ref: 'Something' },
      },
      outputs: {},
    };
    const result = validateNodeSpec(input);
    expect(result.ok).toBe(false);
  });
});

describe('validateWorkflowDocument', () => {
  it('accepts a minimal valid WorkflowDocument', () => {
    const input = {
      version: 1,
      id: 'wf-demo',
      name: 'Demo',
      updatedAt: '2026-10-30T00:00:00.000Z',
      nodes: [],
      edges: [],
    };
    const result = validateWorkflowDocument(input);
    expect(result).toEqual({ ok: true, value: input });
  });
});
