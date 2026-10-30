import type { NodeSpec, TypeDef, WorkflowDocument } from '@workfish/spec';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { isBuiltinStructNode, resolveEffectiveSpec } from './builtinNodes.js';

export type WorkfishNodeData = {
  typeId: string;
  label: string;
  spec?: NodeSpec;
  missingCatalog: boolean;
  params?: Record<string, unknown>;
};

export type WorkfishEdgeData = {
  sourcePort: string;
  targetPort: string;
};

export const WORKFISH_NODE_TYPE = 'workfish';

export function createEmptyWorkflow(id: string, name: string): WorkflowDocument {
  return {
    version: 1,
    id,
    name,
    updatedAt: new Date().toISOString(),
    nodes: [],
    edges: [],
  };
}

export function documentToFlow(
  doc: WorkflowDocument,
  specByTypeId: Map<string, NodeSpec>,
  typesMap: Map<string, TypeDef> = new Map(),
): { nodes: Node<WorkfishNodeData>[]; edges: Edge<WorkfishEdgeData>[] } {
  const nodes: Node<WorkfishNodeData>[] = doc.nodes.map((wn) => {
    const spec = resolveEffectiveSpec(wn.typeId, wn.params, specByTypeId, typesMap);
    const savedLabel =
      wn.params && typeof wn.params.displayName === 'string' ? wn.params.displayName : undefined;
    const missingCatalog = isBuiltinStructNode(wn.typeId) ? false : !spec;
    return {
      id: wn.id,
      type: WORKFISH_NODE_TYPE,
      position: { ...wn.position },
      data: {
        typeId: wn.typeId,
        label: savedLabel || spec?.name || wn.typeId,
        spec,
        missingCatalog,
        params: wn.params,
      },
    };
  });

  const edges: Edge<WorkfishEdgeData>[] = doc.edges.map((we) => ({
    id: we.id,
    source: we.source.nodeId,
    target: we.target.nodeId,
    sourceHandle: we.source.port,
    targetHandle: we.target.port,
    data: {
      sourcePort: we.source.port,
      targetPort: we.target.port,
    },
  }));

  return { nodes, edges };
}

export function flowToDocument(
  meta: Pick<WorkflowDocument, 'version' | 'id' | 'name'>,
  nodes: Node<WorkfishNodeData>[],
  edges: Edge<WorkfishEdgeData>[],
  viewport?: Viewport,
): WorkflowDocument {
  return {
    version: meta.version,
    id: meta.id,
    name: meta.name,
    updatedAt: new Date().toISOString(),
    nodes: nodes.map((n) => {
      const defaultLabel = n.data.spec?.name ?? n.data.typeId;
      const restParams = { ...(n.data.params ?? {}) };
      delete restParams.displayName;
      if (n.data.label !== defaultLabel) {
        restParams.displayName = n.data.label;
      }
      return {
        id: n.id,
        typeId: n.data.typeId,
        position: { x: n.position.x, y: n.position.y },
        ...(Object.keys(restParams).length > 0 ? { params: restParams } : {}),
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: { nodeId: e.source, port: e.sourceHandle ?? e.data?.sourcePort ?? '' },
      target: { nodeId: e.target, port: e.targetHandle ?? e.data?.targetPort ?? '' },
    })),
    ...(viewport
      ? { viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom } }
      : {}),
  };
}

export function newNodeId(): string {
  return `node-${crypto.randomUUID()}`;
}

export function newEdgeId(): string {
  return `edge-${crypto.randomUUID()}`;
}
