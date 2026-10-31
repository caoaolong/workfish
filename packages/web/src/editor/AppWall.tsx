import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  App as AntdApp,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog, NodeSpec } from '@workfish/spec';
import type { NodeCatalogItem } from '../types.js';
import {
  answerRunInput,
  createRunSession,
  deleteNode,
  formatApiError,
  killRunSession,
  putNodeMeta,
  type InputRequestOption,
  type RunEvent,
} from '../api/client.js';
import { MetaEditorModal } from './MetaEditorModal.js';
import { ParamFields } from './ParamFields.js';

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
  environments: EnvironmentCatalog;
  onChanged: () => Promise<void> | void;
};

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
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
  return (
    <Card
      title={
        <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
          {spec?.name ?? item.id}
        </Typography.Text>
      }
      extra={
        <Space size={4}>
          <Tag color={isReady ? 'success' : 'error'}>{isReady ? '就绪' : '异常'}</Tag>
          <Tag>{item.runtime}</Tag>
        </Space>
      }
      actions={[
        <Button key="run" type="link" icon={<PlayCircleOutlined />} disabled={!isReady} onClick={onRun}>
          运行
        </Button>,
        <Button key="edit" type="link" icon={<EditOutlined />} disabled={!isReady} onClick={onEdit}>
          编辑
        </Button>,
        <Button key="delete" type="link" danger icon={<DeleteOutlined />} onClick={onDelete}>
          删除
        </Button>,
      ]}
    >
      {spec?.description ? (
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 8 }}>
          {spec.description}
        </Typography.Paragraph>
      ) : null}
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="ID">
          <Typography.Text code copyable={{ tooltips: false }}>{item.id}</Typography.Text>
        </Descriptions.Item>
        {spec ? (
          <>
            <Descriptions.Item label="版本">{spec.version}</Descriptions.Item>
            <Descriptions.Item label="输入/输出">
              {Object.keys(spec.inputs).length} / {Object.keys(spec.outputs).length} 个端口
            </Descriptions.Item>
            {(spec.environments?.length ?? 0) > 0 ? (
              <Descriptions.Item label="环境槽位">
                {spec.environments!.map((s) => s.key).join('、')}
              </Descriptions.Item>
            ) : null}
          </>
        ) : null}
      </Descriptions>
      {!isReady && item.errors && item.errors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message="脚本存在问题，运行与编辑已禁用"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {item.errors.map((e, i) => (
                <li key={i}>
                  <Typography.Text code>{e.path || '—'}</Typography.Text> {e.message}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
    </Card>
  );
}

type InputReq = {
  id: string;
  prompt: string;
  options: InputRequestOption;
};

function RunModal({
  item,
  environments,
  open,
  onClose,
}: {
  item: NodeCatalogItem | null;
  environments: EnvironmentCatalog;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [inputs, setInputs] = useState<Record<string, unknown> | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [prints, setPrints] = useState<string[]>([]);
  const [inputQueue, setInputQueue] = useState<InputReq[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [answering, setAnswering] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; outputs?: unknown; error?: string; durationMs: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionRef = useRef<string | null>(null);

  const spec: NodeSpec | undefined = item?.spec;
  const envOptions = useMemo(
    () => environments.items.map((e) => ({ value: e.id, label: `${e.name}（${Object.keys(e.values).length} 个变量）` })),
    [environments],
  );

  // 关闭弹窗时清理：断开 SSE 并终止会话
  useEffect(() => {
    if (!open) {
      return;
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      const sid = sessionRef.current;
      sessionRef.current = null;
      setSessionId(null);
      setRunning(false);
      setLogs([]);
      setPrints([]);
      setInputQueue([]);
      setResult(null);
      setInputs(undefined);
      setEnvId(undefined);
      if (sid) {
        killRunSession(sid).catch(() => undefined);
      }
    };
  }, [open, item]);

  // 打开输入弹窗时预填默认值
  const currentInput = inputQueue[0];
  useEffect(() => {
    if (currentInput) {
      setInputValue(currentInput.options.default ?? '');
    }
  }, [currentInput?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = async () => {
    if (!item) {
      return;
    }
    setLogs([]);
    setPrints([]);
    setInputQueue([]);
    setResult(null);
    setRunning(true);
    try {
      const { sessionId: sid } = await createRunSession(item.id, {
        ...(inputs ? { inputs } : {}),
        ...(envId ? { envId } : {}),
      });
      sessionRef.current = sid;
      setSessionId(sid);
      const es = new EventSource(`/api/runs/${encodeURIComponent(sid)}/events`);
      eventSourceRef.current = es;
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as RunEvent;
          if (event.type === 'log') {
            setLogs((prev) => [...prev.slice(-499), event.text]);
          } else if (event.type === 'printf') {
            setPrints((prev) => [...prev.slice(-499), event.text]);
          } else if (event.type === 'input_request') {
            setInputQueue((prev) =>
              prev.some((q) => q.id === event.id)
                ? prev
                : [...prev, { id: event.id, prompt: event.prompt, options: event.options }],
            );
          } else if (event.type === 'done') {
            setResult({
              ok: event.ok,
              ...(event.ok ? { outputs: event.outputs } : { error: event.error }),
              durationMs: event.durationMs,
            });
            setRunning(false);
            es.close();
          }
        } catch {
          // 忽略畸形事件
        }
      };
      es.onerror = () => {
        // SSE 中断：会话仍在服务端继续，提示用户但不断言失败
        es.close();
        setRunning(false);
      };
    } catch (e) {
      const msg = formatApiError(e);
      message.error(msg);
      setRunning(false);
      setResult({ ok: false, error: msg, durationMs: 0 });
    }
  };

  const submitInput = async () => {
    const sid = sessionRef.current;
    if (!sid || !currentInput) {
      return;
    }
    setAnswering(true);
    try {
      await answerRunInput(sid, { requestId: currentInput.id, value: inputValue });
      setInputQueue((prev) => prev.filter((q) => q.id !== currentInput.id));
    } catch (e) {
      message.error(formatApiError(e));
    } finally {
      setAnswering(false);
    }
  };

  const cancelRun = async () => {
    const sid = sessionRef.current;
    if (!sid) {
      return;
    }
    setAnswering(true);
    try {
      await answerRunInput(sid, { requestId: currentInput?.id ?? '', cancelled: true }).catch(() =>
        killRunSession(sid),
      );
    } finally {
      setAnswering(false);
      setInputQueue([]);
    }
  };

  return (
    <Modal
      title={item ? `运行 · ${item.spec?.name ?? item.id}` : '运行'}
      open={open}
      onCancel={onClose}
      width={680}
      destroyOnHidden
      footer={
        sessionId || result
          ? [
              <Button key="close" onClick={onClose}>
                关闭
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose}>
                取消
              </Button>,
              <Button key="run" type="primary" loading={running} onClick={() => void startRun()}>
                运行
              </Button>,
            ]
      }
    >
      {!sessionId && !result && spec ? (
        <>
          <Typography.Title level={5} style={{ fontSize: 14 }}>
            环境（可选）
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            所选环境的键值对将作为环境变量注入（脚本经 process.env / os.environ 读取）。环境槽位绑定仅在工作流中使用，此处统一注入。
          </Typography.Paragraph>
          <Select
            style={{ width: '100%', marginBottom: 16 }}
            placeholder={environments.items.length === 0 ? '暂无环境，可直接运行' : '选择注入的环境'}
            allowClear
            showSearch
            optionFilterProp="label"
            value={envId}
            options={envOptions}
            onChange={(v) => setEnvId(v)}
          />
          <Typography.Title level={5} style={{ fontSize: 14 }}>
            输入参数
          </Typography.Title>
          <div style={{ marginBottom: 8 }} key={item?.id}>
            <ParamFields spec={spec} values={inputs ?? {}} onChange={setInputs} />
          </div>
        </>
      ) : null}

      {sessionId || result ? (
        <>
          <Typography.Title level={5} style={{ fontSize: 14 }}>
            输出
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {running ? '运行中…' : result ? `耗时 ${result.durationMs} ms` : ''}
            </Typography.Text>
          </Typography.Title>
          {prints.length > 0 ? (
            <Typography.Text style={{ display: 'block', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {prints.join('\n')}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              （暂无脚本输出，可在脚本中调用 wf_printf 发送）
            </Typography.Text>
          )}
          {logs.length > 0 ? (
            <>
              <Typography.Title level={5} style={{ fontSize: 14 }}>
                日志
              </Typography.Title>
              <Typography.Text
                type="secondary"
                style={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: 12, marginBottom: 8 }}
              >
                {logs.join('\n')}
              </Typography.Text>
            </>
          ) : null}
          {result ? (
            result.ok ? (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <Space size={8} style={{ marginBottom: 8 }}>
                  <Tag color="success">成功</Tag>
                </Space>
                <Typography.Title level={5} style={{ fontSize: 14 }}>
                  返回值
                </Typography.Title>
                <Typography.Text code style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                  {stringify(result.outputs)}
                </Typography.Text>
              </>
            ) : (
              <Alert
                type="error"
                showIcon
                message="运行失败"
                description={result.error}
                style={{ marginTop: 8 }}
              />
            )
          ) : null}
        </>
      ) : null}

      {/* 脚本请求输入时弹出的用户输入对话框 */}
      <Modal
        title="脚本请求输入"
        open={Boolean(currentInput)}
        onCancel={() => void cancelRun()}
        destroyOnHidden
        footer={[
          <Button key="cancel" danger onClick={() => void cancelRun()} loading={answering}>
            取消运行
          </Button>,
          <Button key="ok" type="primary" onClick={() => void submitInput()} loading={answering}>
            提交
          </Button>,
        ]}
      >
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {currentInput?.prompt}
        </Typography.Paragraph>
        {currentInput?.options.multiline ? (
          <Input.TextArea
            rows={4}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
        ) : currentInput?.options.password ? (
          <Input.Password
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
            onPressEnter={() => void submitInput()}
          />
        ) : (
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
            onPressEnter={() => void submitInput()}
          />
        )}
      </Modal>
    </Modal>
  );
}

export function AppWall({ ready, problems, environments, onChanged }: Props) {
  const { message, modal } = AntdApp.useApp();
  const [runTarget, setRunTarget] = useState<NodeCatalogItem | null>(null);
  const [editTarget, setEditTarget] = useState<NodeCatalogItem | null>(null);

  const all = useMemo(() => [...ready, ...problems], [ready, problems]);

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
      <Row gutter={[16, 16]}>
        {all.map((item) => (
          <Col key={item.id} xs={24} sm={12} lg={8} xxl={6}>
            <NodeCard
              item={item}
              onRun={() => setRunTarget(item)}
              onEdit={() => setEditTarget(item)}
              onDelete={() => handleDelete(item)}
            />
          </Col>
        ))}
      </Row>

      <RunModal
        item={runTarget}
        environments={environments}
        open={Boolean(runTarget)}
        onClose={() => setRunTarget(null)}
      />

      <MetaEditorModal
        open={Boolean(editTarget)}
        initial={editTarget?.spec ?? null}
        onCancel={() => setEditTarget(null)}
        onSave={handleEditSave}
      />
    </div>
  );
}
