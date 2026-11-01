import { createContext, useContext } from 'react';
import type { EnvironmentCatalog, NodeSpec } from '@workfish/spec';

/** 画布节点运行态（与控制台 Tab status 对齐） */
export type NodeRunStatus = 'idle' | 'running' | 'ok' | 'error';

/** 画布节点工具栏发起的单节点运行请求 */
export type NodeRunRequest = {
  /** 画布节点实例 id（控制台 Tab key） */
  instanceId: string;
  /** 脚本 / 节点类型 id（用于启动运行 API） */
  id: string;
  name?: string;
  spec?: NodeSpec;
  envId?: string;
  inputs?: Record<string, unknown>;
};

export type EditorNodeActions = {
  environments: EnvironmentCatalog;
  /** 画布节点实例 id → 最近一次运行状态；无记录视为 idle */
  runStatusByNodeId: Record<string, NodeRunStatus>;
  requestRun: (req: NodeRunRequest) => void;
  /** 强制结束该画布节点当前运行 */
  stopRun: (instanceId: string) => void;
};

const EditorNodeActionsContext = createContext<EditorNodeActions | null>(null);

export function useEditorNodeActions(): EditorNodeActions | null {
  return useContext(EditorNodeActionsContext);
}

export { EditorNodeActionsContext };
