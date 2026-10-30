import { Alert, Descriptions, Empty, Select, Space, Tag, Typography } from 'antd';
import {
  isCompatible,
  type EnvironmentCatalog,
  type FieldSpec,
  type NodeSpec,
  type TypeDef,
} from '@workfish/spec';
import type { Edge, Node } from '@xyflow/react';
import { isBuiltinStructNode, readStructTypeRef } from './builtinNodes.js';
import type { WorkfishEdgeData, WorkfishNodeData } from './workflowMapper.js';

function fieldSummary(field: FieldSpec): string {
  if (field.type === 'ref' && field.ref) {
    return `ref:${field.ref}`;
  }
  if (field.type === 'array' && field.items) {
    return `array<${fieldSummary(field.items)}>`;
  }
  return field.type;
}

function FieldBlock({ title, fields }: { title: string; fields: Record<string, FieldSpec> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return (
      <div>
        <Typography.Title level={5} style={{ fontSize: 14 }}>
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">无</Typography.Text>
      </div>
    );
  }
  return (
    <div>
      <Typography.Title level={5} style={{ fontSize: 14 }}>
        {title}
      </Typography.Title>
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        {entries.map(([name, field]) => (
          <div key={name}>
            <Typography.Text strong>{name}</Typography.Text>{' '}
            <Typography.Text code>{fieldSummary(field)}</Typography.Text>
            {field.optional ? <Tag style={{ marginLeft: 6 }}>可选</Tag> : null}
            {field.description ? (
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12 }}>
                {field.description}
              </Typography.Paragraph>
            ) : null}
          </div>
        ))}
      </Space>
    </div>
  );
}

type Props = {
  selectedNode: Node<WorkfishNodeData> | null;
  selectedEdge: Edge<WorkfishEdgeData> | null;
  nodes: Node<WorkfishNodeData>[];
  typesMap: Map<string, TypeDef>;
  environments: EnvironmentCatalog;
  onEnvBindingChange: (nodeId: string, key: string, envId: string | undefined) => void;
  onNodeEnvIdsChange: (nodeId: string, envIds: string[]) => void;
  onStructTypeChange: (nodeId: string, typeRef: string | undefined) => void;
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

function readEnvBindings(node: Node<WorkfishNodeData>): Record<string, string> {
  const raw = node.data.params?.envBindings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      out[k] = v;
    } else if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
      // 兼容曾误存为数组的数据，取首项
      out[k] = v[0];
    }
  }
  return out;
}

function readNodeEnvIds(node: Node<WorkfishNodeData>): string[] {
  const raw = node.data.params?.envIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
}

export function Inspector({
  selectedNode,
  selectedEdge,
  nodes,
  typesMap,
  environments,
  onEnvBindingChange,
  onNodeEnvIdsChange,
  onStructTypeChange,
}: Props) {
  if (!selectedNode && !selectedEdge) {
    return (
      <aside className="editor-sidebar editor-sidebar-right">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          检查器
        </Typography.Title>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选中节点或连线以查看详情" />
      </aside>
    );
  }

  if (selectedNode) {
    const spec: NodeSpec | undefined = selectedNode.data.spec;
    const envReqs = spec?.environments ?? [];
    const bindings = readEnvBindings(selectedNode);
    const nodeEnvIds = readNodeEnvIds(selectedNode);
    const isStruct = isBuiltinStructNode(selectedNode.data.typeId);
    const isScriptNode = !isStruct;
    const typeRef = readStructTypeRef(selectedNode.data.params);
    const typeMissing = Boolean(typeRef && !typesMap.has(typeRef));
    const typeOptions = [...typesMap.values()].map((t) => ({
      value: t.id,
      label: `${t.name}（${t.id}）`,
    }));
    const envOptions = environments.groups.map((g) => ({
      label: g.name,
      options: environments.items
        .filter((i) => i.groupId === g.id)
        .map((i) => ({ value: i.id, label: i.name })),
    }));

    return (
      <aside className="editor-sidebar editor-sidebar-right">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          节点
        </Typography.Title>
        <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
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
            style={{ marginBottom: 12 }}
            message="目录中找不到此节点类型，连线校验可能失败。"
          />
        ) : null}
        {isStruct ? (
          <div style={{ marginBottom: 16 }}>
            <Typography.Title level={5} style={{ fontSize: 14 }}>
              绑定数据结构
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              选择后按字段生成左侧输入、右侧输出连接桩。
            </Typography.Paragraph>
            <Select
              style={{ width: '100%' }}
              placeholder="选择数据结构"
              allowClear
              showSearch
              optionFilterProp="label"
              status={typeMissing || !typeRef ? 'warning' : undefined}
              value={typeRef}
              options={typeOptions}
              onChange={(v) => onStructTypeChange(selectedNode.id, v)}
            />
            {typeMissing ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message={`找不到类型「${typeRef}」，请重新选择。`}
              />
            ) : null}
            {!typeRef ? (
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                尚未选择，节点暂无连接桩。
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
        {isScriptNode ? (
          <div style={{ marginBottom: 16 }}>
            <Typography.Title level={5} style={{ fontSize: 14 }}>
              当前环境
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              为该脚本节点选择运行时使用的环境（可多选）。
            </Typography.Paragraph>
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              style={{ width: '100%' }}
              placeholder={
                environments.items.length === 0 ? '暂无可用环境，请先在左侧创建' : '选择环境'
              }
              disabled={environments.items.length === 0}
              value={nodeEnvIds}
              options={envOptions}
              onChange={(v) => onNodeEnvIdsChange(selectedNode.id, v)}
            />
          </div>
        ) : null}
        {spec ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {spec.description ? (
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                {spec.description}
              </Typography.Paragraph>
            ) : null}

            {envReqs.length > 0 ? (
              <div>
                <Typography.Title level={5} style={{ fontSize: 14 }}>
                  环境槽位绑定
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  该脚本声明了命名槽位，请为每个槽位指定一个环境。
                </Typography.Paragraph>
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  {envReqs.map((req) => {
                    const bound = bindings[req.key];
                    const missing = !bound;
                    return (
                      <div key={req.key}>
                        <Typography.Text strong>{req.name}</Typography.Text>{' '}
                        <Typography.Text code type="secondary">
                          {req.key}
                        </Typography.Text>
                        {req.description ? (
                          <Typography.Paragraph
                            type="secondary"
                            style={{ margin: '2px 0 6px', fontSize: 12 }}
                          >
                            {req.description}
                          </Typography.Paragraph>
                        ) : (
                          <div style={{ height: 6 }} />
                        )}
                        <Select
                          style={{ width: '100%' }}
                          placeholder="选择环境"
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          status={missing ? 'warning' : undefined}
                          value={bound}
                          options={envOptions}
                          onChange={(v) => onEnvBindingChange(selectedNode.id, req.key, v)}
                        />
                      </div>
                    );
                  })}
                </Space>
              </div>
            ) : null}

            <FieldBlock title="输入" fields={spec.inputs} />
            <FieldBlock title="输出" fields={spec.outputs} />
          </Space>
        ) : (
          <Typography.Text type="secondary">无规格信息</Typography.Text>
        )}
      </aside>
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
      sourceField && targetField ? isCompatible(sourceField, targetField, typesMap) : false;

    return (
      <aside className="editor-sidebar editor-sidebar-right">
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          连线
        </Typography.Title>
        <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
          <Descriptions.Item label="源">
            {sourceNode?.data.label ?? selectedEdge.source} ·{' '}
            <Typography.Text code>{sourcePort || '—'}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="目标">
            {targetNode?.data.label ?? selectedEdge.target} ·{' '}
            <Typography.Text code>{targetPort || '—'}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        <Typography.Title level={5} style={{ fontSize: 14 }}>
          类型
        </Typography.Title>
        <Typography.Paragraph>
          输出：<Typography.Text code>{sourceField ? fieldSummary(sourceField) : '未知'}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Paragraph>
          输入：<Typography.Text code>{targetField ? fieldSummary(targetField) : '未知'}</Typography.Text>
        </Typography.Paragraph>
        {sourceField && targetField ? (
          <Tag color={compatible ? 'success' : 'error'}>{compatible ? '类型兼容' : '类型不兼容'}</Tag>
        ) : (
          <Tag>无法校验（缺少端口或规格）</Tag>
        )}
      </aside>
    );
  }

  return null;
}
