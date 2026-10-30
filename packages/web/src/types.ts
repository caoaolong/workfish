export type WorkfishRuntime = 'node' | 'python';

export type WorkfishConfig = {
  version: 1;
  workspacePath: string;
  runtime: WorkfishRuntime;
  runtimePath: string;
  runtimeVersion: string;
  initializedAt: string;
};

export type RuntimeProbeResult = {
  ok: boolean;
  version?: string;
  path?: string;
  message?: string;
  warning?: string;
};

export type BootstrapResponse = {
  initialized: boolean;
  /** 本机默认工作区绝对路径 */
  defaultWorkspacePath: string;
  config?: WorkfishConfig;
  runtimeHealth?: RuntimeProbeResult;
};

export type InitRequest = {
  workspacePath?: string;
  runtime: WorkfishRuntime;
  runtimePath?: string;
};

export type InitResponse = {
  config: WorkfishConfig;
  warning?: string;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type {
  Diagnostic,
  FieldSpec,
  NodeCatalogItem,
  NodeSpec,
  TypeDef,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '@workfish/spec';

export type WorkflowSummary = {
  id: string;
  name: string;
  updatedAt: string;
};
