import type { FieldSpec } from './schema.js';

const PRIMITIVES = new Set<FieldSpec['type']>(['string', 'number', 'boolean', 'null']);

export function isCompatible(source: FieldSpec, target: FieldSpec): boolean {
  if (source.type === 'any' || target.type === 'any') {
    return true;
  }

  if (source.type === 'object' && target.type === 'object') {
    const targetProps = target.properties ?? {};
    const sourceProps = source.properties ?? {};
    for (const [key, targetField] of Object.entries(targetProps)) {
      const sourceField = sourceProps[key];
      if (!sourceField) {
        return false;
      }
      if (!isCompatible(sourceField, targetField)) {
        return false;
      }
    }
    return true;
  }

  if (PRIMITIVES.has(source.type) && PRIMITIVES.has(target.type)) {
    return source.type === target.type;
  }

  return false;
}
