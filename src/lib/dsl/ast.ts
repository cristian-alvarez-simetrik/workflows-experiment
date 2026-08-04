/** SQL-independent AST for the ETL DSL. Every node carries a SourceRange. */

import type { SourceRange } from "./diagnostics";

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export interface StringLiteralNode {
  type: "StringLiteral";
  value: string;
  range: SourceRange;
}

export interface NumberLiteralNode {
  type: "NumberLiteral";
  value: number;
  isInteger: boolean;
  range: SourceRange;
}

export interface BooleanLiteralNode {
  type: "BooleanLiteral";
  value: boolean;
  range: SourceRange;
}

export interface NullLiteralNode {
  type: "NullLiteral";
  range: SourceRange;
}

export interface ColumnReferenceNode {
  type: "ColumnReference";
  /** Table alias when the reference is qualified: alias.columna. */
  qualifier?: string;
  name: string;
  range: SourceRange;
}

export interface ParameterReferenceNode {
  type: "ParameterReference";
  name: string;
  range: SourceRange;
}

export type UnaryOperator = "-" | "+" | "no";

export interface UnaryExpressionNode {
  type: "UnaryExpression";
  operator: UnaryOperator;
  operand: ExpressionNode;
  range: SourceRange;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "y"
  | "o";

export interface BinaryExpressionNode {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
  range: SourceRange;
}

export interface FunctionCallNode {
  type: "FunctionCall";
  name: string;
  args: ExpressionNode[];
  range: SourceRange;
}

export interface ConditionalBranch {
  condition: ExpressionNode;
  result: ExpressionNode;
  range: SourceRange;
}

export interface ConditionalExpressionNode {
  type: "ConditionalExpression";
  branches: ConditionalBranch[];
  elseResult: ExpressionNode;
  range: SourceRange;
}

export type ExpressionNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NullLiteralNode
  | ColumnReferenceNode
  | ParameterReferenceNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | FunctionCallNode
  | ConditionalExpressionNode;

// ---------------------------------------------------------------------------
// Statements / program
// ---------------------------------------------------------------------------

export interface ProcessDeclarationNode {
  type: "ProcessDeclaration";
  name: string;
  range: SourceRange;
}

export interface ParameterDeclarationNode {
  type: "ParameterDeclaration";
  name: string;
  defaultValue?: ExpressionNode;
  range: SourceRange;
}

export interface SourceNode {
  type: "Source";
  connection: string;
  schema: string;
  table: string;
  /** Optional alias ("como s"); defaults to the table name. */
  alias?: string;
  range: SourceRange;
}

export type JoinType = "inner" | "left" | "right" | "full";

export interface JoinNode {
  type: "Join";
  joinType: JoinType;
  connection: string;
  schema: string;
  table: string;
  alias: string;
  aliasRange: SourceRange;
  condition: ExpressionNode;
  range: SourceRange;
}

export interface FilterNode {
  type: "Filter";
  condition: ExpressionNode;
  range: SourceRange;
}

export interface AddColumnNode {
  type: "AddColumn";
  name: string;
  nameRange: SourceRange;
  expression: ExpressionNode;
  range: SourceRange;
}

export type TransformationNode = FilterNode | AddColumnNode;

export interface SelectColumnNode {
  column: ColumnReferenceNode;
  /** Output name when renamed with "como". */
  alias?: string;
  range: SourceRange;
}

export interface SelectNode {
  type: "Select";
  columns: SelectColumnNode[];
  range: SourceRange;
}

export interface WriteNode {
  type: "Write";
  schema: string;
  table: string;
  mode: "replace";
  range: SourceRange;
}

export interface ProgramNode {
  type: "Program";
  process: ProcessDeclarationNode;
  parameters: ParameterDeclarationNode[];
  source: SourceNode;
  joins: JoinNode[];
  operations: TransformationNode[];
  selection?: SelectNode;
  output: WriteNode;
  range: SourceRange;
}
