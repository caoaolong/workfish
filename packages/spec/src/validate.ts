import type {
  Diagnostic,
  EnvironmentCatalog,
  EnvironmentItem,
  EnvRequirement,
  FieldSpec,
  MonitorCatalog,
  MonitorEnvLink,
  MonitorItem,
  NodeSpec,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from './schema.js';

export type { Diagnostic };

export type ValidateResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Diagnostic[] };

const FIELD_TYPES: readonly FieldSpec['type'][] = [
  'string',
  'number',
  'boolean',
  'null',
  'any',
  'array',
  'object',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushError(errors: Diagnostic[], path: string, message: string): void {
  errors.push({ path, message });
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: Diagnostic[],
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    pushError(errors, path, `缺少必填字段 ${key}`);
    return undefined;
  }
  if (typeof value !== 'string') {
    pushError(errors, path, `${key} 必须是字符串`);
    return undefined;
  }
  return value;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  errors: Diagnostic[],
): number | undefined {
  const value = obj[key];
  if (value === undefined) {
    pushError(errors, path, `缺少必填字段 ${key}`);
    return undefined;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    pushError(errors, path, `${key} 必须是数字`);
    return undefined;
  }
  return value;
}

function validateFieldSpecInternal(
  input: unknown,
  path: string,
  errors: Diagnostic[],
): FieldSpec | undefined {
  if (!isRecord(input)) {
    pushError(errors, path, 'FieldSpec 必须是对象');
    return undefined;
  }

  const typeRaw = input.type;
  if (typeRaw === undefined) {
    pushError(errors, `${path}.type`, '缺少必填字段 type');
    return undefined;
  }
  if (typeof typeRaw !== 'string' || !FIELD_TYPES.includes(typeRaw as FieldSpec['type'])) {
    pushError(errors, `${path}.type`, `type 必须是以下之一: ${FIELD_TYPES.join(', ')}`);
    return undefined;
  }
  const type = typeRaw as FieldSpec['type'];

  const field: FieldSpec = { type };

  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      pushError(errors, `${path}.description`, 'description 必须是字符串');
    } else {
      field.description = input.description;
    }
  }

  if (input.optional !== undefined) {
    if (typeof input.optional !== 'boolean') {
      pushError(errors, `${path}.optional`, 'optional 必须是布尔值');
    } else {
      field.optional = input.optional;
    }
  }

  if (type === 'array' && input.items !== undefined) {
    const items = validateFieldSpecInternal(input.items, `${path}.items`, errors);
    if (items) {
      field.items = items;
    }
  } else if (type !== 'array' && input.items !== undefined) {
    const items = validateFieldSpecInternal(input.items, `${path}.items`, errors);
    if (items) {
      field.items = items;
    }
  }

  if (input.properties !== undefined) {
    if (!isRecord(input.properties)) {
      pushError(errors, `${path}.properties`, 'properties 必须是对象');
    } else {
      const properties: Record<string, FieldSpec> = {};
      for (const [key, propValue] of Object.entries(input.properties)) {
        const prop = validateFieldSpecInternal(
          propValue,
          `${path}.properties.${key}`,
          errors,
        );
        if (prop) {
          properties[key] = prop;
        }
      }
      field.properties = properties;
    }
  }

  return field;
}

function validateFieldSpecMap(
  input: unknown,
  path: string,
  errors: Diagnostic[],
): Record<string, FieldSpec> | undefined {
  if (!isRecord(input)) {
    pushError(errors, path, '必须是对象');
    return undefined;
  }
  const result: Record<string, FieldSpec> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = validateFieldSpecInternal(value, `${path}.${key}`, errors);
    if (field) {
      result[key] = field;
    }
  }
  return result;
}

export function validateNodeSpec(input: unknown): ValidateResult<NodeSpec> {
  const errors: Diagnostic[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'NodeSpec 必须是对象' }] };
  }

  const id = requireString(input, 'id', 'id', errors);
  const name = requireString(input, 'name', 'name', errors);
  const version = requireString(input, 'version', 'version', errors);

  let description: string | undefined;
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      pushError(errors, 'description', 'description 必须是字符串');
    } else {
      description = input.description;
    }
  }

  const inputs = validateFieldSpecMap(input.inputs, 'inputs', errors);
  const outputs = validateFieldSpecMap(input.outputs, 'outputs', errors);

  let environments: EnvRequirement[] | undefined;
  if (input.environments !== undefined) {
    if (!Array.isArray(input.environments)) {
      pushError(errors, 'environments', 'environments 必须是数组');
    } else {
      environments = [];
      const seen = new Set<string>();
      input.environments.forEach((raw, index) => {
        const path = `environments[${index}]`;
        if (!isRecord(raw)) {
          pushError(errors, path, '环境槽位必须是对象');
          return;
        }
        const key = requireString(raw, 'key', `${path}.key`, errors);
        const envName = requireString(raw, 'name', `${path}.name`, errors);
        let envDesc: string | undefined;
        if (raw.description !== undefined) {
          if (typeof raw.description !== 'string') {
            pushError(errors, `${path}.description`, 'description 必须是字符串');
          } else {
            envDesc = raw.description;
          }
        }
        if (key && seen.has(key)) {
          pushError(errors, `${path}.key`, `重复的环境槽位 key: ${key}`);
        }
        if (key) {
          seen.add(key);
        }
        if (key && envName) {
          const req: EnvRequirement = { key, name: envName };
          if (envDesc !== undefined) {
            req.description = envDesc;
          }
          environments!.push(req);
        }
      });
    }
  }

  if (errors.length > 0 || !id || !name || !version || !inputs || !outputs) {
    return { ok: false, errors };
  }

  const spec: NodeSpec = { id, name, version, inputs, outputs };
  if (description !== undefined) {
    spec.description = description;
  }
  if (environments && environments.length > 0) {
    spec.environments = environments;
  }
  return { ok: true, value: spec };
}

function validatePortRef(
  input: unknown,
  path: string,
  errors: Diagnostic[],
): { nodeId: string; port: string } | undefined {
  if (!isRecord(input)) {
    pushError(errors, path, '必须是对象');
    return undefined;
  }
  const nodeId = requireString(input, 'nodeId', `${path}.nodeId`, errors);
  const port = requireString(input, 'port', `${path}.port`, errors);
  if (!nodeId || !port) {
    return undefined;
  }
  return { nodeId, port };
}

function validateWorkflowNode(input: unknown, path: string, errors: Diagnostic[]): WorkflowNode | undefined {
  if (!isRecord(input)) {
    pushError(errors, path, '节点必须是对象');
    return undefined;
  }
  const id = requireString(input, 'id', `${path}.id`, errors);
  const typeId = requireString(input, 'typeId', `${path}.typeId`, errors);
  const positionRaw = input.position;
  if (!isRecord(positionRaw)) {
    pushError(errors, `${path}.position`, 'position 必须是对象');
    return undefined;
  }
  const x = requireNumber(positionRaw, 'x', `${path}.position.x`, errors);
  const y = requireNumber(positionRaw, 'y', `${path}.position.y`, errors);

  let params: Record<string, unknown> | undefined;
  if (input.params !== undefined) {
    if (!isRecord(input.params)) {
      pushError(errors, `${path}.params`, 'params 必须是对象');
    } else {
      params = input.params;
    }
  }

  if (!id || !typeId || x === undefined || y === undefined) {
    return undefined;
  }
  const node: WorkflowNode = { id, typeId, position: { x, y } };
  if (params) {
    node.params = params;
  }
  return node;
}

function validateWorkflowEdge(input: unknown, path: string, errors: Diagnostic[]): WorkflowEdge | undefined {
  if (!isRecord(input)) {
    pushError(errors, path, '边必须是对象');
    return undefined;
  }
  const id = requireString(input, 'id', `${path}.id`, errors);
  const source = validatePortRef(input.source, `${path}.source`, errors);
  const target = validatePortRef(input.target, `${path}.target`, errors);
  if (!id || !source || !target) {
    return undefined;
  }
  return { id, source, target };
}

export function validateWorkflowDocument(input: unknown): ValidateResult<WorkflowDocument> {
  const errors: Diagnostic[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'WorkflowDocument 必须是对象' }] };
  }

  if (input.version !== 1) {
    pushError(errors, 'version', 'version 必须为 1');
  }

  const id = requireString(input, 'id', 'id', errors);
  const name = requireString(input, 'name', 'name', errors);
  const updatedAt = requireString(input, 'updatedAt', 'updatedAt', errors);

  if (!Array.isArray(input.nodes)) {
    pushError(errors, 'nodes', 'nodes 必须是数组');
  }
  if (!Array.isArray(input.edges)) {
    pushError(errors, 'edges', 'edges 必须是数组');
  }

  const nodes: WorkflowNode[] = [];
  if (Array.isArray(input.nodes)) {
    input.nodes.forEach((node, index) => {
      const validated = validateWorkflowNode(node, `nodes[${index}]`, errors);
      if (validated) {
        nodes.push(validated);
      }
    });
  }

  const edges: WorkflowEdge[] = [];
  if (Array.isArray(input.edges)) {
    input.edges.forEach((edge, index) => {
      const validated = validateWorkflowEdge(edge, `edges[${index}]`, errors);
      if (validated) {
        edges.push(validated);
      }
    });
  }

  let viewport: WorkflowDocument['viewport'];
  if (input.viewport !== undefined) {
    if (!isRecord(input.viewport)) {
      pushError(errors, 'viewport', 'viewport 必须是对象');
    } else {
      const vx = requireNumber(input.viewport, 'x', 'viewport.x', errors);
      const vy = requireNumber(input.viewport, 'y', 'viewport.y', errors);
      const zoom = requireNumber(input.viewport, 'zoom', 'viewport.zoom', errors);
      if (vx !== undefined && vy !== undefined && zoom !== undefined) {
        viewport = { x: vx, y: vy, zoom };
      }
    }
  }

  if (errors.length > 0 || !id || !name || !updatedAt || input.version !== 1) {
    return { ok: false, errors };
  }

  const doc: WorkflowDocument = {
    version: 1,
    id,
    name,
    updatedAt,
    nodes,
    edges,
  };
  if (viewport) {
    doc.viewport = viewport;
  }
  return { ok: true, value: doc };
}

export function validateEnvironmentCatalog(input: unknown): ValidateResult<EnvironmentCatalog> {
  const errors: Diagnostic[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'EnvironmentCatalog 必须是对象' }] };
  }
  if (input.version !== 1) {
    pushError(errors, 'version', 'version 必须为 1');
  }
  if (!Array.isArray(input.items)) {
    pushError(errors, 'items', 'items 必须是数组');
  }
  // 兼容旧文件：遗留的 groups 字段直接忽略，不再建模分组层级。

  const items: EnvironmentItem[] = [];
  const itemIds = new Set<string>();
  if (Array.isArray(input.items)) {
    input.items.forEach((raw, index) => {
      const path = `items[${index}]`;
      if (!isRecord(raw)) {
        pushError(errors, path, '环境必须是对象');
        return;
      }
      const id = requireString(raw, 'id', `${path}.id`, errors);
      const name = requireString(raw, 'name', `${path}.name`, errors);
      if (id && itemIds.has(id)) {
        pushError(errors, `${path}.id`, `重复的环境 id: ${id}`);
      }
      if (id) {
        itemIds.add(id);
      }
      if (!isRecord(raw.values)) {
        pushError(errors, `${path}.values`, 'values 必须是对象');
        return;
      }
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.values)) {
        if (typeof v !== 'string') {
          pushError(errors, `${path}.values.${k}`, '环境变量值必须是字符串');
        } else {
          values[k] = v;
        }
      }
      if (id && name) {
        // 兼容旧文件：遗留的 groupId 直接丢弃。
        items.push({ id, name, values });
      }
    });
  }

  if (errors.length > 0 || input.version !== 1) {
    return { ok: false, errors };
  }
  return { ok: true, value: { version: 1, items } };
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateMonitorCatalog(input: unknown): ValidateResult<MonitorCatalog> {
  const errors: Diagnostic[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'MonitorCatalog 必须是对象' }] };
  }
  if (input.version !== 1) {
    pushError(errors, 'version', 'version 必须为 1');
  }
  if (!Array.isArray(input.items)) {
    pushError(errors, 'items', 'items 必须是数组');
  }

  const items: MonitorItem[] = [];
  const itemIds = new Set<string>();
  if (Array.isArray(input.items)) {
    input.items.forEach((raw, index) => {
      const path = `items[${index}]`;
      if (!isRecord(raw)) {
        pushError(errors, path, '监控项必须是对象');
        return;
      }
      const id = requireString(raw, 'id', `${path}.id`, errors);
      const name = requireString(raw, 'name', `${path}.name`, errors);
      if (id && itemIds.has(id)) {
        pushError(errors, `${path}.id`, `重复的监控 id: ${id}`);
      }
      if (id) {
        itemIds.add(id);
      }

      let description: string | undefined;
      if (raw.description !== undefined) {
        if (typeof raw.description !== 'string') {
          pushError(errors, `${path}.description`, 'description 必须是字符串');
        } else if (raw.description.trim()) {
          description = raw.description.trim();
        }
      }

      // 兼容旧数据：仅有 url 时迁移为单一「默认」环境
      let rawEnvs: unknown = raw.environments;
      if (!Array.isArray(rawEnvs) && typeof raw.url === 'string' && raw.url.trim()) {
        rawEnvs = [{ name: '默认', url: raw.url.trim() }];
      }
      if (!Array.isArray(rawEnvs)) {
        pushError(errors, `${path}.environments`, 'environments 必须是数组');
        return;
      }
      if (rawEnvs.length === 0) {
        pushError(errors, `${path}.environments`, '至少需要一个环境链接');
      }

      const environments: MonitorEnvLink[] = [];
      const envNames = new Set<string>();
      rawEnvs.forEach((envRaw, envIndex) => {
        const envPath = `${path}.environments[${envIndex}]`;
        if (!isRecord(envRaw)) {
          pushError(errors, envPath, '环境链接必须是对象');
          return;
        }
        const envName = requireString(envRaw, 'name', `${envPath}.name`, errors);
        const envUrl = requireString(envRaw, 'url', `${envPath}.url`, errors);
        if (envName) {
          const key = envName.toLowerCase();
          if (envNames.has(key)) {
            pushError(errors, `${envPath}.name`, `重复的环境名: ${envName}`);
          } else {
            envNames.add(key);
          }
        }
        if (envUrl && !isHttpUrl(envUrl)) {
          pushError(errors, `${envPath}.url`, 'url 必须是 http(s) 地址');
        }
        if (envName && envUrl && isHttpUrl(envUrl)) {
          environments.push({ name: envName, url: envUrl });
        }
      });

      if (id && name && environments.length > 0) {
        const item: MonitorItem = { id, name, environments };
        if (description) {
          item.description = description;
        }
        items.push(item);
      }
    });
  }

  if (errors.length > 0 || input.version !== 1) {
    return { ok: false, errors };
  }
  return { ok: true, value: { version: 1, items } };
}
