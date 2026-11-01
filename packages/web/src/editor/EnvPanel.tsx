import { forwardRef, useImperativeHandle, useState } from 'react';
import {
  Button,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Typography,
  App as AntdApp,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog, EnvironmentItem } from '@workfish/spec';
import { formatApiError, putEnvironments } from '../api/client.js';

export type EnvPanelHandle = {
  openCreateEnv: () => void;
};

type Props = {
  catalog: EnvironmentCatalog;
  onChanged: (next: EnvironmentCatalog) => Promise<void> | void;
};

type KvRow = { key: string; name: string; value: string };

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

export const EnvPanel = forwardRef<EnvPanelHandle, Props>(function EnvPanel(
  { catalog, onChanged },
  ref,
) {
  const { message, modal } = AntdApp.useApp();
  const [envModal, setEnvModal] = useState<{
    open: boolean;
    editing?: EnvironmentItem;
  } | null>(null);
  const [envName, setEnvName] = useState('');
  const [kvRows, setKvRows] = useState<KvRow[]>([]);
  const [saving, setSaving] = useState(false);

  const persist = async (next: EnvironmentCatalog) => {
    setSaving(true);
    try {
      const saved = await putEnvironments(next);
      await onChanged(saved);
      message.success('环境已保存');
    } catch (e) {
      message.error(formatApiError(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const openCreateEnv = () => {
    setEnvName('');
    setKvRows([{ key: `kv-${Date.now()}`, name: '', value: '' }]);
    setEnvModal({ open: true });
  };

  useImperativeHandle(ref, () => ({ openCreateEnv }), []);

  const openEditEnv = (item: EnvironmentItem) => {
    setEnvName(item.name);
    setKvRows(
      Object.entries(item.values).map(([name, value], i) => ({
        key: `kv-${i}-${name}`,
        name,
        value,
      })),
    );
    setEnvModal({ open: true, editing: item });
  };

  const saveEnv = async () => {
    if (!envModal) {
      return;
    }
    const name = envName.trim();
    if (!name) {
      message.warning('请填写环境名称');
      return;
    }
    const values: Record<string, string> = {};
    for (const row of kvRows) {
      const k = row.name.trim();
      if (!k) {
        continue;
      }
      values[k] = row.value;
    }
    const editing = envModal.editing;
    const item: EnvironmentItem = editing
      ? { ...editing, name, values }
      : { id: newId('env'), name, values };
    const next: EnvironmentCatalog = {
      version: 1,
      items: editing
        ? catalog.items.map((x) => (x.id === editing.id ? item : x))
        : [...catalog.items, item],
    };
    await persist(next);
    setEnvModal(null);
  };

  const deleteEnv = (item: EnvironmentItem) => {
    modal.confirm({
      title: '删除环境',
      content: `确定删除环境「${item.name}」吗？`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const next: EnvironmentCatalog = {
          version: 1,
          items: catalog.items.filter((x) => x.id !== item.id),
        };
        await persist(next);
      },
    });
  };

  return (
    <div className="sidebar-panel-body env-palette">
      {catalog.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无环境" />
      ) : (
        <div className="palette-grid">
          {catalog.items.map((item) => (
            <div key={item.id} className="palette-item env-palette-item" title={item.id}>
              <div className="env-palette-item-main">
                <Typography.Text strong ellipsis className="palette-item-name">
                  {item.name}
                </Typography.Text>
                <Typography.Text type="secondary" ellipsis className="palette-item-id">
                  {Object.keys(item.values).length} 个变量
                </Typography.Text>
              </div>
              <Space size={0} className="env-palette-actions">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditEnv(item);
                  }}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteEnv(item);
                  }}
                />
              </Space>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={envModal?.editing ? '编辑环境' : '新建环境'}
        open={Boolean(envModal?.open)}
        onCancel={() => setEnvModal(null)}
        onOk={() => void saveEnv()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="环境名称" required>
            <Input
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder="例如 测试库"
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label={
              <Flex justify="space-between" style={{ width: '100%' }}>
                <span>键值对</span>
                <Button
                  type="link"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setKvRows((prev) => [
                      ...prev,
                      { key: `kv-${Date.now()}`, name: '', value: '' },
                    ])
                  }
                >
                  添加
                </Button>
              </Flex>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {kvRows.map((row) => (
                <Flex key={row.key} gap={8}>
                  <Input
                    placeholder="键"
                    value={row.name}
                    onChange={(e) =>
                      setKvRows((prev) =>
                        prev.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)),
                      )
                    }
                  />
                  <Input
                    placeholder="值"
                    value={row.value}
                    onChange={(e) =>
                      setKvRows((prev) =>
                        prev.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r)),
                      )
                    }
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setKvRows((prev) => prev.filter((r) => r.key !== row.key))}
                  />
                </Flex>
              ))}
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
