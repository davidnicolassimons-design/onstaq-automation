// =============================================================================
// Expression Parser
// Tokenizer + recursive-descent parser for smart value expressions
// =============================================================================

import {
  TokenType, Token, ASTNode, PathExpression, ChainExpression,
  ChainOperation, FunctionCallExpression, LiteralExpression,
  PipeExpression, BinaryExpression, OqlExpression,
} from './smart-value-types';

// ── Tokenizer ──

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '=', '!', '>', '<']);
const DOUBLE_OPERATORS = new Set(['==', '!=', '>=', '<=']);

export class Tokenizer {
  private input: string;
  private pos: number = 0;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      // String literals
      if (ch === '"' || ch === "'") {
        this.readString(ch);
        continue;
      }

      // Numbers
      if (this.isDigit(ch) || (ch === '-' && this.pos + 1 < this.input.length && this.isDigit(this.input[this.pos + 1]) && this.shouldNegateBeNumber())) {
        this.readNumber();
        continue;
      }

      // Single-character tokens
      if (ch === '.') { this.tokens.push({ type: TokenType.DOT, value: '.', position: this.pos }); this.pos++; continue; }
      if (ch === '(') { this.tokens.push({ type: TokenType.LPAREN, value: '(', position: this.pos }); this.pos++; continue; }
      if (ch === ')') { this.tokens.push({ type: TokenType.RPAREN, value: ')', position: this.pos }); this.pos++; continue; }
      if (ch === '[') { this.tokens.push({ type: TokenType.LBRACKET, value: '[', position: this.pos }); this.pos++; continue; }
      if (ch === ']') { this.tokens.push({ type: TokenType.RBRACKET, value: ']', position: this.pos }); this.pos++; continue; }
      if (ch === ',') { this.tokens.push({ type: TokenType.COMMA, value: ',', position: this.pos }); this.pos++; continue; }
      if (ch === '|') { this.tokens.push({ type: TokenType.PIPE, value: '|', position: this.pos }); this.pos++; continue; }
      if (ch === ':') { this.tokens.push({ type: TokenType.COLON, value: ':', position: this.pos }); this.pos++; continue; }

      // Operators (==, !=, >=, <=, >, <, +, -, *, /)
      if (OPERATOR_CHARS.has(ch)) {
        this.readOperator();
        continue;
      }

      // Identifiers and keywords
      if (this.isIdentStart(ch)) {
        this.readIdentifier();
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    this.tokens.push({ type: TokenType.EOF, value: '', position: this.pos });
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private readString(quote: string): void {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = '';

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '\\' && this.pos + 1 < this.input.length) {
        value += this.input[this.pos + 1];
        this.pos += 2;
        continue;
      }
      if (ch === quote) {
        this.pos++; // skip closing quote
        this.tokens.push({ type: TokenType.STRING, value, position: start });
        return;
      }
      value += ch;
      this.pos++;
    }

    throw new Error(`Unterminated string starting at position ${start}`);
  }

  private readNumber(): void {
    const start = this.pos;
    let value = '';
    if (this.input[this.pos] === '-') {
      value += '-';
      this.pos++;
    }
    let hasDot = false;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (this.isDigit(ch)) {
        value += ch;
        this.pos++;
      } else if (ch === '.' && !hasDot && this.pos + 1 < this.input.length && this.isDigit(this.input[this.pos + 1])) {
        hasDot = true;
        value += ch;
        this.pos++;
      } else {
        break;
      }
    }
    this.tokens.push({ type: TokenType.NUMBER, value, position: start });
  }

  private readOperator(): void {
    const start = this.pos;
    const ch = this.input[this.pos];
    const two = this.input.substring(this.pos, this.pos + 2);

    if (DOUBLE_OPERATORS.has(two)) {
      this.tokens.push({ type: TokenType.OPERATOR, value: two, position: start });
      this.pos += 2;
    } else {
      this.tokens.push({ type: TokenType.OPERATOR, value: ch, position: start });
      this.pos++;
    }
  }

  private readIdentifier(): void {
    const start = this.pos;
    let value = '';
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos])) {
      value += this.input[this.pos];
      this.pos++;
    }

    // Check for keywords
    if (value === 'true' || value === 'false') {
      this.tokens.push({ type: TokenType.BOOLEAN, value, position: start });
    } else if (value === 'null') {
      this.tokens.push({ type: TokenType.NULL, value, position: start });
    } else {
      // Check for oql: prefix — consume rest of input as raw OQL
      if (value === 'oql' && this.pos < this.input.length && this.input[this.pos] === ':') {
        this.pos++; // skip the colon
        const oqlQuery = this.input.substring(this.pos).trim();
        this.pos = this.input.length;
        this.tokens.push({ type: TokenType.IDENTIFIER, value: 'oql', position: start });
        this.tokens.push({ type: TokenType.COLON, value: ':', position: start + value.length });
        this.tokens.push({ type: TokenType.STRING, value: oqlQuery, position: start + value.length + 1 });
        return;
      }
      this.tokens.push({ type: TokenType.IDENTIFIER, value, position: start });
    }
  }

  private shouldNegateBeNumber(): boolean {
    // A minus sign is a negative number if the previous token is an operator, pipe, lparen, lbracket, comma, or nothing
    if (this.tokens.length === 0) return true;
    const prev = this.tokens[this.tokens.length - 1];
    return prev.type === TokenType.OPERATOR || prev.type === TokenType.PIPE ||
           prev.type === TokenType.LPAREN || prev.type === TokenType.LBRACKET ||
           prev.type === TokenType.COMMA;
  }

  private isDigit(ch: string): boolean { return ch >= '0' && ch <= '9'; }
  private isIdentStart(ch: string): boolean { return /[a-zA-Z_@]/.test(ch); }
  private isIdentChar(ch: string): boolean { return /[a-zA-Z0-9_@]/.test(ch); }
}

// ── Parser ──

export class ExpressionParser {
  private tokens: Token[] = [];
  private pos: number = 0;

  parse(input: string): ASTNode {
    const tokenizer = new Tokenizer(input);
    this.tokens = tokenizer.tokenize();
    this.pos = 0;

    const result = this.parseExpression();

    if (this.current().type !== TokenType.EOF) {
      throw new Error(`Unexpected token '${this.current().value}' at position ${this.current().position}`);
    }

    return result;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '', position: -1 };
  }

  private peek(offset: number = 0): Token {
    return this.tokens[this.pos + offset] || { type: TokenType.EOF, value: '', position: -1 };
  }

  private advance(): Token {
    const tok = this.current();
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.current();
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} '${tok.value}' at position ${tok.position}`);
    }
    return this.advance();
  }

  // expression = pipe_expr
  private parseExpression(): ASTNode {
    return this.parsePipe();
  }

  // pipe_expr = additive ( '|' additive )?
  private parsePipe(): ASTNode {
    let left = this.parseAdditive();

    if (this.current().type === TokenType.PIPE) {
      this.advance();
      const right = this.parseAdditive();
      return { type: 'pipe', left, right } as PipeExpression;
    }

    return left;
  }

  // additive = comparison ( ('+' | '-') comparison )*
  private parseAdditive(): ASTNode {
    let left = this.parseComparison();

    while (this.current().type === TokenType.OPERATOR &&
           (this.current().value === '+' || this.current().value === '-' ||
            this.current().value === '*' || this.current().value === '/')) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { type: 'binary', operator: op, left, right } as BinaryExpression;
    }

    return left;
  }

  // comparison = unary ( ('==' | '!=' | '>' | '<' | '>=' | '<=') unary )?
  private parseComparison(): ASTNode {
    let left = this.parseUnary();

    if (this.current().type === TokenType.OPERATOR &&
        ['==', '!=', '>', '<', '>=', '<='].includes(this.current().value)) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'binary', operator: op, left, right } as BinaryExpression;
    }

    return left;
  }

  // unary = primary ( chain_op )*
  private parseUnary(): ASTNode {
    let base = this.parsePrimary();
    const operations: ChainOperation[] = [];

    while (true) {
      // .identifier or .identifier(args)
      if (this.current().type === TokenType.DOT && this.peek(1).type === TokenType.IDENTIFIER) {
        this.advance(); // skip dot
        const name = this.advance().value;

        if (this.current().type === TokenType.LPAREN) {
          // Function call: .funcName(args)
          this.advance(); // skip (
          const args = this.parseArgs();
          this.expect(TokenType.RPAREN);
          operations.push({ type: 'functionCall', name, args });
        } else {
          // Property access: .propName
          operations.push({ type: 'propertyAccess', name });
        }
        continue;
      }

      // [index]
      if (this.current().type === TokenType.LBRACKET) {
        this.advance(); // skip [
        const index = this.parseExpression();
        this.expect(TokenType.RBRACKET);
        operations.push({ type: 'indexAccess', index });
        continue;
      }

      break;
    }

    if (operations.length > 0) {
      return { type: 'chain', base, operations } as ChainExpression;
    }

    return base;
  }

  // primary = STRING | NUMBER | BOOLEAN | NULL | oql_expr | func_call | path
  private parsePrimary(): ASTNode {
    const tok = this.current();

    // Literals
    if (tok.type === TokenType.STRING) {
      this.advance();
      return { type: 'literal', value: tok.value } as LiteralExpression;
    }
    if (tok.type === TokenType.NUMBER) {
      this.advance();
      return { type: 'literal', value: parseFloat(tok.value) } as LiteralExpression;
    }
    if (tok.type === TokenType.BOOLEAN) {
      this.advance();
      return { type: 'literal', value: tok.value === 'true' } as LiteralExpression;
    }
    if (tok.type === TokenType.NULL) {
      this.advance();
      return { type: 'literal', value: null } as LiteralExpression;
    }

    // Grouped expression: ( expr )
    if (tok.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Identifier-based expressions
    if (tok.type === TokenType.IDENTIFIER) {
      // OQL prefix: oql: <query>
      if (tok.value === 'oql' && this.peek(1).type === TokenType.COLON) {
        this.advance(); // skip 'oql'
        this.advance(); // skip ':'
        const queryTok = this.expect(TokenType.STRING);
        return { type: 'oql', query: queryTok.value } as OqlExpression;
      }

      // Top-level function call: name(args)
      if (this.peek(1).type === TokenType.LPAREN) {
        const name = this.advance().value;
        this.advance(); // skip (
        const args = this.parseArgs();
        this.expect(TokenType.RPAREN);
        return { type: 'functionCall', name, args } as FunctionCallExpression;
      }

      // Path: identifier.identifier.identifier...
      return this.parsePath();
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type}) at position ${tok.position}`);
  }

  // path = IDENTIFIER ( '.' IDENTIFIER )* (stops before function calls)
  private parsePath(): ASTNode {
    const segments: string[] = [];
    segments.push(this.advance().value); // first identifier

    while (this.current().type === TokenType.DOT && this.peek(1).type === TokenType.IDENTIFIER) {
      // Stop if the identifier after the dot is followed by ( — that's a function call
      if (this.peek(2).type === TokenType.LPAREN) {
        break;
      }
      this.advance(); // skip dot
      segments.push(this.advance().value);
    }

    return { type: 'path', segments } as PathExpression;
  }

  // args = expression ( ',' expression )*
  private parseArgs(): ASTNode[] {
    const args: ASTNode[] = [];

    if (this.current().type === TokenType.RPAREN) {
      return args;
    }

    args.push(this.parseExpression());

    while (this.current().type === TokenType.COMMA) {
      this.advance(); // skip comma
      args.push(this.parseExpression());
    }

    return args;
  }
}
