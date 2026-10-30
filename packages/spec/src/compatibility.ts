import type { FieldSpec, NodeSpec, TypeDef } from './schema.js';

const PRIMITIVES = new Set<FieldSpec['type']>(['string', 'number', 'boolean', 'null']);

function resolveField(
  field: FieldSpec,
  types: Map<string, TypeDef>,
): FieldSpec | undefined {
  if (field.type !== 'ref') {
    return field;
  }
  const refId = field.ref;
  if (!refId) {
    return undefined;
  }
  const typeDef = types.get(refId);
  if (!typeDef) {
    return undefined;
  }
  return { type: 'object', properties: { ...typeDef.fields } };
}

export function isCompatible(
  source: FieldSpec,
  target: FieldSpec,
  types: Map<string, TypeDef>,
): boolean {
  if (source.type === 'any' || target.type === 'any') {
    return true;
  }

  if (source.type === 'ref' && target.type === 'ref' && source.ref && source.ref === target.ref) {
    return true;
  }

  const resolvedSource = resolveField(source, types);
  const resolvedTarget = resolveField(target, types);
  if (!resolvedSource || !resolvedTarget) {
    return false;
  }

  if (resolvedSource.type === 'object' && resolvedTarget.type === 'object') {
    const targetProps = resolvedTarget.properties ?? {};
    const sourceProps = resolvedSource.properties ?? {};
    for (const [key, targetField] of Object.entries(targetProps)) {
      const sourceField = sourceProps[key];
      if (!sourceField) {
        return false;
      }
      if (!isCompatible(sourceField, targetField, types)) {
        return false;
      }
    }
    return true;
  }

  if (PRIMITIVES.has(resolvedSource.type) && PRIMITIVES.has(resolvedTarget.type)) {
    return resolvedSource.type === resolvedTarget.type;
  }

  return false;
}

export function collectRefs(spec: NodeSpec): string[] {
  const refs = new Set<string>();

  function walk(field: FieldSpec): void {
    if (field.type === 'ref' && field.ref) {
      refs.add(field.ref);
    }
    if (field.items) {
      walk(field.items);
    }
    if (field.properties) {
      for (const child of Object.values(field.properties)) {
        walk(child);
      }
    }
  }

  for (const field of Object.values(spec.inputs)) {
    walk(field);
  }
  for (const field of Object.values(spec.outputs)) {
    walk(field);
  }

  return [...refs];
}
