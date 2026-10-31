import { createRunSession, waitSessionDone } from './run-session.js';

export type NodeRunRequest = {
  inputs?: Record<string, unknown>;
  envId?: string;
};

export type NodeRunResult = {
  outputs: unknown;
  logs: string;
  durationMs: number;
};

/** 同步运行：创建会话并等待结束（无前端交互时 wf_input 会等待超时后失败） */
export async function runNodeById(id: string, body: unknown): Promise<NodeRunResult> {
  const { sessionId } = await createRunSession(id, body);
  const session = await waitSessionDone(sessionId);
  const result = session.result!;
  if (!result.ok) {
    throw Object.assign(new Error(result.error ?? '脚本执行失败'), {
      code: result.code ?? 'RUN_FAILED',
    });
  }
  const logs = session.events
    .filter((e) => e.type === 'log')
    .map((e) => (e as { text: string }).text)
    .join('\n');
  return { outputs: result.outputs ?? null, logs, durationMs: result.durationMs };
}
