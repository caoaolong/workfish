import { useCallback, useRef, useState } from 'react';
import {
  answerRunInput,
  createRunSession,
  formatApiError,
  killRunSession,
  type InputRequestOption,
  type RunEvent,
} from '../api/client.js';
import type { NodeRunRequest } from './EditorNodeActionsContext.js';
import type { RunTerminalLineKind } from './RunTerminal.js';

export type ConsoleLine = {
  text: string;
  kind: RunTerminalLineKind;
};

export type ConsoleTab = {
  key: string;
  title: string;
  typeId: string;
  status: 'idle' | 'running' | 'ok' | 'error';
  lines: ConsoleLine[];
  sessionId: string | null;
  durationMs?: number;
  error?: string;
};

export type ConsoleInputRequest = {
  tabKey: string;
  requestId: string;
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

/** 工作流底部控制台：按画布节点实例分 Tab 管理运行会话与输出 */
export function useWorkflowConsole() {
  const [tabs, setTabs] = useState<ConsoleTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pendingInput, setPendingInput] = useState<ConsoleInputRequest | null>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const sessionByTabRef = useRef<Map<string, string>>(new Map());
  /** 会话创建完成前已被用户中断的 Tab */
  const abortedTabsRef = useRef<Set<string>>(new Set());

  const patchTab = useCallback((key: string, patch: Partial<ConsoleTab> | ((t: ConsoleTab) => ConsoleTab)) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.key !== key) {
          return t;
        }
        return typeof patch === 'function' ? patch(t) : { ...t, ...patch };
      }),
    );
  }, []);

  const appendLine = useCallback((key: string, text: string, kind: RunTerminalLineKind) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.key === key ? { ...t, lines: [...t.lines, { text, kind }] } : t,
      ),
    );
  }, []);

  const stopTabSession = useCallback((key: string) => {
    const es = eventSourcesRef.current.get(key);
    if (es) {
      es.close();
      eventSourcesRef.current.delete(key);
    }
    const sid = sessionByTabRef.current.get(key);
    if (sid) {
      sessionByTabRef.current.delete(key);
      killRunSession(sid).catch(() => undefined);
    }
  }, []);

  const closeTab = useCallback(
    (key: string) => {
      stopTabSession(key);
      setPendingInput((p) => (p?.tabKey === key ? null : p));
      setTabs((prev) => {
        const next = prev.filter((t) => t.key !== key);
        setActiveKey((cur) => {
          if (cur !== key) {
            return cur;
          }
          return next[next.length - 1]?.key;
        });
        if (next.length === 0) {
          setOpen(false);
        }
        return next;
      });
    },
    [stopTabSession],
  );

  const clearTab = useCallback(
    (key: string) => {
      stopTabSession(key);
      patchTab(key, {
        lines: [],
        status: 'idle',
        sessionId: null,
        durationMs: undefined,
        error: undefined,
      });
    },
    [patchTab, stopTabSession],
  );

  /** 强制结束指定画布节点上的运行会话 */
  const stopRun = useCallback(
    (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab || tab.status !== 'running') {
        return;
      }
      abortedTabsRef.current.add(key);
      stopTabSession(key);
      setPendingInput((p) => (p?.tabKey === key ? null : p));
      appendLine(key, '── 已中断 ──', 'error');
      patchTab(key, {
        status: 'error',
        error: '已中断',
        sessionId: null,
        durationMs: undefined,
      });
    },
    [appendLine, patchTab, stopTabSession],
  );

  const startRun = useCallback(
    async (req: NodeRunRequest) => {
      const key = req.instanceId;
      const title = req.name?.trim() || req.id;
      abortedTabsRef.current.delete(key);
      setOpen(true);
      setActiveKey(key);
      setPendingInput((p) => (p?.tabKey === key ? null : p));
      stopTabSession(key);

      setTabs((prev) => {
        const existing = prev.find((t) => t.key === key);
        const nextTab: ConsoleTab = {
          key,
          title,
          typeId: req.id,
          status: 'running',
          lines: [{ text: `$ run ${req.id}`, kind: 'info' }],
          sessionId: null,
        };
        if (existing) {
          return prev.map((t) => (t.key === key ? nextTab : t));
        }
        return [...prev, nextTab];
      });

      try {
        const { sessionId: sid } = await createRunSession(req.id, {
          ...(req.inputs ? { inputs: req.inputs } : {}),
          ...(req.envId ? { envId: req.envId } : {}),
        });
        if (abortedTabsRef.current.has(key)) {
          abortedTabsRef.current.delete(key);
          killRunSession(sid).catch(() => undefined);
          return;
        }
        sessionByTabRef.current.set(key, sid);
        patchTab(key, { sessionId: sid });

        const es = new EventSource(`/api/runs/${encodeURIComponent(sid)}/events`);
        eventSourcesRef.current.set(key, es);
        es.onmessage = (ev) => {
          try {
            const event = JSON.parse(ev.data) as RunEvent;
            if (event.type === 'log') {
              appendLine(key, event.text, 'log');
            } else if (event.type === 'printf') {
              appendLine(key, event.text, 'out');
            } else if (event.type === 'input_request') {
              appendLine(key, `? ${event.prompt}`, 'info');
              setPendingInput({
                tabKey: key,
                requestId: event.id,
                prompt: event.prompt,
                options: event.options,
              });
            } else if (event.type === 'done') {
              if (event.ok) {
                appendLine(key, `── 完成 · ${event.durationMs} ms ──`, 'ok');
                if (event.outputs !== undefined) {
                  appendLine(key, stringify(event.outputs), 'ok');
                }
                patchTab(key, {
                  status: 'ok',
                  durationMs: event.durationMs,
                  error: undefined,
                });
              } else {
                appendLine(
                  key,
                  `── 失败 · ${event.durationMs} ms ──\n${event.error ?? '未知错误'}`,
                  'error',
                );
                patchTab(key, {
                  status: 'error',
                  durationMs: event.durationMs,
                  error: event.error,
                });
              }
              sessionByTabRef.current.delete(key);
              eventSourcesRef.current.delete(key);
              es.close();
              setPendingInput((p) => (p?.tabKey === key ? null : p));
            }
          } catch {
            // ignore
          }
        };
        es.onerror = () => {
          appendLine(key, '连接中断', 'error');
          patchTab(key, { status: 'error', error: '连接中断' });
          eventSourcesRef.current.delete(key);
          es.close();
        };
      } catch (e) {
        const msg = formatApiError(e);
        appendLine(key, msg, 'error');
        patchTab(key, { status: 'error', error: msg });
      }
    },
    [appendLine, patchTab, stopTabSession],
  );

  const answerPendingInput = useCallback(async (value: string) => {
    const pending = pendingInput;
    if (!pending) {
      return;
    }
    const sid = sessionByTabRef.current.get(pending.tabKey);
    if (!sid) {
      setPendingInput(null);
      return;
    }
    appendLine(
      pending.tabKey,
      `> ${pending.options.password ? '******' : value}`,
      'info',
    );
    await answerRunInput(sid, { requestId: pending.requestId, value });
    setPendingInput(null);
  }, [appendLine, pendingInput]);

  const cancelPendingInput = useCallback(async () => {
    const pending = pendingInput;
    if (!pending) {
      return;
    }
    const sid = sessionByTabRef.current.get(pending.tabKey);
    appendLine(pending.tabKey, '（已取消输入）', 'log');
    setPendingInput(null);
    if (sid) {
      await answerRunInput(sid, {
        requestId: pending.requestId,
        cancelled: true,
      }).catch(() => killRunSession(sid));
    }
  }, [appendLine, pendingInput]);

  return {
    open,
    setOpen,
    tabs,
    activeKey,
    setActiveKey,
    startRun,
    stopRun,
    closeTab,
    clearTab,
    pendingInput,
    answerPendingInput,
    cancelPendingInput,
  };
}
