import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  Radio,
  Space,
  Spin,
  Steps,
  Typography,
} from 'antd';
import { formatApiError, postInit, postRuntimeProbe } from '../api/client.js';
import type { InitResponse, WorkfishRuntime } from '../types.js';

type Props = {
  onComplete: (result: InitResponse) => void;
  /** 本机默认工作区绝对路径，用作输入框占位符 */
  defaultWorkspacePath: string;
};

type Step = 0 | 1 | 2;

function formatProbeSuccess(path: string | undefined, runtime: WorkfishRuntime, version?: string, warning?: string) {
  const parts = [`已检测到 ${path ?? runtime}`];
  if (version) {
    parts.push(`版本 ${version}`);
  }
  if (warning) {
    parts.push(warning);
  }
  return parts.join(' · ');
}

export function InitWizard({ onComplete, defaultWorkspacePath }: Props) {
  const [step, setStep] = useState<Step>(0);
  const [workspacePath, setWorkspacePath] = useState('');
  const [runtime, setRuntime] = useState<WorkfishRuntime>('node');
  const [runtimePath, setRuntimePath] = useState('');
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [probeOk, setProbeOk] = useState<boolean | null>(null);
  const [probing, setProbing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildInitBody = () => {
    const trimmedWs = workspacePath.trim();
    const trimmedRt = runtimePath.trim();
    return {
      runtime,
      ...(trimmedWs ? { workspacePath: trimmedWs } : {}),
      ...(trimmedRt ? { runtimePath: trimmedRt } : {}),
    };
  };

  /** 步骤 1：选中运行时后自动探测 PATH；失败则进入手动路径 */
  useEffect(() => {
    if (step !== 1) {
      return;
    }
    let cancelled = false;
    setProbing(true);
    setError(null);
    setProbeMessage(null);
    setProbeOk(null);
    setRuntimePath('');

    (async () => {
      try {
        const result = await postRuntimeProbe(runtime);
        if (cancelled) {
          return;
        }
        setProbeOk(true);
        setProbeMessage(
          formatProbeSuccess(result.path, runtime, result.version, result.warning),
        );
      } catch (e) {
        if (cancelled) {
          return;
        }
        setProbeOk(false);
        setProbeMessage(formatApiError(e));
        setStep(2);
      } finally {
        if (!cancelled) {
          setProbing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, runtime]);

  const handleManualProbe = async () => {
    setProbing(true);
    setError(null);
    setProbeMessage(null);
    setProbeOk(null);
    try {
      const result = await postRuntimeProbe(runtime, runtimePath);
      setProbeOk(true);
      setProbeMessage(
        formatProbeSuccess(result.path, runtime, result.version, result.warning),
      );
    } catch (e) {
      setProbeOk(false);
      setProbeMessage(formatApiError(e));
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await postInit(buildInitBody());
      onComplete(result);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const canFinish =
    !probing && !submitting && ((step === 1 && probeOk === true) || (step === 2 && probeOk === true));

  return (
    <Card className="wizard-card" title="欢迎使用 Workfish" bordered={false}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        首次使用请完成以下设置
      </Typography.Paragraph>

      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 24 }}
        items={[{ title: '工作区' }, { title: '运行时' }, { title: '手动路径' }]}
      />

      {error ? (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}

      {step === 0 ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            工作区路径
          </Typography.Title>
          <Input
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder={defaultWorkspacePath}
            allowClear
            autoComplete="off"
          />
        </Space>
      ) : null}

      {step === 1 ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            选择运行时
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            用于编写与解析节点脚本（Node.js 或 Python）。选择后将自动检测本机版本。
          </Typography.Paragraph>
          <Radio.Group
            value={runtime}
            onChange={(e) => {
              setRuntime(e.target.value as WorkfishRuntime);
            }}
            style={{ width: '100%' }}
            disabled={probing}
          >
            <Flex gap={12}>
              <Radio.Button value="node" style={{ flex: 1, height: 'auto', padding: '12px 16px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Node.js</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    推荐 · 需 Node 18+
                  </Typography.Text>
                </div>
              </Radio.Button>
              <Radio.Button value="python" style={{ flex: 1, height: 'auto', padding: '12px 16px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Python</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    需 Python 3.10+
                  </Typography.Text>
                </div>
              </Radio.Button>
            </Flex>
          </Radio.Group>
          {probing ? (
            <Flex align="center" gap={8}>
              <Spin size="small" />
              <Typography.Text type="secondary">正在检测本机 {runtime}…</Typography.Text>
            </Flex>
          ) : null}
          {!probing && probeOk === true && probeMessage ? (
            <Alert type="success" showIcon message={probeMessage} />
          ) : null}
        </Space>
      ) : null}

      {step === 2 ? (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            手动指定运行时路径
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            未能在 PATH 中自动找到可用的 {runtime === 'node' ? 'Node.js' : 'Python'}
            ，请填写可执行文件路径后重新探测。
          </Typography.Paragraph>
          {probeMessage && probeOk === false ? (
            <Alert type="error" showIcon message={probeMessage} />
          ) : null}
          <Input
            value={runtimePath}
            onChange={(e) => {
              setRuntimePath(e.target.value);
              setProbeOk(null);
              setProbeMessage(null);
            }}
            placeholder={
              runtime === 'node'
                ? '例如 C:\\Program Files\\nodejs\\node.exe'
                : '例如 C:\\Python312\\python.exe'
            }
            allowClear
            autoComplete="off"
          />
          <Button onClick={() => void handleManualProbe()} loading={probing}>
            重新探测
          </Button>
          {!probing && probeOk === true && probeMessage ? (
            <Alert type="success" showIcon message={probeMessage} />
          ) : null}
        </Space>
      ) : null}

      <Flex justify="space-between" style={{ marginTop: 28 }}>
        {step > 0 ? (
          <Button
            disabled={submitting || probing}
            onClick={() => {
              if (step === 2) {
                setProbeOk(null);
                setProbeMessage(null);
                setRuntimePath('');
              }
              setStep((s) => (s - 1) as Step);
            }}
          >
            上一步
          </Button>
        ) : (
          <span />
        )}
        {step === 0 ? (
          <Button type="primary" onClick={() => setStep(1)}>
            下一步
          </Button>
        ) : null}
        {canFinish ? (
          <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            完成初始化
          </Button>
        ) : null}
        {step === 1 && probing ? (
          <Button type="primary" disabled loading>
            检测中
          </Button>
        ) : null}
      </Flex>
    </Card>
  );
}
