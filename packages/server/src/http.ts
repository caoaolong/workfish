import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { apiError } from './errors.js';
import { getBootstrapState, initializeWorkspace, type InitRequest } from './bootstrap.js';
import { loadConfig, updateConfig, type WorkfishConfig } from './config.js';
import { probeRuntime } from './runtime-probe.js';
import { ensureWorkspaceSkeleton } from './workspace.js';
import {
  deleteTypeById,
  getNodes,
  getTypes,
  getWorkflowById,
  handleCatalogError,
  listWorkflows,
  putTypeById,
  putWorkflowById,
} from './catalog-service.js';
import { getEnvironmentCatalog, putEnvironmentCatalog } from './environments-service.js';
import { startWorkspaceWatch } from './watch.js';

const JSON_CT = { 'Content-Type': 'application/json; charset=utf-8' };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_CT);
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  sendJson(res, status, apiError(code, message, details));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function isRuntime(value: unknown): value is 'node' | 'python' {
  return value === 'node' || value === 'python';
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname;

  try {
    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/bootstrap') {
      const body = await getBootstrapState();
      sendJson(res, 200, body);
      return;
    }

    if (method === 'POST' && pathname === '/api/init') {
      const body = (await readJsonBody(req)) as InitRequest;
      if (!isRuntime(body.runtime)) {
        sendError(res, 400, 'INVALID_REQUEST', 'runtime 必须为 node 或 python');
        return;
      }
      try {
        const result = await initializeWorkspace(body);
        startWorkspaceWatch(result.config.workspacePath);
        sendJson(res, 200, result);
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === 'RUNTIME_NOT_FOUND') {
          sendError(res, 400, 'RUNTIME_NOT_FOUND', err.message);
          return;
        }
        sendError(res, 500, 'INIT_FAILED', err.message);
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/runtime/probe') {
      const body = (await readJsonBody(req)) as { runtime?: unknown; runtimePath?: string };
      if (!isRuntime(body.runtime)) {
        sendError(res, 400, 'INVALID_REQUEST', 'runtime 必须为 node 或 python');
        return;
      }
      const probe = await probeRuntime(body.runtime, body.runtimePath);
      if (!probe.ok) {
        sendError(res, 400, 'RUNTIME_NOT_FOUND', probe.message ?? '运行时不可用', {
          path: probe.path,
        });
        return;
      }
      sendJson(res, 200, probe);
      return;
    }

    if (method === 'GET' && pathname === '/api/config') {
      const config = loadConfig();
      if (!config) {
        sendError(res, 404, 'CONFIG_NOT_FOUND', '尚未初始化');
        return;
      }
      sendJson(res, 200, config);
      return;
    }

    if (method === 'PUT' && pathname === '/api/config') {
      const config = loadConfig();
      if (!config) {
        sendError(res, 404, 'CONFIG_NOT_FOUND', '尚未初始化');
        return;
      }
      const body = (await readJsonBody(req)) as Partial<WorkfishConfig>;
      const runtime = isRuntime(body.runtime) ? body.runtime : config.runtime;
      const runtimePath =
        typeof body.runtimePath === 'string' ? body.runtimePath : config.runtimePath;
      const workspacePath = path.resolve(
        typeof body.workspacePath === 'string' ? body.workspacePath : config.workspacePath,
      );

      if (workspacePath !== path.resolve(config.workspacePath)) {
        ensureWorkspaceSkeleton(workspacePath, runtime);
      }

      const probe = await probeRuntime(runtime, runtimePath);
      if (!probe.ok) {
        sendError(res, 400, 'RUNTIME_NOT_FOUND', probe.message ?? '运行时不可用');
        return;
      }

      const next = updateConfig({
        workspacePath,
        runtime,
        runtimePath: probe.path ?? runtimePath,
        runtimeVersion: probe.version ?? config.runtimeVersion,
      });

      startWorkspaceWatch(next.workspacePath);
      sendJson(res, 200, {
        config: next,
        ...(probe.warning ? { warning: probe.warning } : {}),
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/nodes') {
      try {
        sendJson(res, 200, getNodes());
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/nodes/rescan') {
      try {
        sendJson(res, 200, getNodes(true));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/types') {
      try {
        sendJson(res, 200, getTypes());
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const typePut = pathname.match(/^\/api\/types\/([^/]+)$/);
    if (method === 'PUT' && typePut) {
      const id = decodeURIComponent(typePut[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, putTypeById(id, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const typeDelete = pathname.match(/^\/api\/types\/([^/]+)$/);
    if (method === 'DELETE' && typeDelete) {
      const id = decodeURIComponent(typeDelete[1] ?? '');
      try {
        deleteTypeById(id);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/environments') {
      try {
        sendJson(res, 200, getEnvironmentCatalog());
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'PUT' && pathname === '/api/environments') {
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, putEnvironmentCatalog(body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/workflows') {
      try {
        sendJson(res, 200, listWorkflows());
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const workflowGet = pathname.match(/^\/api\/workflows\/([^/]+)$/);
    if (method === 'GET' && workflowGet) {
      const id = decodeURIComponent(workflowGet[1] ?? '');
      try {
        sendJson(res, 200, getWorkflowById(id));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const workflowPut = pathname.match(/^\/api\/workflows\/([^/]+)$/);
    if (method === 'PUT' && workflowPut) {
      const id = decodeURIComponent(workflowPut[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, putWorkflowById(id, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    sendError(res, 404, 'NOT_FOUND', `未知路由: ${method} ${pathname}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : '内部错误';
    if (message.includes('JSON')) {
      sendError(res, 400, 'INVALID_REQUEST', '请求体必须是合法 JSON');
      return;
    }
    sendError(res, 500, 'INTERNAL_ERROR', message);
  }
}
