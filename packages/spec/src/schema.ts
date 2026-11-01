export type FieldSpec = {
  type: 'string' | 'number' | 'boolean' | 'null' | 'any' | 'array' | 'object';
  description?: string;
  optional?: boolean;
  items?: FieldSpec;
  properties?: Record<string, FieldSpec>;
};

/** 节点声明需要绑定的环境槽位（如 source / target） */
export type EnvRequirement = {
  key: string;
  name: string;
  description?: string;
};

export type NodeSpec = {
  id: string;
  name: string;
  description?: string;
  version: string;
  inputs: Record<string, FieldSpec>;
  outputs: Record<string, FieldSpec>;
  /** 非空时，工作流实例必须为每个 key 绑定一个环境 */
  environments?: EnvRequirement[];
};

export type EnvironmentItem = {
  id: string;
  name: string;
  /** 环境变量键值对（本地明文存储） */
  values: Record<string, string>;
};

export type EnvironmentCatalog = {
  version: 1;
  items: EnvironmentItem[];
};

/** 同一监控项目下的某个环境入口 */
export type MonitorEnvLink = {
  name: string;
  url: string;
};

/** 监控台项目卡片：底部可切换多个环境链接 */
export type MonitorItem = {
  id: string;
  name: string;
  description?: string;
  environments: MonitorEnvLink[];
};

export type MonitorCatalog = {
  version: 1;
  items: MonitorItem[];
};

export type WorkflowNode = {
  id: string;
  typeId: string;
  position: { x: number; y: number };
  params?: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
};

export type WorkflowDocument = {
  version: 1;
  id: string;
  name: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
};

export type NodeCatalogItem = {
  id: string;
  path: string;
  status: 'ready' | 'error';
  spec?: NodeSpec;
  errors?: Diagnostic[];
  runtime: 'node' | 'python';
  mtime: string;
};

export type Diagnostic = { path: string; message: string };
