import { Alert, Empty, Typography } from 'antd';
import type { Diagnostic, NodeCatalogItem } from '../types.js';

const DRAG_MIME = 'application/workfish-node';

export function paletteDragMime(): string {
  return DRAG_MIME;
}

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
};

export function NodePalette({ ready, problems }: Props) {
  return (
    <div className="node-palette">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        拖拽到画布以添加节点
      </Typography.Paragraph>

      {ready.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可用节点" />
      ) : (
        <div className="palette-grid">
          {ready.map((item) => (
            <div
              key={item.id}
              className="palette-item"
              draggable
              title={item.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, item.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <Typography.Text strong ellipsis className="palette-item-name">
                {item.spec?.name ?? item.id}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis className="palette-item-id">
                {item.id}
              </Typography.Text>
            </div>
          ))}
        </div>
      )}

      {problems.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            问题节点
          </Typography.Text>
          {problems.map((item) => (
            <Alert
              key={item.id}
              type="error"
              showIcon
              style={{ marginBottom: 8 }}
              message={item.id}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(item.errors ?? []).map((err: Diagnostic, i) => (
                    <li key={`${err.path}-${i}`}>
                      <Typography.Text type="secondary">{err.path || '—'}</Typography.Text>{' '}
                      {err.message}
                    </li>
                  ))}
                </ul>
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
