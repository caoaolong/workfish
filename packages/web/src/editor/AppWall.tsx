import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Empty,
  Row,
  Tag,
  Typography,
  App as AntdApp,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog, NodeSpec } from '@workfish/spec';
import type { NodeCatalogItem } from '../types.js';
import { deleteNode, formatApiError, putNodeMeta } from '../api/client.js';
import { MetaEditorModal } from './MetaEditorModal.js';
import { NodeRunModal } from './NodeRunModal.js';

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
  environments: EnvironmentCatalog;
  onChanged: () => Promise<void> | void;
};

/** 根据节点 id 生成稳定封面色相，避免依赖外部图片资源 */
function coverStyleForId(id: string): { background: string; accent: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  // 避开偏紫区间，用青绿 / 琥珀 / 蓝绿系
  const h = hue > 250 && hue < 310 ? (hue + 80) % 360 : hue;
  return {
    background: `linear-gradient(145deg, hsl(${h} 42% 28%) 0%, hsl(${(h + 36) % 360} 48% 18%) 55%, hsl(${(h + 72) % 360} 36% 12%) 100%)`,
    accent: `hsl(${h} 55% 62%)`,
  };
}

/** 驼峰 / kebab / snake 名称取各段首字母，如 WordFix → WF，word-fix → WF */
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

function NodeCard({
  item,
  onRun,
  onEdit,
  onDelete,
}: {
  item: NodeCatalogItem;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isReady = item.status === 'ready' && item.spec;
  const spec = item.spec;
  const title = spec?.name ?? item.id;
  const cover = coverStyleForId(item.id);
  // 优先用展示名的驼峰缩写；无多段时回退到 id（如 word-fix → WF）
  const mark = nameInitials(title) || nameInitials(item.id) || '#';

  return (
    <article className={`app-card${isReady ? '' : ' is-error'}`}>
      <div className="app-card-cover" style={{ background: cover.background }}>
        <div className="app-card-cover-glow" style={{ background: cover.accent }} />
        <div className="app-card-cover-mark" aria-hidden>
          {mark}
        </div>
        <div className="app-card-cover-badges">
          <Tag color={isReady ? 'success' : 'error'}>{isReady ? '就绪' : '异常'}</Tag>
          <Tag>{item.runtime}</Tag>
        </div>
        <div className="app-card-cover-actions">
          <Button
            type="primary"
            shape="round"
            icon={<PlayCircleOutlined />}
            disabled={!isReady}
            onClick={onRun}
          >
            运行
          </Button>
          <Button
            shape="circle"
            icon={<EditOutlined />}
            onClick={onEdit}
            title="编辑元信息（名称 / 输入 / 输出等）"
          />
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
          {title}
        </Typography.Title>
        <Typography.Text type="secondary" ellipsis className="app-card-id">
          {item.id}
          {spec?.version ? ` · v${spec.version}` : ''}
        </Typography.Text>
        {spec?.description ? (
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 1 }} className="app-card-desc">
            {spec.description}
          </Typography.Paragraph>
        ) : null}
        {!isReady && item.errors && item.errors.length > 0 ? (
          <Alert
            type="error"
            showIcon
            className="app-card-alert"
            message="脚本存在问题"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {item.errors.slice(0, 2).map((e, i) => (
                  <li key={i}>
                    <Typography.Text code>{e.path || '—'}</Typography.Text> {e.message}
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
      </div>
    </article>
  );
}

export function AppWall({ ready, problems, environments, onChanged }: Props) {
  const { message, modal } = AntdApp.useApp();
  const [runTarget, setRunTarget] = useState<NodeCatalogItem | null>(null);
  const [editTarget, setEditTarget] = useState<NodeCatalogItem | null>(null);

  const all = useMemo(() => [...ready, ...problems], [ready, problems]);

  const editInitialSpec = useMemo((): NodeSpec | null => {
    if (!editTarget) {
      return null;
    }
    if (editTarget.spec) {
      return editTarget.spec;
    }
    // 异常脚本无可用 spec 时，仍允许从空输入/输出开始编辑并写回 meta
    return {
      id: editTarget.id,
      name: editTarget.id,
      version: '0.1.0',
      inputs: {},
      outputs: {},
    };
  }, [editTarget]);

  const handleEditSave = async (meta: NodeSpec) => {
    if (!editTarget) {
      return;
    }
    try {
      await putNodeMeta(editTarget.id, meta);
      message.success('脚本元信息已保存');
      setEditTarget(null);
      await onChanged();
    } catch (e) {
      throw new Error(formatApiError(e));
    }
  };

  const handleDelete = (item: NodeCatalogItem) => {
    modal.confirm({
      title: '删除脚本',
      content: `确定删除脚本「${item.spec?.name ?? item.id}」（${item.id}）吗？该操作将删除 nodes/${item.id} 整个目录。`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteNode(item.id);
          message.success('已删除');
          await onChanged();
        } catch (e) {
          message.error(formatApiError(e));
          throw e;
        }
      },
    });
  };

  if (all.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无脚本" style={{ marginTop: 64 }} />;
  }

  return (
    <div className="app-wall">
      <Row gutter={[12, 12]}>
        {all.map((item) => (
          <Col key={item.id} xs={12} sm={8} md={6} lg={6} xl={4} xxl={3}>
            <NodeCard
              item={item}
              onRun={() => setRunTarget(item)}
              onEdit={() => setEditTarget(item)}
              onDelete={() => handleDelete(item)}
            />
          </Col>
        ))}
      </Row>

      <NodeRunModal
        target={
          runTarget
            ? { id: runTarget.id, name: runTarget.spec?.name, spec: runTarget.spec }
            : null
        }
        environments={environments}
        open={Boolean(runTarget)}
        onClose={() => setRunTarget(null)}
      />

      <MetaEditorModal
        open={Boolean(editTarget)}
        initial={editInitialSpec}
        onCancel={() => setEditTarget(null)}
        onSave={handleEditSave}
      />
    </div>
  );
}
