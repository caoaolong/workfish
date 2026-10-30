import type { EnvironmentCatalog } from '@workfish/spec';
import type {
  ApiErrorBody,
  BootstrapResponse,
  InitRequest,
  InitResponse,
  NodeCatalogItem,
  RuntimeProbeResult,
  TypeDef,
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

export function getTypes(): Promise<TypeDef[]> {
  return request<TypeDef[]>('/api/types');
}

export function putType(id: string, body: TypeDef): Promise<TypeDef> {
  return request<TypeDef>(`/api/types/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteType(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/types/${encodeURIComponent(id)}`, {
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
