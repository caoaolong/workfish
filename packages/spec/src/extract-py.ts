import type { Diagnostic } from './schema.js';

export type ExtractMetaResult =
  | { ok: true; meta: unknown }
  | { ok: false; errors: Diagnostic[] };

type Token =
  | { kind: 'ident'; text: string; pos: number }
  | { kind: 'string'; text: string; pos: number }
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'true' | 'false' | 'none'; pos: number }
  | { kind: 'lbrace' | 'rbrace' | 'lbrack' | 'rbrack' | 'colon' | 'comma' | 'eq' | 'lparen' | 'rparen'; pos: number }
  | { kind: 'eof'; pos: number };

class PyLiteralLexer {
  private pos = 0;

  constructor(private readonly source: string) {}

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  skipWhitespaceAndComments(): void {
    for (;;) {
      while (this.pos < this.source.length && /\s/.test(this.source[this.pos] ?? '')) {
        this.pos++;
      }
      if (this.peek() === '#') {
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  nextToken(): Token {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    if (this.pos >= this.source.length) {
      return { kind: 'eof', pos: start };
    }

    const ch = this.peek();
    if (ch === '{') {
      this.pos++;
      return { kind: 'lbrace', pos: start };
    }
    if (ch === '}') {
      this.pos++;
      return { kind: 'rbrace', pos: start };
    }
    if (ch === '[') {
      this.pos++;
      return { kind: 'lbrack', pos: start };
    }
    if (ch === ']') {
      this.pos++;
      return { kind: 'rbrack', pos: start };
    }
    if (ch === ':') {
      this.pos++;
      return { kind: 'colon', pos: start };
    }
    if (ch === ',') {
      this.pos++;
      return { kind: 'comma', pos: start };
    }
    if (ch === '=') {
      this.pos++;
      return { kind: 'eq', pos: start };
    }
    if (ch === '(') {
      this.pos++;
      return { kind: 'lparen', pos: start };
    }
    if (ch === ')') {
      this.pos++;
      return { kind: 'rparen', pos: start };
    }
    if (ch === '"' || ch === "'") {
      return this.readQuotedString(ch);
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(this.peek(1)))) {
      return this.readNumber();
    }
    if (/[A-Za-z_]/.test(ch)) {
      return this.readIdentOrKeyword();
    }

    return { kind: 'eof', pos: start };
  }

  private readQuotedString(quote: string): Token {
    const start = this.pos;
    this.pos++;
    let text = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos] ?? '';
      if (ch === '\\') {
        this.pos++;
        const esc = this.source[this.pos] ?? '';
        this.pos++;
        if (esc === 'n') {
          text += '\n';
        } else if (esc === 't') {
          text += '\t';
        } else if (esc === '\\' || esc === quote) {
          text += esc;
        } else {
          text += esc;
        }
        continue;
      }
      if (ch === quote) {
        this.pos++;
        return { kind: 'string', text, pos: start };
      }
      text += ch;
      this.pos++;
    }
    return { kind: 'string', text, pos: start };
  }

  private readNumber(): Token {
    const start = this.pos;
    let num = '';
    if (this.peek() === '-') {
      num += '-';
      this.pos++;
    }
    while (this.pos < this.source.length && /[0-9.]/.test(this.source[this.pos] ?? '')) {
      num += this.source[this.pos];
      this.pos++;
    }
    return { kind: 'number', value: Number(num), pos: start };
  }

  private readIdentOrKeyword(): Token {
    const start = this.pos;
    let text = '';
    while (this.pos < this.source.length && /[A-Za-z0-9_]/.test(this.source[this.pos] ?? '')) {
      text += this.source[this.pos];
      this.pos++;
    }
    if (text === 'True') {
      return { kind: 'true', pos: start };
    }
    if (text === 'False') {
      return { kind: 'false', pos: start };
    }
    if (text === 'None') {
      return { kind: 'none', pos: start };
    }
    return { kind: 'ident', text, pos: start };
  }

  skipToNextLine(): void {
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.pos++;
    }
    if (this.pos < this.source.length) {
      this.pos++;
    }
  }

  atEnd(): boolean {
    this.skipWhitespaceAndComments();
    return this.pos >= this.source.length;
  }

  peekChar(): string {
    this.skipWhitespaceAndComments();
    return this.peek();
  }
}

class PyLiteralParser {
  private lexer: PyLiteralLexer;
  private token: Token;

  constructor(source: string) {
    this.lexer = new PyLiteralLexer(source);
    this.token = { kind: 'eof', pos: 0 };
  }

  private error(path: string, message: string): ExtractMetaResult {
    return { ok: false, errors: [{ path, message }] };
  }

  private advance(): void {
    this.token = this.lexer.nextToken();
  }

  private expect(kind: Token['kind'], message: string): boolean {
    if (this.token.kind !== kind) {
      return false;
    }
    this.advance();
    return true;
  }

  findMetaAssignment(): ExtractMetaResult {
    for (;;) {
      if (this.lexer.atEnd()) {
        break;
      }
      this.token = this.lexer.nextToken();
      if (this.token.kind !== 'ident' || this.token.text !== 'meta') {
        this.lexer.skipToNextLine();
        continue;
      }
      this.token = this.lexer.nextToken();
      if (this.token.kind !== 'eq') {
        this.lexer.skipToNextLine();
        continue;
      }
      this.token = this.lexer.nextToken();
      const result = this.parseValue('meta');
      if (!result.ok) {
        return result;
      }
      if (!isPlainDict(result.meta)) {
        return this.error(
          'meta',
          'meta 必须是 dict 字面量（Python 字典 { ... }），不能为 str/number/list/bool/None 等',
        );
      }
      return result;
    }
    return this.error('meta', '未找到 meta = ... 赋值');
  }

  private parseValue(path: string): ExtractMetaResult {
    if (this.token.kind === 'lbrace') {
      return this.parseDict(path);
    }
    if (this.token.kind === 'lbrack') {
      return this.parseList(path);
    }
    if (this.token.kind === 'string') {
      const value = this.token.text;
      this.advance();
      return { ok: true, meta: value };
    }
    if (this.token.kind === 'number') {
      const value = this.token.value;
      this.advance();
      return { ok: true, meta: value };
    }
    if (this.token.kind === 'true') {
      this.advance();
      return { ok: true, meta: true };
    }
    if (this.token.kind === 'false') {
      this.advance();
      return { ok: true, meta: false };
    }
    if (this.token.kind === 'none') {
      this.advance();
      return { ok: true, meta: null };
    }
    if (this.token.kind === 'ident') {
      if (this.peekIsCall()) {
        return this.error(path, 'meta 必须是 dict 字面量，不允许函数调用');
      }
      return this.error(path, `不允许标识符引用: ${this.token.text}`);
    }
    return this.error(path, '仅支持 dict/list/str/number/bool/None 字面量');
  }

  private peekIsCall(): boolean {
    if (this.token.kind !== 'ident') {
      return false;
    }
    return this.lexer.peekChar() === '(';
  }

  private parseDict(path: string): ExtractMetaResult {
    if (!this.expect('lbrace', 'expected lbrace')) {
      return this.error(path, 'dict 必须以 { 开始');
    }
    const obj: Record<string, unknown> = {};

    if (this.token.kind === 'rbrace') {
      this.advance();
      return { ok: true, meta: obj };
    }

    for (;;) {
      if (this.token.kind !== 'string') {
        return this.error(path, 'dict 键必须是双引号或单引号字符串字面量');
      }
      const key = this.token.text;
      this.token = this.lexer.nextToken();
      if (this.token.kind !== 'colon') {
        return this.error(`${path}.${key}`, 'dict 项缺少冒号');
      }
      this.token = this.lexer.nextToken();
      const valueResult = this.parseValue(`${path}.${key}`);
      if (!valueResult.ok) {
        return valueResult;
      }
      obj[key] = valueResult.meta;

      if (this.token.kind === 'comma') {
        this.advance();
        continue;
      }
      if (this.token.kind === 'rbrace') {
        this.advance();
        break;
      }
      return this.error(path, 'dict 字面量格式错误');
    }

    return { ok: true, meta: obj };
  }

  private parseList(path: string): ExtractMetaResult {
    if (!this.expect('lbrack', 'expected lbrack')) {
      return this.error(path, 'list 必须以 [ 开始');
    }
    const arr: unknown[] = [];

    if (this.token.kind === 'rbrack') {
      this.advance();
      return { ok: true, meta: arr };
    }

    for (;;) {
      const itemResult = this.parseValue(`${path}[${arr.length}]`);
      if (!itemResult.ok) {
        return itemResult;
      }
      arr.push(itemResult.meta);

      const tail = this.token;
      if (tail.kind === 'comma') {
        this.advance();
        continue;
      }
      if (tail.kind === 'rbrack') {
        this.advance();
        break;
      }
      return this.error(path, 'list 字面量格式错误');
    }

    return { ok: true, meta: arr };
  }
}

function isPlainDict(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function extractMetaFromPy(source: string): ExtractMetaResult {
  const parser = new PyLiteralParser(source);
  const result = parser.findMetaAssignment();
  if (!result.ok) {
    return result;
  }
  return { ok: true, meta: result.meta };
}
