import { describe, expect, it } from 'vitest';
import { validateEnvironmentCatalog } from './validate.js';

describe('legacy catalog without groups', () => {
  it('accepts old file with groups/groupId and flattens items', () => {
    const result = validateEnvironmentCatalog({
      version: 1,
      groups: [{ id: 'grp-1', name: '项目A' }],
      items: [{ id: 'env-1', groupId: 'grp-1', name: '测试库', values: { A: '1' } }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        version: 1,
        items: [{ id: 'env-1', name: '测试库', values: { A: '1' } }],
      });
    }
  });

  it('accepts new file without groups', () => {
    const result = validateEnvironmentCatalog({
      version: 1,
      items: [{ id: 'env-1', name: '测试库', values: {} }],
    });
    expect(result.ok).toBe(true);
  });
});
