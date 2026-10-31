import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { apiError } from './errors.js';
import { getBootstrapState, initializeWorkspace, type InitRequest } from './bootstrap.js';
import { loadConfig, updateConfig, type WorkfishConfig } from './config.js';
import { probeRuntime } from './runtime-probe.js';
import { ensureWorkspaceSkeleton } from './workspace.js';
import {
  getNodes,
  getWorkflowById,
  handleCatalogError,
  listWorkflows,
  putWorkflowById,
} from './catalog-service.js';
import { getEnvironmentCatalog, putEnvironmentCatalog } from './environments-service.js';
import { deleteNodeById, putNodeMetaById } from './node-source.js';
import { runNodeById } from './run-service.js';
import {
  addRunSubscriber,
  answerRunInput,
  createRunSession,
  getRunSession,
  killRunSession,
  postRunMessage,
  removeRunSubscriber,
  replayRunEvents,
} from './run-session.js';
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

    const nodeRun = pathname.match(/^\/api\/nodes\/([^/]+)\/run$/);
    if (method === 'POST' && nodeRun) {
      const id = decodeURIComponent(nodeRun[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, await runNodeById(id, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/runs') {
      try {
        const body = (await readJsonBody(req)) as { nodeId?: unknown; inputs?: unknown; envId?: unknown };
        if (typeof body.nodeId !== 'string' || !body.nodeId) {
          sendError(res, 400, 'INVALID_REQUEST', 'nodeId 必须是字符串');
          return;
        }
        sendJson(res, 201, await createRunSession(body.nodeId, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const runEvents = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (method === 'GET' && runEvents) {
      const sid = decodeURIComponent(runEvents[1] ?? '');
      try {
        const session = getRunSession(sid);
        const since = Number(url.searchParams.get('since') ?? '0') || 0;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        for (const event of replayRunEvents(session, since)) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        if (session.status === 'done') {
          res.end();
          return;
        }
        addRunSubscriber(session, res);
        const heartbeat = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            // ignore
          }
        }, 15000);
        req.on('close', () => {
          clearInterval(heartbeat);
          try {
            const current = getRunSession(sid);
            removeRunSubscriber(current, res);
          } catch {
            // 会话可能已被清理
          }
        });
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const runStatus = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (method === 'GET' && runStatus) {
      const sid = decodeURIComponent(runStatus[1] ?? '');
      try {
        const session = getRunSession(sid);
        sendJson(res, 200, {
          sessionId: session.id,
          nodeId: session.nodeId,
          status: session.status,
          pendingInputs: [...session.pendingInputs.values()].map((p) => ({
            id: p.id,
            prompt: p.prompt,
            options: p.options,
          })),
          ...(session.result ? { result: session.result } : {}),
        });
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const runMessages = pathname.match(/^\/api\/runs\/([^/]+)\/messages$/);
    if (method === 'POST' && runMessages) {
      const sid = decodeURIComponent(runMessages[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, await postRunMessage(sid, body));
      } catch (e) {
        const err = handleCatalogError(e);
        const status = (e as { httpStatus?: number }).httpStatus ?? err.status;
        sendError(res, status, err.code, err.message, err.details);
      }
      return;
    }

    const runInput = pathname.match(/^\/api\/runs\/([^/]+)\/input$/);
    if (method === 'POST' && runInput) {
      const sid = decodeURIComponent(runInput[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, answerRunInput(sid, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const runDelete = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (method === 'DELETE' && runDelete) {
      const sid = decodeURIComponent(runDelete[1] ?? '');
      try {
        sendJson(res, 200, killRunSession(sid));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const nodeMeta = pathname.match(/^\/api\/nodes\/([^/]+)\/meta$/);
    if (method === 'PUT' && nodeMeta) {
      const id = decodeURIComponent(nodeMeta[1] ?? '');
      try {
        const body = await readJsonBody(req);
        sendJson(res, 200, putNodeMetaById(id, body));
      } catch (e) {
        const err = handleCatalogError(e);
        sendError(res, err.status, err.code, err.message, err.details);
      }
      return;
    }

    const nodeDelete = pathname.match(/^\/api\/nodes\/([^/]+)$/);
    if (method === 'DELETE' && nodeDelete) {
      const id = decodeURIComponent(nodeDelete[1] ?? '');
      try {
        deleteNodeById(id);
        sendJson(res, 200, { ok: true });
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
