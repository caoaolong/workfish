import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Space, Tabs, Tag, Typography, App as AntdApp } from 'antd';
import { ClearOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { formatApiError } from '../api/client.js';
import { RunTerminal, type RunTerminalHandle } from './RunTerminal.js';
import type { ConsoleInputRequest, ConsoleTab } from './useWorkflowConsole.js';

type Props = {
  open: boolean;
  height: number;
  tabs: ConsoleTab[];
  activeKey: string | undefined;
  pendingInput: ConsoleInputRequest | null;
  onOpenChange: (open: boolean) => void;
  onActiveKeyChange: (key: string) => void;
  onCloseTab: (key: string) => void;
  onClearTab: (key: string) => void;
  onAnswerInput: (value: string) => Promise<void>;
  onCancelInput: () => Promise<void>;
};

function statusTag(status: ConsoleTab['status']) {
  if (status === 'running') {
    return <Tag color="processing">运行中</Tag>;
  }
  if (status === 'ok') {
    return <Tag color="success">成功</Tag>;
  }
  if (status === 'error') {
    return <Tag color="error">失败</Tag>;
  }
  return <Tag>空闲</Tag>;
}

/** 底部控制台：Tab 对应各画布节点实例的运行输出 */
export function ConsolePanel({
  open,
  height,
  tabs,
  activeKey,
  pendingInput,
  onOpenChange,
  onActiveKeyChange,
  onCloseTab,
  onClearTab,
  onAnswerInput,
  onCancelInput,
}: Props) {
  const { message } = AntdApp.useApp();
  const termRef = useRef<RunTerminalHandle>(null);
  const replayKeyRef = useRef<string | undefined>(undefined);
  const replayLenRef = useRef(0);
  const [inputValue, setInputValue] = useState('');
  const [answering, setAnswering] = useState(false);
  const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  // 增量写入终端；切换 Tab / 清空时整页回放
  useEffect(() => {
    if (!open || !activeTab) {
      return;
    }
    const term = termRef.current;
    if (!term) {
      return;
    }
    const id = window.setTimeout(() => {
      term.fit();
      const switched = replayKeyRef.current !== activeTab.key;
      const reset = switched || activeTab.lines.length < replayLenRef.current;
      if (reset) {
        term.clear();
        replayKeyRef.current = activeTab.key;
        replayLenRef.current = 0;
      }
      const chunk = activeTab.lines.slice(replayLenRef.current);
      for (const line of chunk) {
        term.writeLine(line.text, line.kind);
      }
      replayLenRef.current = activeTab.lines.length;
    }, 30);
    return () => window.clearTimeout(id);
  }, [open, activeTab?.key, activeTab?.lines, height]);

  useEffect(() => {
    if (pendingInput) {
      setInputValue(pendingInput.options.default ?? '');
    }
  }, [pendingInput?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    return (
      <div className="console-panel console-panel-collapsed">
        <button type="button" className="console-panel-toggle" onClick={() => onOpenChange(true)}>
          <UpOutlined />
          <span>控制台{tabs.length > 0 ? `（${tabs.length}）` : ''}</span>
        </button>
      </div>
    );
  }

  return (
    <section className="console-panel" style={{ height }}>
      <header className="console-panel-header">
        <Typography.Text strong style={{ fontSize: 13 }}>
          控制台
        </Typography.Text>
        <Space size={4}>
          {activeTab ? statusTag(activeTab.status) : null}
          {activeTab?.durationMs != null ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {activeTab.durationMs} ms
            </Typography.Text>
          ) : null}
          <Button
            type="text"
            size="small"
            icon={<ClearOutlined />}
            disabled={!activeTab}
            title="清空当前终端"
            onClick={() => {
              if (activeTab) {
                onClearTab(activeTab.key);
              }
            }}
          />
          <Button
            type="text"
            size="small"
            icon={<DownOutlined />}
            title="收起"
            onClick={() => onOpenChange(false)}
          />
        </Space>
      </header>

      {tabs.length === 0 ? (
        <div className="console-panel-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无输出"
          />
        </div>
      ) : (
        <div className="console-panel-body">
          <div className="console-panel-terminal">
            <RunTerminal ref={termRef} height={Math.max(80, height - 88)} />
          </div>
          <Tabs
            className="console-panel-tabs"
            type="editable-card"
            hideAdd
            size="small"
            tabPosition="bottom"
            activeKey={activeTab?.key}
            onChange={onActiveKeyChange}
            onEdit={(key, action) => {
              if (action === 'remove' && typeof key === 'string') {
                onCloseTab(key);
              }
            }}
            items={tabs.map((t) => ({
              key: t.key,
              label: (
                <span className="console-tab-label">
                  <span className={`console-tab-dot is-${t.status}`} />
                  {t.title}
                </span>
              ),
              children: null,
            }))}
          />
        </div>
      )}

      <Modal
        title="脚本请求输入"
        open={Boolean(pendingInput)}
        onCancel={() => {
          void onCancelInput().catch((e) => message.error(formatApiError(e)));
        }}
        destroyOnHidden
        footer={[
          <Button
            key="cancel"
            danger
            loading={answering}
            onClick={() => {
              setAnswering(true);
              void onCancelInput()
                .catch((e) => message.error(formatApiError(e)))
                .finally(() => setAnswering(false));
            }}
          >
            取消运行
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={answering}
            onClick={() => {
              setAnswering(true);
              void onAnswerInput(inputValue)
                .catch((e) => message.error(formatApiError(e)))
                .finally(() => setAnswering(false));
            }}
          >
            提交
          </Button>,
        ]}
      >
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {pendingInput?.prompt}
        </Typography.Paragraph>
        {pendingInput?.options.multiline ? (
          <Input.TextArea
            rows={4}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
          />
        ) : pendingInput?.options.password ? (
          <Input.Password
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
            onPressEnter={() => {
              setAnswering(true);
              void onAnswerInput(inputValue)
                .catch((e) => message.error(formatApiError(e)))
                .finally(() => setAnswering(false));
            }}
          />
        ) : (
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            autoFocus
            onPressEnter={() => {
              setAnswering(true);
              void onAnswerInput(inputValue)
                .catch((e) => message.error(formatApiError(e)))
                .finally(() => setAnswering(false));
            }}
          />
        )}
      </Modal>
    </section>
  );
}
