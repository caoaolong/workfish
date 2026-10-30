import ts from 'typescript';
import type { Diagnostic } from './schema.js';

export type ExtractMetaResult =
  | { ok: true; meta: unknown }
  | { ok: false; errors: Diagnostic[] };

function fail(errors: Diagnostic[], path: string, message: string): undefined {
  errors.push({ path, message });
  return undefined;
}

function unwrapInitializer(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

function literalFromExpression(
  node: ts.Expression,
  path: string,
  errors: Diagnostic[],
): unknown | undefined {
  const expr = unwrapInitializer(node);

  if (ts.isObjectLiteralExpression(expr)) {
    const obj: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        let key: string | undefined;
        if (ts.isIdentifier(prop.name)) {
          key = prop.name.text;
        } else if (ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)) {
          key = prop.name.text;
        } else {
          fail(errors, path, '对象属性名必须是标识符或字符串字面量');
          continue;
        }
        const value = literalFromExpression(prop.initializer, `${path}.${key}`, errors);
        if (value !== undefined || prop.initializer.kind === ts.SyntaxKind.NullKeyword) {
          obj[key] = value;
        }
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        fail(errors, path, `不允许标识符引用: ${prop.name.text}`);
      } else if (ts.isSpreadAssignment(prop)) {
        fail(errors, path, '不允许展开属性');
      } else if (ts.isMethodDeclaration(prop)) {
        fail(errors, path, '不允许方法定义');
      } else {
        fail(errors, path, '不支持的对象成员形式');
      }
    }
    return obj;
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const arr: unknown[] = [];
    for (let i = 0; i < expr.elements.length; i++) {
      const el = expr.elements[i];
      if (!el) {
        continue;
      }
      if (ts.isOmittedExpression(el)) {
        fail(errors, `${path}[${i}]`, '不允许省略数组元素');
        continue;
      }
      if (ts.isSpreadElement(el)) {
        fail(errors, `${path}[${i}]`, '不允许数组展开');
        continue;
      }
      const value = literalFromExpression(el, `${path}[${i}]`, errors);
      if (value !== undefined || el.kind === ts.SyntaxKind.NullKeyword) {
        arr.push(value);
      }
    }
    return arr;
  }

  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }

  if (ts.isNumericLiteral(expr)) {
    return Number(expr.text);
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) {
    const inner = unwrapInitializer(expr.operand);
    if (ts.isNumericLiteral(inner)) {
      return -Number(inner.text);
    }
  }

  if (ts.isCallExpression(expr)) {
    fail(errors, path, 'meta 必须是对象字面量，不允许函数调用');
    return undefined;
  }

  if (ts.isIdentifier(expr)) {
    fail(errors, path, `不允许标识符引用: ${expr.text}`);
    return undefined;
  }

  fail(errors, path, '仅支持 JSON 兼容的字面量表达式');
  return undefined;
}

type MetaBinding =
  | { kind: 'literal'; node: ts.ObjectLiteralExpression }
  | { kind: 'invalid'; path: string; message: string };

function findExportedMetaBinding(sourceFile: ts.SourceFile): MetaBinding | undefined {
  let binding: MetaBinding | undefined;

  function visit(node: ts.Node): void {
    if (binding) {
      return;
    }
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported) {
        ts.forEachChild(node, visit);
        return;
      }
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== 'meta') {
          continue;
        }
        if (!decl.initializer) {
          binding = { kind: 'invalid', path: 'meta', message: 'meta 缺少初始化表达式' };
          return;
        }
        const init = unwrapInitializer(decl.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          binding = { kind: 'literal', node: init };
          return;
        }
        if (ts.isCallExpression(init)) {
          binding = {
            kind: 'invalid',
            path: 'meta',
            message: 'meta 必须是对象字面量，不允许函数调用',
          };
          return;
        }
        binding = {
          kind: 'invalid',
          path: 'meta',
          message: 'meta 必须是对象字面量赋值',
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return binding;
}

export function extractMetaFromTs(source: string): ExtractMetaResult {
  const sourceFile = ts.createSourceFile(
    'meta.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const binding = findExportedMetaBinding(sourceFile);
  if (!binding) {
    return {
      ok: false,
      errors: [{ path: 'meta', message: '未找到 export const meta 声明' }],
    };
  }

  if (binding.kind === 'invalid') {
    return {
      ok: false,
      errors: [{ path: binding.path, message: binding.message }],
    };
  }

  const errors: Diagnostic[] = [];
  const meta = literalFromExpression(binding.node, 'meta', errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (meta === undefined) {
    return {
      ok: false,
      errors: [{ path: 'meta', message: '无法解析 meta 对象字面量' }],
    };
  }

  return { ok: true, meta };
}
