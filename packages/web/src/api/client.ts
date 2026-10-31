import type { EnvironmentCatalog } from '@workfish/spec';
import type {
  ApiErrorBody,
  BootstrapResponse,
  InitRequest,
  InitResponse,
  NodeCatalogItem,
  NodeSpec,
  RuntimeProbeResult,
  WorkfishConfig,
  WorkfishRuntime,
  WorkflowDocument,
  WorkflowSummary,
} from '../types.js';

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.details = details;
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiClientError('INVALID_RESPONSE', '服务器返回了非 JSON 响应');
  }
}

function throwIfError(res: Response, data: unknown): void {
  if (res.ok) {
    return;
  }
  const body = data as ApiErrorBody;
  if (body?.error?.code) {
    throw new ApiClientError(body.error.code, body.error.message, body.error.details);
  }
  throw new ApiClientError('HTTP_ERROR', `请求失败 (${res.status})`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  const data = await parseJson(res);
  throwIfError(res, data);
  return data as T;
}

export function getBootstrap(): Promise<BootstrapResponse> {
  return request<BootstrapResponse>('/api/bootstrap');
}

export function postInit(body: InitRequest): Promise<InitResponse> {
  return request<InitResponse>('/api/init', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function postRuntimeProbe(
  runtime: WorkfishRuntime,
  runtimePath?: string,
): Promise<RuntimeProbeResult> {
  const payload: { runtime: WorkfishRuntime; runtimePath?: string } = { runtime };
  const trimmed = runtimePath?.trim();
  if (trimmed) {
    payload.runtimePath = trimmed;
  }
  return request<RuntimeProbeResult>('/api/runtime/probe', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getConfig(): Promise<WorkfishConfig> {
  return request<WorkfishConfig>('/api/config');
}

export function getNodes(): Promise<NodeCatalogItem[]> {
  return request<NodeCatalogItem[]>('/api/nodes');
}

export function postNodesRescan(): Promise<NodeCatalogItem[]> {
  return request<NodeCatalogItem[]>('/api/nodes/rescan', { method: 'POST' });
}

export function deleteNode(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/nodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function putNodeMeta(id: string, meta: NodeSpec): Promise<NodeCatalogItem> {
  return request<NodeCatalogItem>(`/api/nodes/${encodeURIComponent(id)}/meta`, {
    method: 'PUT',
    body: JSON.stringify(meta),
  });
}

export type NodeRunRequest = {
  inputs?: Record<string, unknown>;
  envId?: string;
};

export type NodeRunResult = {
  outputs: unknown;
  logs: string;
  durationMs: number;
};

export function runNode(id: string, body: NodeRunRequest): Promise<NodeRunResult> {
  return request<NodeRunResult>(`/api/nodes/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export type RunSessionInfo = {
  sessionId: string;
};

export type InputRequestOption = {
  default: string;
  password: boolean;
  multiline: boolean;
};

export type RunEvent =
  | { seq: number; type: 'log'; text: string }
  | { seq: number; type: 'printf'; text: string }
  | { seq: number; type: 'input_request'; id: string; prompt: string; options: InputRequestOption }
  | {
      seq: number;
      type: 'done';
      ok: boolean;
      outputs?: unknown;
      error?: string;
      durationMs: number;
    };

export function createRunSession(
  nodeId: string,
  body: NodeRunRequest,
): Promise<RunSessionInfo> {
  return request<RunSessionInfo>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ nodeId, ...body }),
  });
}

export function answerRunInput(
  sessionId: string,
  body: { requestId: string; value?: string; cancelled?: boolean },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function killRunSession(sessionId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export function getEnvironments(): Promise<EnvironmentCatalog> {
  return request<EnvironmentCatalog>('/api/environments');
}

export function putEnvironments(body: EnvironmentCatalog): Promise<EnvironmentCatalog> {
  return request<EnvironmentCatalog>('/api/environments', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function listWorkflows(): Promise<WorkflowSummary[]> {
  return request<WorkflowSummary[]>('/api/workflows');
}

export function getWorkflow(id: string): Promise<WorkflowDocument> {
  return request<WorkflowDocument>(`/api/workflows/${encodeURIComponent(id)}`);
}

export function putWorkflow(id: string, body: WorkflowDocument): Promise<WorkflowDocument> {
  return request<WorkflowDocument>(`/api/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function formatApiError(err: unknown): string {
  if (err instanceof ApiClientError) {
    return `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return '未知错误';
}
