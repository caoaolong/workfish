import { useImperativeHandle, forwardRef, useState } from 'react';
import {
  Button,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Typography,
  App as AntdApp,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { MonitorCatalog, MonitorEnvLink, MonitorItem } from '@workfish/spec';
import { formatApiError, putMonitors } from '../api/client.js';

export type MonitorWallHandle = {
  openCreate: () => void;
};

type Props = {
  catalog: MonitorCatalog;
  onChanged: (next: MonitorCatalog) => Promise<void> | void;
};

type EnvRow = MonitorEnvLink & { key: string };

/** 根据 id 生成稳定封面色相 */
function coverStyleForId(id: string): { background: string; accent: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const h = hue > 250 && hue < 310 ? (hue + 80) % 360 : hue;
  return {
    background: `linear-gradient(145deg, hsl(${h} 42% 28%) 0%, hsl(${(h + 36) % 360} 48% 18%) 55%, hsl(${(h + 72) % 360} 36% 12%) 100%)`,
    accent: `hsl(${h} 55% 62%)`,
  };
}

function nameInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '#';
  }
  if (/[-_\s]/.test(trimmed)) {
    return trimmed
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 4);
  }
  const parts = trimmed.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g);
  if (parts && parts.length > 0) {
    return parts
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 4);
  }
  return trimmed.charAt(0).toUpperCase();
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

function emptyEnvRow(name = ''): EnvRow {
  return { key: newId('env'), name, url: '' };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function MonitorCard({
  item,
  onEdit,
  onDelete,
}: {
  item: MonitorItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cover = coverStyleForId(item.id);
  const mark = nameInitials(item.name) || '#';

  return (
    <article className="app-card monitor-card">
      <div className="app-card-cover" style={{ background: cover.background }}>
        <div className="app-card-cover-glow" style={{ background: cover.accent }} />
        <div className="app-card-cover-mark" aria-hidden>
          {mark}
        </div>
        <div className="app-card-cover-actions">
          <Button shape="circle" icon={<EditOutlined />} onClick={onEdit} title="编辑" />
          <Button
            shape="circle"
            danger
            icon={<DeleteOutlined />}
            onClick={onDelete}
            title="删除"
          />
        </div>
      </div>
      <div className="app-card-body">
        <Typography.Title level={5} ellipsis={{ rows: 1 }} className="app-card-title">
          {item.name}
        </Typography.Title>
        {item.description ? (
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 1 }} className="app-card-desc">
            {item.description}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type="secondary" className="app-card-id">
            {item.environments.length} 个环境
          </Typography.Text>
        )}
        <div className="monitor-card-envs">
          {item.environments.map((env) => (
            <Button
              key={`${env.name}-${env.url}`}
              size="small"
              className="monitor-card-env-btn"
              title={env.url}
              onClick={() => window.open(env.url, '_blank', 'noopener,noreferrer')}
            >
              {env.name}
            </Button>
          ))}
        </div>
      </div>
    </article>
  );
}

export const MonitorWall = forwardRef<MonitorWallHandle, Props>(function MonitorWall(
  { catalog, onChanged },
  ref,
) {
  const { message, modal } = AntdApp.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MonitorItem | undefined>(undefined);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>([emptyEnvRow()]);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(undefined);
    setName('');
    setDescription('');
    setEnvRows([emptyEnvRow('生产'), emptyEnvRow('测试')]);
    setModalOpen(true);
  };

  useImperativeHandle(ref, () => ({ openCreate }), []);

  const openEdit = (item: MonitorItem) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description ?? '');
    setEnvRows(
      item.environments.map((env, i) => ({
        key: `env-${i}-${env.name}`,
        name: env.name,
        url: env.url,
      })),
    );
    setModalOpen(true);
  };

  const persist = async (next: MonitorCatalog, closeModal: boolean) => {
    setSaving(true);
    try {
      const saved = await putMonitors(next);
      await onChanged(saved);
      message.success('监控已保存');
      if (closeModal) {
        setModalOpen(false);
      }
    } catch (e) {
      message.error(formatApiError(e));
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      message.warning('请填写名称');
      return;
    }

    const environments: MonitorEnvLink[] = [];
    const seenNames = new Set<string>();
    const seenUrls = new Set<string>();
    for (const row of envRows) {
      const envName = row.name.trim();
      const envUrl = row.url.trim();
      if (!envName && !envUrl) {
        continue;
      }
      if (!envName) {
        message.warning('请填写环境名称');
        return;
      }
      if (!envUrl || !isHttpUrl(envUrl)) {
        message.warning(`环境「${envName}」请填写独立的 http(s) 链接`);
        return;
      }
      const nameKey = envName.toLowerCase();
      if (seenNames.has(nameKey)) {
        message.warning(`环境名重复：${envName}`);
        return;
      }
      seenNames.add(nameKey);
      const urlKey = envUrl.replace(/\/+$/, '').toLowerCase();
      if (seenUrls.has(urlKey)) {
        message.warning(`各环境链接需互不相同：「${envName}」与其它环境重复`);
        return;
      }
      seenUrls.add(urlKey);
      environments.push({ name: envName, url: envUrl });
    }
    if (environments.length === 0) {
      message.warning('至少添加一个环境链接');
      return;
    }

    const desc = description.trim();
    const item: MonitorItem = {
      id: editing?.id ?? newId('mon'),
      name: trimmedName,
      environments,
      ...(desc ? { description: desc } : {}),
    };
    const next: MonitorCatalog = {
      version: 1,
      items: editing
        ? catalog.items.map((x) => (x.id === editing.id ? item : x))
        : [...catalog.items, item],
    };
    await persist(next, true);
  };

  const deleteItem = (item: MonitorItem) => {
    modal.confirm({
      title: '删除监控',
      content: `确定删除「${item.name}」吗？`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const next: MonitorCatalog = {
          version: 1,
          items: catalog.items.filter((x) => x.id !== item.id),
        };
        await persist(next, false);
      },
    });
  };

  return (
    <div className="app-wall">
      {catalog.items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无监控项目"
          style={{ marginTop: 64 }}
        >
          <Button type="primary" onClick={openCreate}>
            新建监控
          </Button>
        </Empty>
      ) : (
        <Row gutter={[12, 12]}>
          {catalog.items.map((item) => (
            <Col key={item.id} xs={12} sm={8} md={6} lg={6} xl={4} xxl={3}>
              <MonitorCard
                item={item}
                onEdit={() => openEdit(item)}
                onDelete={() => deleteItem(item)}
              />
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={editing ? '编辑监控' : '新建监控'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void saveItem()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="项目名称" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 Grafana"
              maxLength={64}
            />
          </Form.Item>
          <Form.Item label="描述">
            <Input.TextArea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
              maxLength={200}
            />
          </Form.Item>
          <Form.Item label="环境链接" required style={{ marginBottom: 8 }}>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              每个环境各自填写链接，地址需互不相同
            </Typography.Text>
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {envRows.map((row, index) => (
                <Flex key={row.key} gap={8}>
                  <Input
                    placeholder="环境名"
                    value={row.name}
                    onChange={(e) =>
                      setEnvRows((prev) =>
                        prev.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    style={{ width: 108 }}
                    maxLength={24}
                  />
                  <Input
                    placeholder={`环境「${row.name || index + 1}」的独立链接 https://…`}
                    value={row.url}
                    onChange={(e) =>
                      setEnvRows((prev) =>
                        prev.map((r) => (r.key === row.key ? { ...r, url: e.target.value } : r)),
                      )
                    }
                    spellCheck={false}
                    style={{ flex: 1 }}
                  />
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={envRows.length <= 1}
                    onClick={() => setEnvRows((prev) => prev.filter((r) => r.key !== row.key))}
                  />
                </Flex>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setEnvRows((prev) => [...prev, emptyEnvRow()])}
                block
              >
                添加环境
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
