import { existsSync, mkdirSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { invalidateCatalogCache } from './catalog-service.js';

const DEBOUNCE_MS = 300;

let watchers: FSWatcher[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let watchedWorkspace: string | undefined;

function scheduleInvalidate(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    invalidateCatalogCache();
  }, DEBOUNCE_MS);
}

export function stopWorkspaceWatch(): void {
  for (const w of watchers) {
    w.close();
  }
  watchers = [];
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  watchedWorkspace = undefined;
}

function watchDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  try {
    const w = watch(dir, { recursive: true }, () => {
      scheduleInvalidate();
    });
    watchers.push(w);
  } catch (err) {
    console.warn(`[workfish] 无法监视目录 ${dir}:`, err);
  }
}

/** 监视 workspace 下 nodes/，变更后 debounce 并失效 catalog 缓存 */
export function startWorkspaceWatch(workspacePath: string): void {
  const resolved = path.resolve(workspacePath);
  if (watchedWorkspace === resolved) {
    return;
  }
  stopWorkspaceWatch();
  watchedWorkspace = resolved;
  watchDir(path.join(resolved, 'nodes'));
}
