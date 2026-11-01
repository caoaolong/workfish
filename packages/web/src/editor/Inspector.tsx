import { useState, type ReactNode } from 'react';
import {
  Alert,
  Descriptions,
  Empty,
  Flex,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  isCompatible,
  type EnvironmentCatalog,
  type EnvironmentItem,
  type FieldSpec,
  type NodeSpec,
} from '@workfish/spec';
import type { Edge, Node } from '@xyflow/react';
import { ParamFields, readInputValues } from './ParamFields.js';
import { SidebarSection } from './SidebarSection.js';
import type { WorkfishEdgeData, WorkfishNodeData } from './workflowMapper.js';

function fieldSummary(field: FieldSpec): string {
  if (field.type === 'array' && field.items) {
    return `array<${fieldSummary(field.items)}>`;
  }
  return field.type;
}

function FieldList({ fields }: { fields: Record<string, FieldSpec> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return <Typography.Text type="secondary">无</Typography.Text>;
  }
  return (
    <Space direction="vertical" size="small" style={{ width: '100%' }}>
      {entries.map(([name, field]) => (
        <div key={name}>
          <Typography.Text strong>{name}</Typography.Text>{' '}
          <Typography.Text code>{fieldSummary(field)}</Typography.Text>
          {field.optional ? <Tag style={{ marginLeft: 6 }}>可选</Tag> : null}
        </div>
      ))}
    </Space>
  );
}

type Props = {
  selectedNode: Node<WorkfishNodeData> | null;
  selectedEdge: Edge<WorkfishEdgeData> | null;
  nodes: Node<WorkfishNodeData>[];
  environments: EnvironmentCatalog;
  onNodeEnvChange: (
    nodeId: string,
    envId: string | undefined,
    nextInputs: Record<string, unknown> | undefined,
  ) => void;
  onParamsChange: (nodeId: string, values: Record<string, unknown> | undefined) => void;
};

function resolvePortSpec(
  node: Node<WorkfishNodeData>,
  port: string,
  kind: 'input' | 'output',
): FieldSpec | undefined {
  const spec = node.data.spec;
  if (!spec) {
    return undefined;
  }
  return kind === 'input' ? spec.inputs[port] : spec.outputs[port];
}

function readNodeEnvId(node: Node<WorkfishNodeData>): string | undefined {
  const raw = node.data.params?.envId;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  // 兼容旧的多选 envIds：取首项
  const ids = node.data.params?.envIds;
  if (Array.isArray(ids) && typeof ids[0] === 'string' && ids[0].trim()) {
    return ids[0].trim();
  }
  return undefined;
}

/** 将环境键值转为与 FieldSpec 大致相容的输入值 */
export function coerceEnvValue(raw: string, field: FieldSpec): unknown {
  const text = String(raw);
  switch (field.type) {
    case 'number': {
      const n = Number(text);
      return Number.isFinite(n) ? n : text;
    }
    case 'boolean': {
      const lower = text.trim().toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === 'no') {
        return false;
      }
      return text;
    }
    case 'null':
      return null;
    case 'array':
    case 'object':
    case 'any': {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
    default:
      return text;
  }
}

/**
 * 选择环境时：去掉与环境同名的手动输入，使检查器展示 <NAME:VALUE>；
 * 环境中不存在的键保留手动值。
 */
export function applyEnvToInputs(
  spec: NodeSpec,
  env: EnvironmentItem | undefined,
  current: Record<string, unknown>,
): { values: Record<string, unknown>; matchedKeys: string[] } {
  const values = { ...current };
  const matchedKeys: string[] = [];
  if (!env) {
    return { values, matchedKeys };
  }
  for (const name of Object.keys(spec.inputs)) {
    if (Object.prototype.hasOwnProperty.call(env.values, name)) {
      delete values[name];
      matchedKeys.push(name);
    }
  }
  return { values, matchedKeys };
}

/** 与环境同名且未手动覆盖（或值仍等于环境）的输入键 */
export function matchedKeysFromEnv(
  spec: NodeSpec,
  env: EnvironmentItem | undefined,
  values: Record<string, unknown>,
): string[] {
  if (!env) {
    return [];
  }
  const keys: string[] = [];
  for (const [name, field] of Object.entries(spec.inputs)) {
    if (!Object.prototype.hasOwnProperty.call(env.values, name)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      keys.push(name);
      continue;
    }
    const expected = coerceEnvValue(env.values[name]!, field);
    if (Object.is(values[name], expected) || String(values[name]) === String(env.values[name])) {
      keys.push(name);
    }
  }
  return keys;
}

type NodeSectionKey = 'info' | 'env' | 'inputs' | 'outputs';
type EdgeSectionKey = 'info' | 'types';

function InspectorShell({
  children,
  empty,
}: {
  children?: ReactNode;
  empty?: boolean;
}) {
  return (
    <aside className="editor-sidebar editor-sidebar-right">
      <Flex align="center" justify="space-between" className="sidebar-toolbar">
        <Typography.Title level={5} style={{ margin: 0 }}>
          检查器
        </Typography.Title>
      </Flex>
      {empty ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中节点或连线以查看详情" />
      ) : (
        <div className="sidebar-sections">{children}</div>
      )}
    </aside>
  );
}

export function Inspector({
  selectedNode,
  selectedEdge,
  nodes,
  environments,
  onNodeEnvChange,
  onParamsChange,
}: Props) {
  const [nodeOpenKeys, setNodeOpenKeys] = useState<NodeSectionKey[]>([
    'info',
    'env',
    'inputs',
    'outputs',
  ]);
  const [edgeOpenKeys, setEdgeOpenKeys] = useState<EdgeSectionKey[]>(['info', 'types']);

  const toggleNode = (key: NodeSectionKey) => {
    setNodeOpenKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const toggleEdge = (key: EdgeSectionKey) => {
    setEdgeOpenKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  if (!selectedNode && !selectedEdge) {
    return <InspectorShell empty />;
  }

  if (selectedNode) {
    const spec: NodeSpec | undefined = selectedNode.data.spec;
    const envId = readNodeEnvId(selectedNode);
    const inputValues = readInputValues(selectedNode.data.params);
    const selectedEnv = envId ? environments.items.find((i) => i.id === envId) : undefined;
    const envMissing = Boolean(envId && !selectedEnv);
    const envOptions = environments.items.map((i) => ({ value: i.id, label: i.name }));
    const inputCount = spec ? Object.keys(spec.inputs).length : 0;
    const outputCount = spec ? Object.keys(spec.outputs).length : 0;

    return (
      <InspectorShell>
        <SidebarSection
          title="基本信息"
          open={nodeOpenKeys.includes('info')}
          onToggle={() => toggleNode('info')}
        >
          <Descriptions size="small" column={1} style={{ marginBottom: 0 }}>
            <Descriptions.Item label="名称">{selectedNode.data.label}</Descriptions.Item>
            <Descriptions.Item label="类型 ID">
              <Typography.Text code>{selectedNode.data.typeId}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="实例 ID">
              <Typography.Text code>{selectedNode.id}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          {selectedNode.data.missingCatalog ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="目录中找不到此节点类型，连线校验可能失败。"
            />
          ) : null}
          {!spec ? (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              无规格信息
            </Typography.Text>
          ) : null}
        </SidebarSection>

        {spec ? (
          <>
            <SidebarSection
              title="环境（可选）"
              open={nodeOpenKeys.includes('env')}
              onToggle={() => toggleNode('env')}
            >
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                placeholder={environments.items.length === 0 ? '暂无环境' : '选择环境'}
                disabled={environments.items.length === 0}
                status={envMissing ? 'warning' : undefined}
                value={envId}
                options={envOptions}
                onChange={(v) => {
                  const env =
                    typeof v === 'string' ? environments.items.find((i) => i.id === v) : undefined;
                  const { values } = applyEnvToInputs(spec, env, inputValues);
                  onNodeEnvChange(
                    selectedNode.id,
                    typeof v === 'string' ? v : undefined,
                    Object.keys(values).length > 0 ? values : undefined,
                  );
                }}
              />
              {envMissing ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={`找不到环境「${envId}」，请重新选择或清空。`}
                />
              ) : null}
            </SidebarSection>

            <SidebarSection
              title={`输入（${inputCount}）`}
              open={nodeOpenKeys.includes('inputs')}
              onToggle={() => toggleNode('inputs')}
            >
              <ParamFields
                key={`${selectedNode.id}:${envId ?? ''}`}
                spec={spec}
                values={inputValues}
                envValues={selectedEnv?.values}
                onChange={(v) => onParamsChange(selectedNode.id, v)}
              />
            </SidebarSection>

            <SidebarSection
              title={`输出（${outputCount}）`}
              open={nodeOpenKeys.includes('outputs')}
              onToggle={() => toggleNode('outputs')}
            >
              <FieldList fields={spec.outputs} />
            </SidebarSection>
          </>
        ) : null}
      </InspectorShell>
    );
  }

  if (selectedEdge) {
    const sourceNode = nodes.find((n) => n.id === selectedEdge.source);
    const targetNode = nodes.find((n) => n.id === selectedEdge.target);
    const sourcePort = selectedEdge.sourceHandle ?? selectedEdge.data?.sourcePort ?? '';
    const targetPort = selectedEdge.targetHandle ?? selectedEdge.data?.targetPort ?? '';
    const sourceField =
      sourceNode && sourcePort ? resolvePortSpec(sourceNode, sourcePort, 'output') : undefined;
    const targetField =
      targetNode && targetPort ? resolvePortSpec(targetNode, targetPort, 'input') : undefined;
    const compatible =
      sourceField && targetField ? isCompatible(sourceField, targetField) : false;

    return (
      <InspectorShell>
        <SidebarSection
          title="连线"
          open={edgeOpenKeys.includes('info')}
          onToggle={() => toggleEdge('info')}
        >
          <Descriptions size="small" column={1}>
            <Descriptions.Item label="源">
              {sourceNode?.data.label ?? selectedEdge.source} ·{' '}
              <Typography.Text code>{sourcePort || '—'}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="目标">
              {targetNode?.data.label ?? selectedEdge.target} ·{' '}
              <Typography.Text code>{targetPort || '—'}</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        </SidebarSection>

        <SidebarSection
          title="类型"
          open={edgeOpenKeys.includes('types')}
          onToggle={() => toggleEdge('types')}
        >
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            输出：
            <Typography.Text code>
              {sourceField ? fieldSummary(sourceField) : '未知'}
            </Typography.Text>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            输入：
            <Typography.Text code>
              {targetField ? fieldSummary(targetField) : '未知'}
            </Typography.Text>
          </Typography.Paragraph>
          {sourceField && targetField ? (
            <Tag color={compatible ? 'success' : 'error'}>
              {compatible ? '类型兼容' : '类型不兼容'}
            </Tag>
          ) : (
            <Tag>无法校验（缺少端口或规格）</Tag>
          )}
        </SidebarSection>
      </InspectorShell>
    );
  }

  return null;
}
