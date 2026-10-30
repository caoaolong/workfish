import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Flex, Input, Space, Spin, Typography, App as AntdApp } from 'antd';
import { FileAddOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons';
import type { Edge, Node, OnSelectionChangeParams } from '@xyflow/react';
import type { EnvironmentCatalog, NodeSpec, TypeDef } from '@workfish/spec';
import {
  formatApiError,
  getEnvironments,
  getNodes,
  getTypes,
  postNodesRescan,
  getWorkflow,
  listWorkflows,
  putWorkflow,
} from '../api/client.js';
import type { NodeCatalogItem, WorkfishConfig, WorkflowDocument } from '../types.js';
import { mergeBuiltinCatalog } from './builtinNodes.js';
import { Inspector } from './Inspector.js';
import { LeftSidebar } from './LeftSidebar.js';
import { ResizeHandle } from './ResizeHandle.js';
import { WorkflowCanvas, type WorkflowCanvasRef } from './WorkflowCanvas.js';
import { WorkflowListModal } from './WorkflowListModal.js';
import { ThemeToggle } from '../theme.js';
import { createEmptyWorkflow, flowToDocument, type WorkfishEdgeData, type WorkfishNodeData } from './workflowMapper.js';

const LEFT_WIDTH_KEY = 'workfish-sider-left-width';
const RIGHT_WIDTH_KEY = 'workfish-sider-right-width';
const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 300;

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(560, Math.max(200, Math.round(n)));
  } catch {
    return fallback;
  }
}

type Props = {
  config: WorkfishConfig;
  initWarning?: string;
};

function buildSpecMap(catalog: NodeCatalogItem[]): Map<string, NodeSpec> {
  const map = new Map<string, NodeSpec>();
  for (const item of catalog) {
    if (item.status === 'ready' && item.spec) {
      map.set(item.id, item.spec);
    }
  }
  return map;
}

function buildTypesMap(types: TypeDef[]): Map<string, TypeDef> {
  return new Map(types.map((t) => [t.id, t]));
}

export function EditorPage({ config, initWarning }: Props) {
  const { message } = AntdApp.useApp();
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth(LEFT_WIDTH_KEY, LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = useState(() => readStoredWidth(RIGHT_WIDTH_KEY, RIGHT_DEFAULT));
  const [catalog, setCatalog] = useState<NodeCatalogItem[]>([]);
  const [types, setTypes] = useState<TypeDef[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentCatalog>({
    version: 1,
    groups: [],
    items: [],
  });
  const [workflowMeta, setWorkflowMeta] = useState<Pick<WorkflowDocument, 'id' | 'name' | 'version'>>({
    version: 1,
    id: 'untitled',
    name: '未命名',
  });
  const [loadedDocument, setLoadedDocument] = useState<WorkflowDocument>(() =>
    createEmptyWorkflow('untitled', '未命名'),
  );
  const [resetKey, setResetKey] = useState('0');
  const [flowNodes, setFlowNodes] = useState<Node<WorkfishNodeData>[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge<WorkfishEdgeData>[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node<WorkfishNodeData> | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge<WorkfishEdgeData> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [workflowListOpen, setWorkflowListOpen] = useState(false);

  const canvasRef = useRef<WorkflowCanvasRef>(null);

  const catalogWithBuiltin = useMemo(() => mergeBuiltinCatalog(catalog), [catalog]);
  const specByTypeId = useMemo(() => buildSpecMap(catalogWithBuiltin), [catalogWithBuiltin]);
  const typesMap = useMemo(() => buildTypesMap(types), [types]);
  const readyNodes = useMemo(
    () => catalogWithBuiltin.filter((n) => n.status === 'ready'),
    [catalogWithBuiltin],
  );
  const problemNodes = useMemo(() => catalog.filter((n) => n.status === 'error'), [catalog]);

  const showToast = useCallback(
    (text: string) => {
      message.info(text);
    },
    [message],
  );

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nodes, typeList, envs] = await Promise.all([
        postNodesRescan(),
        getTypes(),
        getEnvironments(),
      ]);
      setCatalog(nodes);
      setTypes(typeList);
      setEnvironments(envs);
      message.success('资源已刷新');
    } catch (e) {
      message.error(formatApiError(e));
    } finally {
      setRefreshing(false);
    }
  }, [message]);

  const loadInitial = useCallback(async () => {
    setBootLoading(true);
    setLoadError(null);
    try {
      const [nodes, typeList, envs, summaries] = await Promise.all([
        getNodes(),
        getTypes(),
        getEnvironments(),
        listWorkflows(),
      ]);
      setCatalog(nodes);
      setTypes(typeList);
      setEnvironments(envs);
      if (summaries.length > 0) {
        const first = summaries[0]!;
        const doc = await getWorkflow(first.id);
        setWorkflowMeta({ version: doc.version, id: doc.id, name: doc.name });
        setLoadedDocument(doc);
      } else {
        const empty = createEmptyWorkflow('untitled', '未命名');
        setWorkflowMeta({ version: empty.version, id: empty.id, name: empty.name });
        setLoadedDocument(empty);
      }
      setResetKey(String(Date.now()));
    } catch (e) {
      setLoadError(formatApiError(e));
    } finally {
      setBootLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    try {
      localStorage.setItem(LEFT_WIDTH_KEY, String(leftWidth));
    } catch {
      // ignore
    }
  }, [leftWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_WIDTH_KEY, String(rightWidth));
    } catch {
      // ignore
    }
  }, [rightWidth]);

  const onDocumentChange = useCallback(
    (nodes: Node<WorkfishNodeData>[], edges: Edge<WorkfishEdgeData>[]) => {
      setFlowNodes(nodes);
      setFlowEdges(edges);
    },
    [],
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const node = params.nodes[0] as Node<WorkfishNodeData> | undefined;
    const edge = params.edges[0] as Edge<WorkfishEdgeData> | undefined;
    setSelectedNode(node ?? null);
    setSelectedEdge(edge ?? null);
  }, []);

  // 节点数据变更后同步检查器选中态
  useEffect(() => {
    if (!selectedNode) {
      return;
    }
    const latest = flowNodes.find((n) => n.id === selectedNode.id);
    if (latest && latest !== selectedNode) {
      setSelectedNode(latest);
    }
  }, [flowNodes, selectedNode]);

  const onEnvBindingChange = useCallback((nodeId: string, key: string, envId: string | undefined) => {
    canvasRef.current?.patchNodeData(nodeId, (data) => {
      const prevParams = { ...(data.params ?? {}) };
      const prevBindings: Record<string, string> = {};
      if (
        prevParams.envBindings &&
        typeof prevParams.envBindings === 'object' &&
        !Array.isArray(prevParams.envBindings)
      ) {
        for (const [k, v] of Object.entries(prevParams.envBindings as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) {
            prevBindings[k] = v;
          } else if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) {
            prevBindings[k] = v[0];
          }
        }
      }
      if (envId) {
        prevBindings[key] = envId;
      } else {
        delete prevBindings[key];
      }
      if (Object.keys(prevBindings).length > 0) {
        prevParams.envBindings = prevBindings;
      } else {
        delete prevParams.envBindings;
      }
      return {
        ...data,
        params: Object.keys(prevParams).length > 0 ? prevParams : undefined,
      };
    });
  }, []);

  const onNodeEnvIdsChange = useCallback((nodeId: string, envIds: string[]) => {
    canvasRef.current?.patchNodeData(nodeId, (data) => {
      const prevParams = { ...(data.params ?? {}) };
      if (envIds.length > 0) {
        prevParams.envIds = envIds;
      } else {
        delete prevParams.envIds;
      }
      return {
        ...data,
        params: Object.keys(prevParams).length > 0 ? prevParams : undefined,
      };
    });
  }, []);

  const onStructTypeChange = useCallback((nodeId: string, typeRef: string | undefined) => {
    canvasRef.current?.setStructTypeRef(nodeId, typeRef);
  }, []);

  const handleNew = () => {
    const id = `wf-${Date.now()}`;
    const empty = createEmptyWorkflow(id, '未命名');
    setWorkflowMeta({ version: empty.version, id: empty.id, name: empty.name });
    setLoadedDocument(empty);
    setResetKey(String(Date.now()));
    message.success('已新建未命名工作流');
  };

  const handleOpenWorkflow = useCallback(
    (doc: WorkflowDocument) => {
      setWorkflowMeta({ version: doc.version, id: doc.id, name: doc.name });
      setLoadedDocument(doc);
      setResetKey(String(Date.now()));
      setWorkflowListOpen(false);
      message.success(`已打开「${doc.name}」`);
    },
    [message],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const viewport = canvasRef.current?.getViewport();
      const doc = flowToDocument(workflowMeta, flowNodes, flowEdges, viewport);
      const saved = await putWorkflow(workflowMeta.id, doc);
      setWorkflowMeta({ version: saved.version, id: saved.id, name: saved.name });
      setLoadedDocument(saved);
      message.success('保存成功');
    } catch (e) {
      message.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (bootLoading) {
    return (
      <div className="editor-loading">
        <Spin size="large" tip="正在加载编辑器…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="center">
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={loadError}
          style={{ marginBottom: 16, maxWidth: 420 }}
        />
        <Button onClick={() => void loadInitial()}>重试</Button>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <header className="editor-toolbar">
        <Flex align="center" justify="space-between" wrap="wrap" gap={12} style={{ width: '100%' }}>
          <Space wrap size="middle">
            <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
              Workfish
            </Typography.Title>
            <Button
              icon={<FolderOpenOutlined />}
              onClick={() => setWorkflowListOpen(true)}
            >
              工作流
            </Button>
            <Space>
              <Typography.Text type="secondary">名称</Typography.Text>
              <Input
                value={workflowMeta.name}
                onChange={(e) => setWorkflowMeta((m) => ({ ...m, name: e.target.value }))}
                style={{ width: 160 }}
              />
            </Space>
            <Typography.Text type="secondary">
              ID: <Typography.Text code>{workflowMeta.id}</Typography.Text>
            </Typography.Text>
          </Space>
          <Space>
            <Button icon={<FileAddOutlined />} onClick={handleNew}>
              新建
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
            <ThemeToggle />
          </Space>
        </Flex>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          工作区 <Typography.Text code>{config.workspacePath}</Typography.Text>
        </Typography.Text>
      </header>

      <WorkflowListModal
        open={workflowListOpen}
        currentId={workflowMeta.id}
        onCancel={() => setWorkflowListOpen(false)}
        onOpen={handleOpenWorkflow}
      />

      {initWarning ? (
        <Alert type="warning" showIcon banner message={initWarning} />
      ) : null}

      <div
        className="editor-body editor-body-resizable"
        style={
          {
            ['--wf-left-w']: `${leftWidth}px`,
            ['--wf-right-w']: `${rightWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="editor-sider">
          <LeftSidebar
            ready={readyNodes}
            problems={problemNodes}
            types={types}
            environments={environments}
            onRefresh={() => void refreshCatalog()}
            refreshing={refreshing}
            onTypesChanged={async () => {
              await refreshCatalog();
            }}
            onEnvironmentsChanged={async (next) => {
              setEnvironments(next);
            }}
          />
        </aside>
        <ResizeHandle side="left" value={leftWidth} onChange={setLeftWidth} />
        <main className="editor-main">
          <WorkflowCanvas
            canvasRef={canvasRef}
            document={loadedDocument}
            specByTypeId={specByTypeId}
            typesMap={typesMap}
            onDocumentChange={onDocumentChange}
            onSelectionChange={onSelectionChange}
            onToast={showToast}
            resetKey={resetKey}
          />
        </main>
        <ResizeHandle side="right" value={rightWidth} onChange={setRightWidth} />
        <aside className="editor-sider editor-sider-right">
          <Inspector
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            nodes={flowNodes}
            typesMap={typesMap}
            environments={environments}
            onEnvBindingChange={onEnvBindingChange}
            onNodeEnvIdsChange={onNodeEnvIdsChange}
            onStructTypeChange={onStructTypeChange}
          />
        </aside>
      </div>
    </div>
  );
}
