/** Logical plan: dialect-independent output of semantic analysis. */

import type { BinaryOperator, UnaryOperator } from "./ast";
import type { SemanticType } from "./semantic-types";

// ---------------------------------------------------------------------------
// Typed expressions (every node carries its inferred type)
// ---------------------------------------------------------------------------

export interface TypedStringLiteral {
  kind: "string-literal";
  value: string;
  type: SemanticType;
}

export interface TypedNumberLiteral {
  kind: "number-literal";
  value: number;
  type: SemanticType;
}

export interface TypedBooleanLiteral {
  kind: "boolean-literal";
  value: boolean;
  type: SemanticType;
}

export interface TypedNullLiteral {
  kind: "null-literal";
  type: SemanticType;
}

export interface TypedColumnReference {
  kind: "column";
  name: string;
  type: SemanticType;
}

export interface TypedParameterReference {
  kind: "parameter";
  name: string;
  /** 1-based bound-parameter position ($1, $2, ...). */
  index: number;
  type: SemanticType;
}

export interface TypedUnaryExpression {
  kind: "unary";
  operator: UnaryOperator;
  operand: TypedExpression;
  type: SemanticType;
}

export interface TypedBinaryExpression {
  kind: "binary";
  operator: BinaryOperator;
  left: TypedExpression;
  right: TypedExpression;
  type: SemanticType;
}

export interface TypedFunctionCall {
  kind: "function-call";
  name: string;
  args: TypedExpression[];
  type: SemanticType;
  /** Extra compile-time data some functions need (e.g. date formats). */
  meta?: { dslDateFormat?: string };
}

export interface TypedConditionalExpression {
  kind: "conditional";
  branches: { condition: TypedExpression; result: TypedExpression }[];
  elseResult: TypedExpression;
  type: SemanticType;
}

export type TypedExpression =
  | TypedStringLiteral
  | TypedNumberLiteral
  | TypedBooleanLiteral
  | TypedNullLiteral
  | TypedColumnReference
  | TypedParameterReference
  | TypedUnaryExpression
  | TypedBinaryExpression
  | TypedFunctionCall
  | TypedConditionalExpression;

// ---------------------------------------------------------------------------
// Plan nodes
// ---------------------------------------------------------------------------

export interface LogicalColumn {
  name: string;
  type: SemanticType;
  nullable: boolean;
}

export interface ScanPlan {
  type: "Scan";
  connection: string;
  schema: string;
  table: string;
  outputSchema: LogicalColumn[];
}

export interface FilterPlan {
  type: "Filter";
  input: LogicalPlanNode;
  condition: TypedExpression;
  outputSchema: LogicalColumn[];
}

export interface AddColumnPlan {
  type: "AddColumn";
  input: LogicalPlanNode;
  name: string;
  expression: TypedExpression;
  outputSchema: LogicalColumn[];
}

export interface ProjectPlan {
  type: "Project";
  input: LogicalPlanNode;
  columns: string[];
  outputSchema: LogicalColumn[];
}

export type LogicalPlanNode =
  | ScanPlan
  | FilterPlan
  | AddColumnPlan
  | ProjectPlan;

export interface CompiledParameter {
  name: string;
  required: boolean;
  defaultValue?: string | number | boolean | null;
  type: SemanticType;
  /** 1-based bound position; undefined when the parameter is never referenced. */
  index?: number;
}

export interface OutputPlan {
  schema: string;
  table: string;
  mode: "replace";
}

export interface LogicalPlan {
  processName: string;
  sourceConnection: string;
  root: LogicalPlanNode;
  output: OutputPlan;
  parameters: CompiledParameter[];
  /** Names of referenced parameters in bound order ($1 first). */
  parameterOrder: string[];
  outputSchema: LogicalColumn[];
}
