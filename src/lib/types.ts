import type { Node } from "@xyflow/react";

export type NodeStatus = "idle" | "running" | "success" | "error";

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID: number }[];
  affectedRows?: number;
  durationMs: number;
}

/** Output a node produces when executed, consumed by downstream nodes. */
export type NodeOutput =
  | { kind: "table"; tableName: string; rowCount: number }
  | { kind: "result"; result: QueryResult }
  | { kind: "value"; value: unknown };

interface BaseNodeData {
  label: string;
  status: NodeStatus;
  error?: string;
  /** Set by the engine after a run. Not persisted. */
  output?: NodeOutput;
  [key: string]: unknown;
}

export interface FileNodeData extends BaseNodeData {
  fileName?: string;
  /** Raw file content, kept so the workflow can be re-run after reload. */
  fileContent?: string;
  /**
   * JS parser script: receives the raw file content and must return an
   * array of row objects, which are loaded into the target PGlite table.
   */
  parserScript: string;
  tableName: string;
  rowCount?: number;
}

export interface SqlNodeData extends BaseNodeData {
  sql: string;
  lastResult?: QueryResult;
}

export interface ScriptNodeData extends BaseNodeData {
  code: string;
  logs?: string[];
  lastValue?: string;
}

export interface VizNodeData extends BaseNodeData {
  sql: string;
  lastResult?: QueryResult;
}

export interface DslNodeData extends BaseNodeData {
  /** ETL DSL source (see src/lib/dsl). Supports {{input}} placeholders. */
  dsl: string;
  /** Human-readable summary shown on the node card (the DSL lives in the drawer). */
  description?: string;
  /** Optional JSON object with parameter values: {"fecha_inicio": "2026-01-01"}. */
  paramsJson?: string;
  /** schema.table created by the last run. */
  targetTable?: string;
  rowCount?: number;
  lastResult?: QueryResult;
}

export interface FormNodeData extends BaseNodeData {
  /** YAML text describing the form fields (see lib/form-schema.ts). */
  schemaYaml: string;
  /** Current form values, keyed by field name. */
  values?: Record<string, unknown>;
}

export interface GroupNodeData extends BaseNodeData {
  /** When true, child nodes and their edges are hidden. */
  collapsed?: boolean;
  /** Which built-in template created this group, if any. */
  builtinKind?: string;
  /** Size to restore when expanding again. */
  expandedSize?: { width: number; height: number };
}

export type WorkflowNodeData =
  | FileNodeData
  | SqlNodeData
  | ScriptNodeData
  | VizNodeData
  | DslNodeData
  | FormNodeData
  | GroupNodeData;

export type WorkflowNodeType =
  | "file"
  | "sql"
  | "script"
  | "viz"
  | "dsl"
  | "form"
  | "group";

export type WorkflowNode = Node<WorkflowNodeData, WorkflowNodeType>;
