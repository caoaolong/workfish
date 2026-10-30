import { homedir } from 'node:os';
import path from 'node:path';

/** 默认工作区：~/.workfish */
export function getDefaultWorkspacePath(): string {
  return path.join(homedir(), '.workfish');
}

/** 应用配置固定路径：~/.workfish/config.json */
export function getAppConfigFilePath(): string {
  return path.join(getDefaultWorkspacePath(), 'config.json');
}
