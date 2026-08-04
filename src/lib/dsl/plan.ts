/** Logical plan: dialect-independent output of semantic analysis. */

import type { BinaryOperator, JoinType, UnaryOperator } from "./ast";
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
  /** Flat SQL column name at this point of the pipeline. */
  name: string;
  type: SemanticType;
  /** Only inside a JoinPlan condition: which side the column belongs to. */
  joinSide?: "left" | "right";
  /** SQL-ready prefix (already quoted/safe), set by the SQL compiler. */
  sqlQualifier?: string;
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

export interface JoinColumnMapping {
  side: "left" | "right";
  /** Name on that side (left: previous step output; right: raw table column). */
  sourceName: string;
  /** Unique flat name after the join (collisions become alias_columna). */
  outputName: string;
}

export interface JoinPlan {
  type: "Join";
  input: LogicalPlanNode;
  joinType: JoinType;
  schema: string;
  table: string;
  alias: string;
  condition: TypedExpression;
  columns: JoinColumnMapping[];
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
  columns: { source: string; output: string }[];
  outputSchema: LogicalColumn[];
}

export type LogicalPlanNode =
  | ScanPlan
  | JoinPlan
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
