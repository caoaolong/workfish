import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  App as AntdApp,
} from 'antd';
import type { EnvironmentCatalog, NodeSpec } from '@workfish/spec';
import {
  answerRunInput,
  createRunSession,
  formatApiError,
  killRunSession,
  type InputRequestOption,
  type RunEvent,
} from '../api/client.js';
import { applyEnvToInputs } from './Inspector.js';
import { ParamFields } from './ParamFields.js';
import { RunTerminal, type RunTerminalHandle } from './RunTerminal.js';

export type NodeRunTarget = {
  id: string;
  name?: string;
  spec?: NodeSpec;
};

type InputReq = {
  id: string;
  prompt: string;
  options: InputRequestOption;
};

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

type Props = {
  target: NodeRunTarget | null;
  environments: EnvironmentCatalog;
  open: boolean;
  onClose: () => void;
  /** 打开时预填的环境 id（如画布节点检查器已选） */
  initialEnvId?: string;
  /** 打开时预填的输入 */
  initialInputs?: Record<string, unknown>;
  /** 为 true 时跳过表单，直接用预填参数启动运行（工作流画布） */
  autoStart?: boolean;
};

/** 单节点运行弹窗：可选环境、输入参数、虚拟终端输出与交互输入 */
export function NodeRunModal({
  target,
  environments,
  open,
  onClose,
  initialEnvId,
  initialInputs,
  autoStart = false,
}: Props) {
  const { message } = AntdApp.useApp();
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [inputs, setInputs] = useState<Record<string, unknown> | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [inputQueue, setInputQueue] = useState<InputReq[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [answering, setAnswering] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    outputs?: unknown;
    error?: string;
    durationMs: number;
  } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionRef = useRef<string | null>(null);
  const termRef = useRef<RunTerminalHandle>(null);

  const spec: NodeSpec | undefined = target?.spec;
  const envOptions = useMemo(
    () =>
      environments.items.map((e) => ({
        value: e.id,
        label: `${e.name}（${Object.keys(e.values).length} 个变量）`,
      })),
    [environments],
  );

  const attachEventSource = (sid: string) => {
    const es = new EventSource(`/api/runs/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as RunEvent;
        if (event.type === 'log') {
          termRef.current?.writeLine(event.text, 'log');
        } else if (event.type === 'printf') {
          termRef.current?.writeLine(event.text, 'out');
        } else if (event.type === 'input_request') {
          termRef.current?.writeLine(`? ${event.prompt}`, 'info');
          setInputQueue((prev) =>
            prev.some((q) => q.id === event.id)
              ? prev
              : [...prev, { id: event.id, prompt: event.prompt, options: event.options }],
          );
        } else if (event.type === 'done') {
          if (event.ok) {
            termRef.current?.writeLine(`── 完成 · ${event.durationMs} ms ──`, 'ok');
            if (event.outputs !== undefined) {
              termRef.current?.writeLine(stringify(event.outputs), 'ok');
            }
          } else {
            termRef.current?.writeLine(
              `── 失败 · ${event.durationMs} ms ──\n${event.error ?? '未知错误'}`,
              'error',
            );
          }
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
      termRef.current?.writeLine('连接中断', 'error');
      es.close();
      setRunning(false);
    };
  };

  const startRunWith = async (
    nodeId: string,
    runEnvId: string | undefined,
    runInputs: Record<string, unknown> | undefined,
  ) => {
    setInputQueue([]);
    setResult(null);
    setRunning(true);
    // 等待终端挂载后再写入
    await new Promise((r) => setTimeout(r, 50));
    termRef.current?.fit();
    termRef.current?.clear();
    termRef.current?.writeLine(`$ run ${nodeId}`, 'info');
    try {
      const { sessionId: sid } = await createRunSession(nodeId, {
        ...(runInputs ? { inputs: runInputs } : {}),
        ...(runEnvId ? { envId: runEnvId } : {}),
      });
      sessionRef.current = sid;
      setSessionId(sid);
      attachEventSource(sid);
    } catch (e) {
      const msg = formatApiError(e);
      message.error(msg);
      termRef.current?.writeLine(msg, 'error');
      setRunning(false);
      setResult({ ok: false, error: msg, durationMs: 0 });
    }
  };

  // 打开时预填；autoStart 则直接跑；关闭时断开 SSE
  useEffect(() => {
    if (!open || !target) {
      return;
    }
    const nextEnv = initialEnvId;
    const nextInputs =
      initialInputs && Object.keys(initialInputs).length > 0 ? { ...initialInputs } : undefined;
    setEnvId(nextEnv);
    setInputs(nextInputs);
    setSessionId(null);
    setRunning(false);
    setInputQueue([]);
    setResult(null);

    // 等 Modal / 终端挂载后再清屏与适配
    const fitTimer = window.setTimeout(() => {
      termRef.current?.fit();
      if (!autoStart) {
        termRef.current?.clear();
      }
    }, 50);

    let cancelled = false;
    if (autoStart) {
      setRunning(true);
      void (async () => {
        // 稍候终端就绪
        await new Promise((r) => setTimeout(r, 60));
        if (cancelled) {
          return;
        }
        termRef.current?.clear();
        termRef.current?.writeLine(`$ run ${target.id}`, 'info');
        try {
          const { sessionId: sid } = await createRunSession(target.id, {
            ...(nextInputs ? { inputs: nextInputs } : {}),
            ...(nextEnv ? { envId: nextEnv } : {}),
          });
          if (cancelled) {
            killRunSession(sid).catch(() => undefined);
            return;
          }
          sessionRef.current = sid;
          setSessionId(sid);
          attachEventSource(sid);
        } catch (e) {
          if (cancelled) {
            return;
          }
          const msg = formatApiError(e);
          message.error(msg);
          termRef.current?.writeLine(msg, 'error');
          setRunning(false);
          setResult({ ok: false, error: msg, durationMs: 0 });
        }
      })();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(fitTimer);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      const sid = sessionRef.current;
      sessionRef.current = null;
      if (sid) {
        killRunSession(sid).catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在打开或切换目标时应用
  }, [open, target?.id, autoStart]);

  const currentInput = inputQueue[0];
  useEffect(() => {
    if (currentInput) {
      setInputValue(currentInput.options.default ?? '');
    }
  }, [currentInput?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = () => {
    if (!target) {
      return;
    }
    void startRunWith(target.id, envId, inputs);
  };

  const submitInput = async () => {
    const sid = sessionRef.current;
    if (!sid || !currentInput) {
      return;
    }
    setAnswering(true);
    try {
      termRef.current?.writeLine(`> ${currentInput.options.password ? '******' : inputValue}`, 'info');
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
      termRef.current?.writeLine('（已取消输入）', 'log');
      await answerRunInput(sid, { requestId: currentInput?.id ?? '', cancelled: true }).catch(() =>
        killRunSession(sid),
      );
    } finally {
      setAnswering(false);
      setInputQueue([]);
    }
  };

  const showForm = !autoStart && !sessionId && !result && Boolean(spec);
  const showTerminal = Boolean(autoStart || sessionId || result || running);

  return (
    <Modal
      title={target ? `运行 · ${target.name ?? target.spec?.name ?? target.id}` : '运行'}
      open={open}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) {
          window.setTimeout(() => termRef.current?.fit(), 30);
        }
      }}
      footer={
        autoStart || sessionId || result
          ? [
              <Button key="close" onClick={onClose}>
                关闭
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={onClose}>
                取消
              </Button>,
              <Button key="run" type="primary" loading={running} onClick={startRun}>
                运行
              </Button>,
            ]
      }
    >
      {showForm ? (
        <>
          <Typography.Title level={5} style={{ fontSize: 14 }}>
            环境（可选）
          </Typography.Title>
          <Select
            style={{ width: '100%', marginBottom: 16 }}
            placeholder={environments.items.length === 0 ? '暂无环境' : '选择环境'}
            allowClear
            showSearch
            optionFilterProp="label"
            value={envId}
            options={envOptions}
            onChange={(v) => {
              const nextId = typeof v === 'string' ? v : undefined;
              setEnvId(nextId);
              const env = nextId ? environments.items.find((e) => e.id === nextId) : undefined;
              const { values } = applyEnvToInputs(spec!, env, inputs ?? {});
              setInputs(Object.keys(values).length > 0 ? values : undefined);
            }}
          />
          <Typography.Title level={5} style={{ fontSize: 14 }}>
            输入参数
          </Typography.Title>
          <div style={{ marginBottom: 8 }} key={`${target?.id}:${envId ?? ''}`}>
            <ParamFields
              spec={spec!}
              values={inputs ?? {}}
              envValues={
                envId ? environments.items.find((e) => e.id === envId)?.values : undefined
              }
              onChange={setInputs}
            />
          </div>
        </>
      ) : null}

      {showTerminal ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <Typography.Title level={5} style={{ fontSize: 14, margin: 0 }}>
              终端
            </Typography.Title>
            <Space size={8}>
              {running ? <Tag color="processing">运行中</Tag> : null}
              {result ? (
                result.ok ? (
                  <Tag color="success">成功 · {result.durationMs} ms</Tag>
                ) : (
                  <Tag color="error">失败 · {result.durationMs} ms</Tag>
                )
              ) : null}
            </Space>
          </div>
          <RunTerminal ref={termRef} height={360} />
          {result && !result.ok ? (
            <Alert
              type="error"
              showIcon
              message="运行失败"
              description={result.error}
              style={{ marginTop: 12 }}
            />
          ) : null}
        </>
      ) : null}

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
