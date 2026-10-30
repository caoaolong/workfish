import type { NodeSpec, TypeDef } from '@workfish/spec';
import type { Edge, Node } from '@xyflow/react';
import type { NodeCatalogItem } from '../types.js';
import type { WorkfishEdgeData, WorkfishNodeData } from './workflowMapper.js';

/** 内置：数据结构节点（按所选 TypeDef 生成字段级输入/输出桩） */
export const BUILTIN_STRUCT_TYPE_ID = 'workfish.struct';

/** params 中保存所选数据结构 id */
export const STRUCT_TYPE_REF_PARAM = 'typeRef';

export const BUILTIN_STRUCT_BASE_SPEC: NodeSpec = {
  id: BUILTIN_STRUCT_TYPE_ID,
  name: '数据结构',
  description: '选择一个数据结构，按其字段生成左侧输入、右侧输出连接桩。',
  version: '1.0.0',
  inputs: {},
  outputs: {},
};

export const BUILTIN_STRUCT_CATALOG_ITEM: NodeCatalogItem = {
  id: BUILTIN_STRUCT_TYPE_ID,
  path: '(builtin)',
  status: 'ready',
  spec: BUILTIN_STRUCT_BASE_SPEC,
  runtime: 'node',
  mtime: '1970-01-01T00:00:00.000Z',
};

export function isBuiltinStructNode(typeId: string): boolean {
  return typeId === BUILTIN_STRUCT_TYPE_ID;
}

export function readStructTypeRef(params?: Record<string, unknown>): string | undefined {
  const raw = params?.[STRUCT_TYPE_REF_PARAM];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

/** 根据所选 TypeDef 生成字段级 inputs / outputs */
export function buildStructNodeSpec(
  typeRef: string | undefined,
  typesMap: Map<string, TypeDef>,
): NodeSpec {
  if (!typeRef) {
    return {
      ...BUILTIN_STRUCT_BASE_SPEC,
      inputs: {},
      outputs: {},
    };
  }
  const def = typesMap.get(typeRef);
  if (!def) {
    return {
      ...BUILTIN_STRUCT_BASE_SPEC,
      description: `未找到数据结构「${typeRef}」，请重新选择。`,
      inputs: {},
      outputs: {},
    };
  }
  return {
    ...BUILTIN_STRUCT_BASE_SPEC,
    name: `数据结构 · ${def.name}`,
    description: `基于「${def.name}」（${def.id}）的字段输入 / 输出。`,
    inputs: { ...def.fields },
    outputs: { ...def.fields },
  };
}

export function resolveEffectiveSpec(
  typeId: string,
  params: Record<string, unknown> | undefined,
  specByTypeId: Map<string, NodeSpec>,
  typesMap: Map<string, TypeDef>,
): NodeSpec | undefined {
  if (isBuiltinStructNode(typeId)) {
    return buildStructNodeSpec(readStructTypeRef(params), typesMap);
  }
  return specByTypeId.get(typeId);
}

/** 去掉指向已不存在端口的连线 */
export function filterEdgesForNodeSpecs(
  edges: Edge<WorkfishEdgeData>[],
  nodes: Node<WorkfishNodeData>[],
): Edge<WorkfishEdgeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.filter((e) => {
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source?.data.spec || !target?.data.spec) {
      return false;
    }
    const sourcePort = e.sourceHandle ?? e.data?.sourcePort ?? '';
    const targetPort = e.targetHandle ?? e.data?.targetPort ?? '';
    return Boolean(source.data.spec.outputs[sourcePort] && target.data.spec.inputs[targetPort]);
  });
}

export function mergeBuiltinCatalog(catalog: NodeCatalogItem[]): NodeCatalogItem[] {
  const withoutBuiltin = catalog.filter((item) => item.id !== BUILTIN_STRUCT_TYPE_ID);
  return [BUILTIN_STRUCT_CATALOG_ITEM, ...withoutBuiltin];
}
