import { isCompatible, type NodeSpec } from '@workfish/spec';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useImperativeHandle, useMemo, forwardRef } from 'react';
import { useTheme } from '../theme.js';
import { WorkfishNode } from './WorkfishNode.js';
import { paletteDragMime } from './NodePalette.js';
import {
  WORKFISH_NODE_TYPE,
  documentToFlow,
  filterEdgesForNodeSpecs,
  newEdgeId,
  newNodeId,
  type WorkfishEdgeData,
  type WorkfishNodeData,
} from './workflowMapper.js';
import type { WorkflowDocument } from '../types.js';

const nodeTypes = { [WORKFISH_NODE_TYPE]: WorkfishNode };

export type WorkflowCanvasRef = {
  getViewport: () => Viewport;
  patchNodeData: (
    nodeId: string,
    updater: (data: WorkfishNodeData) => WorkfishNodeData,
  ) => void;
};

type InnerProps = {
  document: WorkflowDocument;
  specByTypeId: Map<string, NodeSpec>;
  onDocumentChange: (nodes: Node<WorkfishNodeData>[], edges: Edge<WorkfishEdgeData>[]) => void;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
  onToast: (message: string) => void;
  resetKey: string;
};

const WorkflowCanvasInner = forwardRef<WorkflowCanvasRef, InnerProps>(function WorkflowCanvasInner(
  {
    document,
    specByTypeId,
    onDocumentChange,
    onSelectionChange,
    onToast,
    resetKey,
  },
  ref,
) {
  const initial = useMemo(
    () => documentToFlow(document, specByTypeId),
    // resetKey 变化时强制从文档重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resetKey],
  );

  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const { screenToFlowPosition, getViewport } = useReactFlow();

  useImperativeHandle(
    ref,
    () => ({
      getViewport,
      patchNodeData: (nodeId, updater) => {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: updater(n.data),
                }
              : n,
          ),
        );
      },
    }),
    [getViewport, setNodes],
  );

  useEffect(() => {
    const { nodes: n, edges: e } = documentToFlow(document, specByTypeId);
    setNodes(n);
    setEdges(e);
  }, [resetKey, document, setNodes, setEdges, specByTypeId]);

  useEffect(() => {
    setNodes((nds) => {
      const nextNodes = nds.map((node) => {
        const { typeId } = node.data;
        const spec = specByTypeId.get(typeId);
        const missingCatalog = !spec;
        return {
          ...node,
          data: {
            ...node.data,
            // 保留画布上的显示名（含用户重命名），只同步 catalog 规格
            spec,
            missingCatalog,
          },
        };
      });
      setEdges((eds) => filterEdgesForNodeSpecs(eds, nextNodes));
      return nextNodes;
    });
  }, [specByTypeId, setNodes, setEdges]);

  useEffect(() => {
    onDocumentChange(nodes, edges);
  }, [nodes, edges, onDocumentChange]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceHandle = connection.sourceHandle;
      const targetHandle = connection.targetHandle;
      if (!connection.source || !connection.target || !sourceHandle || !targetHandle) {
        return false;
      }
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode?.data.spec || !targetNode?.data.spec) {
        return false;
      }
      const outField = sourceNode.data.spec.outputs[sourceHandle];
      const inField = targetNode.data.spec.inputs[targetHandle];
      if (!outField || !inField) {
        return false;
      }
      const edgeId = 'id' in connection ? connection.id : undefined;
      const duplicateInput = edges.some(
        (e) =>
          e.target === connection.target &&
          e.targetHandle === connection.targetHandle &&
          e.id !== edgeId,
      );
      if (duplicateInput) {
        return false;
      }
      return isCompatible(outField, inField);
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) {
        onToast('连线不完整：需要选择源/目标端口');
        return;
      }
      const duplicateInput = edges.some(
        (e) => e.target === target && e.targetHandle === targetHandle,
      );
      if (duplicateInput) {
        onToast('每个输入端口最多只能有一条入边');
        return;
      }
      if (!isValidConnection(connection)) {
        onToast('类型不兼容，无法连接');
        return;
      }
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: newEdgeId(),
            data: { sourcePort: sourceHandle, targetPort: targetHandle },
          },
          eds,
        ),
      );
    },
    [edges, isValidConnection, onToast, setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const typeId = e.dataTransfer.getData(paletteDragMime());
      if (!typeId) {
        return;
      }
      const baseSpec = specByTypeId.get(typeId);
      if (!baseSpec) {
        onToast('无法添加：节点不在可用目录中');
        return;
      }
      const spec = baseSpec;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node: Node<WorkfishNodeData> = {
        id: newNodeId(),
        type: WORKFISH_NODE_TYPE,
        position,
        data: {
          typeId,
          label: spec.name,
          spec,
          missingCatalog: false,
        },
      };
      setNodes((nds) => nds.concat(node));
    },
    [onToast, screenToFlowPosition, setNodes, specByTypeId],
  );

  return (
    <div className="workflow-canvas" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        onSelectionChange={onSelectionChange}
        fitView
        defaultViewport={document.viewport}
        colorMode={mode}
      >
        <Background gap={16} color={isDark ? '#333' : '#c8c8c8'} />
        <Controls className="wf-flow-controls" />
        <MiniMap
          className="wf-flow-minimap"
          pannable
          zoomable
          bgColor={isDark ? '#1f1f1f' : '#ffffff'}
          maskColor={isDark ? 'rgb(0 0 0 / 0.65)' : 'rgb(240 240 240 / 0.65)'}
          nodeColor={isDark ? '#3a3a3a' : '#e8e8e8'}
          nodeStrokeColor="#1677ff"
        />
      </ReactFlow>
    </div>
  );
});

type Props = InnerProps & {
  canvasRef?: React.RefObject<WorkflowCanvasRef | null>;
};

export function WorkflowCanvas({ canvasRef, ...props }: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner ref={canvasRef} {...props} />
    </ReactFlowProvider>
  );
}
