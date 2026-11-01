import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Input, Segmented, Space, Spin, Typography, App as AntdApp } from 'antd';
import {
  CodeOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { Edge, Node, OnSelectionChangeParams } from '@xyflow/react';
import type { EnvironmentCatalog, NodeSpec } from '@workfish/spec';
import {
  formatApiError,
  getEnvironments,
  getNodes,
  postNodesRescan,
  getWorkflow,
  listWorkflows,
  putWorkflow,
} from '../api/client.js';
import type { NodeCatalogItem, WorkfishConfig, WorkflowDocument } from '../types.js';
import { Inspector } from './Inspector.js';
import { AppWall } from './AppWall.js';
import {
  EditorNodeActionsContext,
  type NodeRunRequest,
  type NodeRunStatus,
} from './EditorNodeActionsContext.js';
import { ConsolePanel } from './ConsolePanel.js';
import { HorizontalResizeHandle } from './HorizontalResizeHandle.js';
import { LeftSidebar } from './LeftSidebar.js';
import { ResizeHandle } from './ResizeHandle.js';
import { useWorkflowConsole } from './useWorkflowConsole.js';
import { WorkflowCanvas, type WorkflowCanvasRef } from './WorkflowCanvas.js';
import { WorkflowListModal } from './WorkflowListModal.js';
import { ThemeToggle } from '../theme.js';
import { createEmptyWorkflow, flowToDocument, type WorkfishEdgeData, type WorkfishNodeData } from './workflowMapper.js';

const LEFT_WIDTH_KEY = 'workfish-sider-left-width';
const RIGHT_WIDTH_KEY = 'workfish-sider-right-width';
const CONSOLE_HEIGHT_KEY = 'workfish-console-height';
const LEFT_DEFAULT = 260;
const RIGHT_DEFAULT = 300;
const CONSOLE_DEFAULT = 220;

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

export function EditorPage({ config, initWarning }: Props) {
  const { message } = AntdApp.useApp();
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth(LEFT_WIDTH_KEY, LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = useState(() => readStoredWidth(RIGHT_WIDTH_KEY, RIGHT_DEFAULT));
  const [catalog, setCatalog] = useState<NodeCatalogItem[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentCatalog>({
    version: 1,
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
  const [mode, setMode] = useState<'flow' | 'apps'>('flow');
  const [consoleHeight, setConsoleHeight] = useState(() =>
    readStoredWidth(CONSOLE_HEIGHT_KEY, CONSOLE_DEFAULT),
  );
  const consoleApi = useWorkflowConsole();
  const startConsoleRunRef = useRef(consoleApi.startRun);
  startConsoleRunRef.current = consoleApi.startRun;
  const stopConsoleRunRef = useRef(consoleApi.stopRun);
  stopConsoleRunRef.current = consoleApi.stopRun;

  const runStatusByNodeId = useMemo(() => {
    const map: Record<string, NodeRunStatus> = {};
    for (const tab of consoleApi.tabs) {
      map[tab.key] = tab.status;
    }
    return map;
  }, [consoleApi.tabs]);

  const nodeActions = useMemo(
    () => ({
      environments,
      runStatusByNodeId,
      requestRun: (req: NodeRunRequest) => {
        void startConsoleRunRef.current(req);
      },
      stopRun: (instanceId: string) => {
        stopConsoleRunRef.current(instanceId);
      },
    }),
    [environments, runStatusByNodeId],
  );

  const canvasRef = useRef<WorkflowCanvasRef>(null);

  const specByTypeId = useMemo(() => buildSpecMap(catalog), [catalog]);
  const readyNodes = useMemo(
    () => catalog.filter((n) => n.status === 'ready'),
    [catalog],
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
      const [nodes, envs] = await Promise.all([
        postNodesRescan(),
        getEnvironments(),
      ]);
      setCatalog(nodes);
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
      const [nodes, envs, summaries] = await Promise.all([
        getNodes(),
        getEnvironments(),
        listWorkflows(),
      ]);
      setCatalog(nodes);
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

  useEffect(() => {
    try {
      localStorage.setItem(CONSOLE_HEIGHT_KEY, String(consoleHeight));
    } catch {
      // ignore
    }
  }, [consoleHeight]);

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

  const onNodeEnvChange = useCallback(
    (nodeId: string, envId: string | undefined, nextInputs: Record<string, unknown> | undefined) => {
      canvasRef.current?.patchNodeData(nodeId, (data) => {
        const prevParams = { ...(data.params ?? {}) };
        delete prevParams.envIds;
        delete prevParams.envBindings;
        if (envId) {
          prevParams.envId = envId;
        } else {
          delete prevParams.envId;
        }
        if (nextInputs && Object.keys(nextInputs).length > 0) {
          prevParams.inputs = nextInputs;
        } else {
          delete prevParams.inputs;
        }
        return {
          ...data,
          params: Object.keys(prevParams).length > 0 ? prevParams : undefined,
        };
      });
    },
    [],
  );

  const onParamsChange = useCallback(
    (nodeId: string, values: Record<string, unknown> | undefined) => {
      canvasRef.current?.patchNodeData(nodeId, (data) => {
        const prevParams = { ...(data.params ?? {}) };
        if (values && Object.keys(values).length > 0) {
          prevParams.inputs = values;
        } else {
          delete prevParams.inputs;
        }
        return {
          ...data,
          params: Object.keys(prevParams).length > 0 ? prevParams : undefined,
        };
      });
    },
    [],
  );

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

  const savingRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (mode !== 'flow' || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const viewport = canvasRef.current?.getViewport();
      const doc = flowToDocument(workflowMeta, flowNodes, flowEdges, viewport);
      const saved = await putWorkflow(workflowMeta.id, doc);
      setWorkflowMeta({ version: saved.version, id: saved.id, name: saved.name });
      // 更新已保存文档快照；画布仅在 resetKey 变化时重建，避免丢掉选中节点
      setLoadedDocument(saved);
      message.success('保存成功');
    } catch (e) {
      message.error(formatApiError(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [flowEdges, flowNodes, message, mode, workflowMeta]);

  // Ctrl+S / ⌘S 保存当前工作流
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        return;
      }
      if (e.key !== 's' && e.key !== 'S') {
        return;
      }
      if (mode !== 'flow') {
        return;
      }
      e.preventDefault();
      void handleSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, mode]);

  if (bootLoading) {
    return (
      <div className="editor-loading">
        <Spin size="large" description="正在加载编辑器…" />
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
    <EditorNodeActionsContext.Provider value={nodeActions}>
    <div className="editor-page">
      <header className="editor-toolbar">
        <div className="editor-toolbar-row">
          <div className="editor-toolbar-left">
            <Space wrap size="middle">
              <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
                Workfish
              </Typography.Title>
              {mode === 'flow' ? (
                <>
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
                </>
              ) : null}
            </Space>
          </div>
          <div className="editor-toolbar-center">
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'flow' | 'apps')}
              options={[
                { value: 'flow', label: '工作流' },
                { value: 'apps', label: '应用墙' },
              ]}
            />
          </div>
          <div className="editor-toolbar-right">
            <Space>
              {mode === 'flow' ? (
                <>
                  <Button
                    icon={<CodeOutlined />}
                    type={consoleApi.open ? 'primary' : 'default'}
                    ghost={consoleApi.open}
                    title={consoleApi.open ? '折叠控制台' : '展开控制台'}
                    onClick={() => consoleApi.setOpen(!consoleApi.open)}
                  >
                    控制台
                  </Button>
                  <Button icon={<FileAddOutlined />} onClick={handleNew}>
                    新建
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    title="保存 (Ctrl+S)"
                    onMouseDown={(e) => {
                      // 避免按钮抢焦点导致画布选中态被清空
                      e.preventDefault();
                    }}
                    onClick={() => void handleSave()}
                  >
                    保存
                  </Button>
                </>
              ) : (
                <Button
                  icon={<ReloadOutlined />}
                  loading={refreshing}
                  onClick={() => void refreshCatalog()}
                >
                  刷新脚本
                </Button>
              )}
              <ThemeToggle />
            </Space>
          </div>
        </div>
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

      {mode === 'flow' ? (
        <div className="editor-workspace">
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
                environments={environments}
                onRefresh={() => void refreshCatalog()}
                refreshing={refreshing}
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
                environments={environments}
                onNodeEnvChange={onNodeEnvChange}
                onParamsChange={onParamsChange}
              />
            </aside>
          </div>
          {consoleApi.open ? (
            <HorizontalResizeHandle
              value={consoleHeight}
              onChange={setConsoleHeight}
              min={140}
              max={560}
            />
          ) : null}
          <ConsolePanel
            open={consoleApi.open}
            height={consoleHeight}
            tabs={consoleApi.tabs}
            activeKey={consoleApi.activeKey}
            pendingInput={consoleApi.pendingInput}
            onOpenChange={consoleApi.setOpen}
            onActiveKeyChange={consoleApi.setActiveKey}
            onCloseTab={consoleApi.closeTab}
            onClearTab={consoleApi.clearTab}
            onAnswerInput={consoleApi.answerPendingInput}
            onCancelInput={consoleApi.cancelPendingInput}
          />
        </div>
      ) : (
        <main className="app-wall-main">
          <AppWall
            ready={readyNodes}
            problems={problemNodes}
            environments={environments}
            onChanged={async () => {
              await refreshCatalog();
            }}
          />
        </main>
      )}
    </div>
    </EditorNodeActionsContext.Provider>
  );
}
