import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Empty, Modal, Row, Spin, Typography, App as AntdApp } from 'antd';
import { formatApiError, getWorkflow, listWorkflows } from '../api/client.js';
import type { WorkflowDocument, WorkflowSummary } from '../types.js';

type Props = {
  open: boolean;
  currentId?: string;
  onCancel: () => void;
  onOpen: (doc: WorkflowDocument) => void;
};

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkflowListModal({ open, currentId, onCancel, onOpen }: Props) {
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkflowSummary[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await listWorkflows();
        if (!cancelled) {
          setItems(list);
        }
      } catch (e) {
        if (!cancelled) {
          message.error(formatApiError(e));
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, message]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [items],
  );

  const handleOpen = async (id: string) => {
    setOpeningId(id);
    try {
      const doc = await getWorkflow(id);
      onOpen(doc);
    } catch (e) {
      message.error(formatApiError(e));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Modal
      title="我的工作流"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
      destroyOnClose
      className="workflow-list-modal"
    >
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spin tip="加载工作流列表…" />
        </div>
      ) : sorted.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无工作流，可先新建并保存" />
      ) : (
        <Row gutter={[12, 12]}>
          {sorted.map((item) => {
            const active = item.id === currentId;
            const opening = openingId === item.id;
            return (
              <Col key={item.id} xs={24} sm={12}>
                <Card
                  size="small"
                  hoverable
                  loading={opening}
                  className={`workflow-card${active ? ' is-active' : ''}`}
                  onClick={() => {
                    if (!opening && openingId === null) {
                      void handleOpen(item.id);
                    }
                  }}
                >
                  <Typography.Text strong ellipsis style={{ display: 'block' }}>
                    {item.name || '未命名'}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    code
                    ellipsis
                    style={{ display: 'block', marginTop: 4, fontSize: 12 }}
                  >
                    {item.id}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                    更新于 {formatUpdatedAt(item.updatedAt)}
                    {active ? ' · 当前打开' : ''}
                  </Typography.Text>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </Modal>
  );
}
