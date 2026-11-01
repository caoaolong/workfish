import { useCallback, useState } from 'react';
import { Button, Input, Modal, Space, Tag, Tooltip, Typography, App as AntdApp } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useEditorNodeActions } from './EditorNodeActionsContext.js';
import { readInputValues } from './ParamFields.js';
import type { WorkfishNodeData } from './workflowMapper.js';

function readNodeEnvId(params: Record<string, unknown> | undefined): string | undefined {
  const raw = params?.envId;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  const ids = params?.envIds;
  if (Array.isArray(ids) && typeof ids[0] === 'string' && ids[0].trim()) {
    return ids[0].trim();
  }
  return undefined;
}

function fieldTypeLabel(type: string): string {
  return type;
}

export function WorkfishNode({ id, data, selected }: NodeProps<Node<WorkfishNodeData>>) {
  const { setNodes, deleteElements } = useReactFlow();
  const { modal } = AntdApp.useApp();
  const nodeActions = useEditorNodeActions();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(data.label);
  const canRun = Boolean(nodeActions && data.spec && !data.missingCatalog);
  const runStatus = nodeActions?.runStatusByNodeId[id] ?? 'idle';
  const runClass =
    runStatus === 'running'
      ? ' wf-node-run-running'
      : runStatus === 'ok'
        ? ' wf-node-run-ok'
        : runStatus === 'error'
          ? ' wf-node-run-error'
          : ' wf-node-run-idle';
  const inputs = data.spec ? Object.entries(data.spec.inputs) : [];
  const outputs = data.spec ? Object.entries(data.spec.outputs) : [];
  const inputNames = new Set(inputs.map(([name]) => name));
  const outputNames = new Set(outputs.map(([name]) => name));
  const pairedPorts =
    inputs.length > 0 &&
    outputs.length > 0 &&
    inputs.length === outputs.length &&
    inputs.every(([name]) => outputNames.has(name));
  const unpairedOutputs = pairedPorts
    ? []
    : outputs.filter(([name]) => !inputNames.has(name));
  const unpairedInputs = pairedPorts ? [] : inputs;

  const openRename = useCallback(() => {
    setRenameValue(data.label);
    setRenameOpen(true);
  }, [data.label]);

  const applyRename = useCallback(() => {
    const next = renameValue.trim();
    if (!next) {
      return;
    }
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                label: next,
              },
            }
          : n,
      ),
    );
    setRenameOpen(false);
  }, [id, renameValue, setNodes]);

  const handleDelete = useCallback(() => {
    modal.confirm({
      title: '删除节点',
      content: `确定删除「${data.label}」及其相关连线吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        deleteElements({ nodes: [{ id }] });
      },
    });
  }, [data.label, deleteElements, id, modal]);

  const handleRun = useCallback(() => {
    if (!nodeActions || !data.spec) {
      return;
    }
    const inputs = readInputValues(data.params);
    nodeActions.requestRun({
      instanceId: id,
      id: data.typeId,
      name: data.label,
      spec: data.spec,
      envId: readNodeEnvId(data.params),
      ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    });
  }, [data.label, data.params, data.spec, data.typeId, id, nodeActions]);

  const handleStop = useCallback(() => {
    nodeActions?.stopRun(id);
  }, [id, nodeActions]);

  const isRunning = runStatus === 'running';

  return (
    <>
      <NodeToolbar
        isVisible={selected || isRunning}
        position={Position.Top}
        offset={8}
        className="wf-node-toolbar"
        align="center"
      >
        <Space size={4} className="wf-node-toolbar-inner nodrag nopan">
          {isRunning ? (
            <Tooltip title="中断">
              <Button
                type="text"
                size="small"
                danger
                className="nodrag nopan"
                icon={<StopOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStop();
                }}
              />
            </Tooltip>
          ) : (
            <Tooltip title={canRun ? '运行' : '无法运行（节点类型不可用）'}>
              <Button
                type="text"
                size="small"
                className="nodrag nopan"
                icon={<PlayCircleOutlined />}
                disabled={!canRun}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRun();
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="重命名">
            <Button
              type="text"
              size="small"
              className="nodrag nopan"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                openRename();
              }}
            />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              type="text"
              size="small"
              danger
              className="nodrag nopan"
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
            />
          </Tooltip>
        </Space>
      </NodeToolbar>

      <div
        className={`wf-node${runClass}${selected ? ' selected' : ''}${data.missingCatalog ? ' wf-node-warn' : ''}`}
      >
        <div className="wf-node-header">
          <div className="wf-node-title-block">
            <Typography.Text className="wf-node-title" strong>
              {data.label}
            </Typography.Text>
            <Typography.Text className="wf-node-id" type="secondary">
              {data.typeId}
            </Typography.Text>
          </div>
          {data.missingCatalog ? (
            <Tag color="warning" className="wf-node-badge">
              缺失
            </Tag>
          ) : null}
        </div>

        {(inputs.length > 0 || outputs.length > 0) && <div className="wf-node-divider" />}

        {pairedPorts ? (
          <div className="wf-node-section">
            <div className="wf-node-section-label">字段</div>
            {inputs.map(([name, field]) => (
              <div key={name} className="wf-port-row wf-port-row-io">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={name}
                  className="wf-handle wf-handle-in"
                />
                <span className="wf-port-name">{name}</span>
                <span className="wf-port-type">{fieldTypeLabel(field.type)}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={name}
                  className="wf-handle wf-handle-out"
                />
              </div>
            ))}
          </div>
        ) : null}

        {unpairedInputs.length > 0 ? (
          <div className="wf-node-section">
            <div className="wf-node-section-label">输入</div>
            {unpairedInputs.map(([name, field]) => (
              <div key={name} className="wf-port-row wf-port-row-in">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={name}
                  className="wf-handle wf-handle-in"
                />
                <span className="wf-port-name">{name}</span>
                <span className="wf-port-type">{fieldTypeLabel(field.type)}</span>
              </div>
            ))}
          </div>
        ) : null}

        {!pairedPorts && outputs.length > 0 ? (
          <div className="wf-node-section">
            <div className="wf-node-section-label">输出</div>
            {(unpairedOutputs.length > 0 ? unpairedOutputs : outputs).map(([name, field]) => (
              <div key={name} className="wf-port-row wf-port-row-out">
                <span className="wf-port-type">{fieldTypeLabel(field.type)}</span>
                <span className="wf-port-name">{name}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={name}
                  className="wf-handle wf-handle-out"
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Modal
        title="重命名节点"
        open={renameOpen}
        onOk={applyRename}
        onCancel={() => setRenameOpen(false)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={applyRename}
          maxLength={64}
          placeholder="节点显示名称"
          autoFocus
        />
      </Modal>
    </>
  );
}
