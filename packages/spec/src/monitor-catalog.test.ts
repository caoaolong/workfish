import { describe, expect, it } from 'vitest';
import { validateMonitorCatalog } from './validate.js';

describe('validateMonitorCatalog', () => {
  it('accepts multi-env catalog', () => {
    const result = validateMonitorCatalog({
      version: 1,
      items: [
        {
          id: 'mon-1',
          name: 'Grafana',
          description: '指标',
          environments: [
            { name: '生产', url: 'https://grafana.prod.example.com' },
            { name: '测试', url: 'https://grafana.test.example.com' },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.environments).toHaveLength(2);
    }
  });

  it('migrates legacy single url', () => {
    const result = validateMonitorCatalog({
      version: 1,
      items: [
        {
          id: 'mon-1',
          name: 'Grafana',
          url: 'https://grafana.example.com',
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.environments).toEqual([
        { name: '默认', url: 'https://grafana.example.com' },
      ]);
    }
  });

  it('rejects non-http url', () => {
    const result = validateMonitorCatalog({
      version: 1,
      items: [
        {
          id: 'mon-1',
          name: 'Bad',
          environments: [{ name: '生产', url: 'ftp://x' }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});
