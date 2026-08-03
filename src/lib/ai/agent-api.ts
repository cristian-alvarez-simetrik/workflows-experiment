import type { Edge } from "@xyflow/react";
import type { RunNodeEntry, RunRecord } from "../run-history";
import type {
  QueryResult,
  WorkflowNode,
  WorkflowNodeType,
} from "../types";

/** Compact node listing returned by list_nodes. */
export interface NodeSummary {
  id: string;
  type: WorkflowNodeType;
  label: string;
  status: string;
  error?: string;
  /** Node ids feeding into this node. */
  inputs: string[];
  /** Node ids this node feeds into. */
  outputs: string[];
}

/** Full node detail returned by get_node. Never includes file content. */
export interface NodeDetail extends NodeSummary {
  sql?: string;
  code?: string;
  parserScript?: string;
  tableName?: string;
  fileName?: string;
  rowCount?: number;
  logs?: string[];
  lastValue?: string;
  /** form nodes */
  schemaYaml?: string;
  values?: Record<string, unknown>;
  /** dsl nodes */
  dsl?: string;
  paramsJson?: string;
  targetTable?: string;
  /** group nodes */
  collapsed?: boolean;
  /** Truncated preview of the last query result. */
  lastResult?: { rows: Record<string, unknown>[]; rowCount: number; truncated: boolean };
}

export interface RunSummary {
  status: "success" | "error";
  nodes: RunNodeEntry[];
}

/**
 * Imperative surface the AI tools use to read and mutate the live canvas.
 * Implemented inside CanvasInner and exposed through a ref so tool closures
 * never go stale.
 */
export interface AgentApi {
  listNodes(): NodeSummary[];
  getNode(id: string): NodeDetail;
  addNode(
    type: WorkflowNodeType,
    label?: string,
    position?: { x: number; y: number }
  ): string;
  updateNode(id: string, fields: Record<string, unknown>): void;
  connectNodes(sourceId: string, targetId: string): string;
  deleteNode(id: string): void;
  runWorkflow(): Promise<RunSummary>;
  runNode(id: string): Promise<RunSummary>;
  getRunHistory(limit: number): RunRecord[];
  queryDatabase(sql: string): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
  }>;
}

export type AgentApiRef = { current: AgentApi };

const MAX_RESULT_PREVIEW_ROWS = 20;

export function summarizeNode(node: WorkflowNode, edges: Edge[]): NodeSummary {
  return {
    id: node.id,
    type: node.type as WorkflowNodeType,
    label: (node.data.label as string) ?? node.id,
    status: (node.data.status as string) ?? "idle",
    error: node.data.error as string | undefined,
    inputs: edges.filter((e) => e.target === node.id).map((e) => e.source),
    outputs: edges.filter((e) => e.source === node.id).map((e) => e.target),
  };
}

export function detailNode(node: WorkflowNode, edges: Edge[]): NodeDetail {
  const detail: NodeDetail = summarizeNode(node, edges);
  const data = node.data as Record<string, unknown>;

  switch (node.type) {
    case "file":
      detail.parserScript = data.parserScript as string;
      detail.tableName = data.tableName as string;
      detail.fileName = data.fileName as string | undefined;
      detail.rowCount = data.rowCount as number | undefined;
      break;
    case "sql":
    case "viz":
      detail.sql = data.sql as string;
      break;
    case "script":
      detail.code = data.code as string;
      detail.logs = data.logs as string[] | undefined;
      detail.lastValue = data.lastValue as string | undefined;
      break;
    case "dsl":
      detail.dsl = data.dsl as string;
      detail.paramsJson = data.paramsJson as string | undefined;
      detail.targetTable = data.targetTable as string | undefined;
      detail.rowCount = data.rowCount as number | undefined;
      break;
    case "form":
      detail.schemaYaml = data.schemaYaml as string;
      detail.values = data.values as Record<string, unknown> | undefined;
      break;
    case "group":
      detail.collapsed = data.collapsed as boolean | undefined;
      break;
  }

  const lastResult = data.lastResult as QueryResult | undefined;
  if (lastResult) {
    detail.lastResult = {
      rows: lastResult.rows.slice(0, MAX_RESULT_PREVIEW_ROWS),
      rowCount: lastResult.rows.length,
      truncated: lastResult.rows.length > MAX_RESULT_PREVIEW_ROWS,
    };
  }
  return detail;
}

/** Fields update_node may touch, per node type. */
const EDITABLE_FIELDS: Record<WorkflowNodeType, string[]> = {
  file: ["label", "position", "parserScript", "tableName"],
  sql: ["label", "position", "sql"],
  script: ["label", "position", "code"],
  viz: ["label", "position", "sql"],
  dsl: ["label", "position", "dsl", "paramsJson"],
  form: ["label", "position", "schemaYaml", "values"],
  group: ["label", "position"],
};

export function assertEditableFields(
  type: WorkflowNodeType,
  fields: Record<string, unknown>
): void {
  const allowed = EDITABLE_FIELDS[type];
  const invalid = Object.keys(fields).filter((f) => !allowed.includes(f));
  if (invalid.length > 0) {
    throw new Error(
      `Field(s) ${invalid.join(", ")} cannot be set on a "${type}" node. Allowed: ${allowed.join(", ")}.`
    );
  }
}
