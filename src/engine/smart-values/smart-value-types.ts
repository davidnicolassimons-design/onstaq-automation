// =============================================================================
// Smart Value Types
// Token types, AST nodes, and function interfaces for the smart value system
// =============================================================================

import { OnstaqClient } from '../../onstaq/client';
import { ExecutionContext } from '../types';

// ── Token Types ──

export enum TokenType {
  IDENTIFIER = 'IDENTIFIER',
  DOT = 'DOT',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  COMMA = 'COMMA',
  PIPE = 'PIPE',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  OPERATOR = 'OPERATOR',
  COLON = 'COLON',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// ── AST Node Types ──

export type ASTNode =
  | PathExpression
  | ChainExpression
  | FunctionCallExpression
  | LiteralExpression
  | PipeExpression
  | BinaryExpression
  | OqlExpression;

export interface PathExpression {
  type: 'path';
  segments: string[];
}

export interface ChainExpression {
  type: 'chain';
  base: ASTNode;
  operations: ChainOperation[];
}

export type ChainOperation =
  | { type: 'functionCall'; name: string; args: ASTNode[] }
  | { type: 'propertyAccess'; name: string }
  | { type: 'indexAccess'; index: ASTNode };

export interface FunctionCallExpression {
  type: 'functionCall';
  name: string;
  args: ASTNode[];
}

export interface LiteralExpression {
  type: 'literal';
  value: string | number | boolean | null;
}

export interface PipeExpression {
  type: 'pipe';
  left: ASTNode;
  right: ASTNode;
}

export interface BinaryExpression {
  type: 'binary';
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export interface OqlExpression {
  type: 'oql';
  query: string;
}

// ── Function System Types ──

export interface FunctionContext {
  onstaqClient: OnstaqClient;
  executionContext: ExecutionContext;
}

export interface SmartValueFunction {
  name: string;
  minArgs: number;
  maxArgs: number;
  appliesTo: ('string' | 'number' | 'date' | 'array' | 'any')[];
  execute: (value: any, args: any[], context?: FunctionContext) => any | Promise<any>;
}
