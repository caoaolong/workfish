import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../theme.js';

export type RunTerminalLineKind = 'out' | 'log' | 'info' | 'error' | 'ok';

export type RunTerminalHandle = {
  clear: () => void;
  writeLine: (text: string, kind?: RunTerminalLineKind) => void;
  fit: () => void;
};

const KIND_ANSI: Record<RunTerminalLineKind, string> = {
  out: '\x1b[37m',
  log: '\x1b[90m',
  info: '\x1b[36m',
  error: '\x1b[31m',
  ok: '\x1b[32m',
};

type Props = {
  className?: string;
  /** 终端可视区域高度 */
  height?: number;
};

/** 基于 xterm 的只读虚拟终端，用于展示脚本运行输出 */
export const RunTerminal = forwardRef<RunTerminalHandle, Props>(function RunTerminal(
  { className, height = 320 },
  ref,
) {
  const { mode } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const isDark = mode === 'dark';
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35,
      theme: isDark
        ? {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#0d1117',
            selectionBackground: '#264f78',
          }
        : {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#1e1e1e',
            selectionBackground: '#264f78',
          },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // 容器尚未布局完成时忽略
      }
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [mode]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        termRef.current?.clear();
        termRef.current?.reset();
      },
      writeLine: (text, kind = 'out') => {
        const term = termRef.current;
        if (!term) {
          return;
        }
        const color = KIND_ANSI[kind];
        const lines = String(text).split(/\r?\n/);
        for (const line of lines) {
          term.writeln(`${color}${line}\x1b[0m`);
        }
      },
      fit: () => {
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
      },
    }),
    [],
  );

  return (
    <div
      className={`wf-run-terminal${className ? ` ${className}` : ''}`}
      style={{ height }}
      ref={hostRef}
    />
  );
});
