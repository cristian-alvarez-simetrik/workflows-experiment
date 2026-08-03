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

export type WorkflowNodeData =
  | FileNodeData
  | SqlNodeData
  | ScriptNodeData
  | VizNodeData;

export type WorkflowNodeType = "file" | "sql" | "script" | "viz";

export type WorkflowNode = Node<WorkflowNodeData, WorkflowNodeType>;
