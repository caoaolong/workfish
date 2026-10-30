import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Tree,
  Typography,
  App as AntdApp,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog, EnvironmentGroup, EnvironmentItem } from '@workfish/spec';
import { formatApiError, putEnvironments } from '../api/client.js';

export type EnvPanelHandle = {
  openCreateGroup: () => void;
};

type Props = {
  catalog: EnvironmentCatalog;
  onChanged: (next: EnvironmentCatalog) => Promise<void> | void;
};

type KvRow = { key: string; name: string; value: string };

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function TreeTitle({
  label,
  hint,
  actions,
}: {
  label: ReactNode;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="sidebar-tree-title">
      <div className="sidebar-tree-title-main">
        <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
          {label}
        </Typography.Text>
        {hint ? (
          <Typography.Text type="secondary" className="sidebar-tree-hint">
            {hint}
          </Typography.Text>
        ) : null}
      </div>
      {actions ? <Space size={0} className="sidebar-tree-actions">{actions}</Space> : null}
    </div>
  );
}

export const EnvPanel = forwardRef<EnvPanelHandle, Props>(function EnvPanel(
  { catalog, onChanged },
  ref,
) {
  const { message, modal } = AntdApp.useApp();
  const [groupModal, setGroupModal] = useState<{ open: boolean; editing?: EnvironmentGroup }>({
    open: false,
  });
  const [envModal, setEnvModal] = useState<{
    open: boolean;
    groupId: string;
    editing?: EnvironmentItem;
  } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [envName, setEnvName] = useState('');
  const [kvRows, setKvRows] = useState<KvRow[]>([]);
  const [saving, setSaving] = useState(false);

  const byGroup = useMemo(() => {
    const map = new Map<string, EnvironmentItem[]>();
    for (const g of catalog.groups) {
      map.set(g.id, []);
    }
    for (const item of catalog.items) {
      const list = map.get(item.groupId) ?? [];
      list.push(item);
      map.set(item.groupId, list);
    }
    return map;
  }, [catalog]);

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

  const openCreateGroup = () => {
    setGroupName('');
    setGroupModal({ open: true });
  };

  useImperativeHandle(ref, () => ({ openCreateGroup }), []);

  const openEditGroup = (g: EnvironmentGroup) => {
    setGroupName(g.name);
    setGroupModal({ open: true, editing: g });
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name) {
      message.warning('请填写分组名称');
      return;
    }
    const editing = groupModal.editing;
    const next: EnvironmentCatalog = {
      ...catalog,
      groups: editing
        ? catalog.groups.map((g) => (g.id === editing.id ? { ...g, name } : g))
        : [...catalog.groups, { id: newId('grp'), name }],
    };
    await persist(next);
    setGroupModal({ open: false });
  };

  const deleteGroup = (g: EnvironmentGroup) => {
    modal.confirm({
      title: '删除分组',
      content: `确定删除分组「${g.name}」及其下全部环境吗？`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const next: EnvironmentCatalog = {
          version: 1,
          groups: catalog.groups.filter((x) => x.id !== g.id),
          items: catalog.items.filter((x) => x.groupId !== g.id),
        };
        await persist(next);
      },
    });
  };

  const openCreateEnv = (groupId: string) => {
    setEnvName('');
    setKvRows([{ key: `kv-${Date.now()}`, name: '', value: '' }]);
    setEnvModal({ open: true, groupId });
  };

  const openEditEnv = (item: EnvironmentItem) => {
    setEnvName(item.name);
    setKvRows(
      Object.entries(item.values).map(([name, value], i) => ({
        key: `kv-${i}-${name}`,
        name,
        value,
      })),
    );
    setEnvModal({ open: true, groupId: item.groupId, editing: item });
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
      : { id: newId('env'), groupId: envModal.groupId, name, values };
    const next: EnvironmentCatalog = {
      version: 1,
      groups: catalog.groups,
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
          groups: catalog.groups,
          items: catalog.items.filter((x) => x.id !== item.id),
        };
        await persist(next);
      },
    });
  };

  const treeData: DataNode[] = catalog.groups.map((g) => {
    const items = byGroup.get(g.id) ?? [];
    return {
      key: `group:${g.id}`,
      title: (
        <TreeTitle
          label={<Typography.Text strong>{g.name}</Typography.Text>}
          hint={`${items.length} 个环境`}
          actions={
            <>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                title="新建环境"
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateEnv(g.id);
                }}
              />
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditGroup(g);
                }}
              />
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteGroup(g);
                }}
              />
            </>
          }
        />
      ),
      children:
        items.length === 0
          ? [
              {
                key: `group:${g.id}:empty`,
                isLeaf: true,
                selectable: false,
                title: (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    暂无环境
                  </Typography.Text>
                ),
              },
            ]
          : items.map((item) => ({
              key: `env:${item.id}`,
              isLeaf: true,
              selectable: false,
              title: (
                <TreeTitle
                  label={item.name}
                  hint={`${Object.keys(item.values).length} 个变量`}
                  actions={
                    <>
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
                    </>
                  }
                />
              ),
            })),
    };
  });

  return (
    <div className="sidebar-panel-body">
      {catalog.groups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无环境分组" />
      ) : (
        <Tree
          key={[...catalog.groups.map((g) => g.id), ...catalog.items.map((i) => i.id)].join('|')}
          className="sidebar-tree"
          blockNode
          defaultExpandAll
          selectable={false}
          treeData={treeData}
        />
      )}

      <Modal
        title={groupModal.editing ? '编辑分组' : '新建分组'}
        open={groupModal.open}
        onCancel={() => setGroupModal({ open: false })}
        onOk={() => void saveGroup()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="分组名称" required>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如 项目A"
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={envModal?.editing ? '编辑环境' : '新建环境'}
        open={Boolean(envModal?.open)}
        onCancel={() => setEnvModal(null)}
        onOk={() => void saveEnv()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
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
                  <Input.Password
                    placeholder="值"
                    visibilityToggle
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
