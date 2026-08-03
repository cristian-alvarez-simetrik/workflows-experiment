
import type { Edge } from "@xyflow/react";
import { runQuery } from "./db";
import {
  defaultParserScript,
  insertRows,
  runParserScript,
} from "./file-loader";
import {
  assertRequiredValues,
  parseFormSchema,
  resolveFormValues,
} from "./form-schema";
import type {
  FileNodeData,
  FormNodeData,
  NodeOutput,
  ScriptNodeData,
  SqlNodeData,
  VizNodeData,
  WorkflowNode,
} from "./types";

/** Topologically sort nodes; throws on cycles. */
export function topoSort(nodes: WorkflowNode[], edges: Edge[]): WorkflowNode[] {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!inDegree.has(e.source) || !inDegree.has(e.target)) continue;
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
  }
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0);
  const sorted: WorkflowNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const targetId of adjacency.get(node.id) ?? []) {
      const deg = (inDegree.get(targetId) ?? 0) - 1;
      inDegree.set(targetId, deg);
      if (deg === 0) queue.push(byId.get(targetId)!);
    }
  }
  if (sorted.length !== nodes.length) {
    throw new Error("Workflow contains a cycle — remove circular connections");
  }
  return sorted;
}

/** Upstream node ids ordered by edge creation. */
function incomingIds(nodeId: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

function outputToInputValue(output: NodeOutput | undefined): unknown {
  if (!output) return undefined;
  switch (output.kind) {
    case "table":
      return output.tableName;
    case "result":
      return output.result.rows;
    case "value":
      return output.value;
  }
}

/**
 * Substitute {{input}} / {{input0}} / {{input1}}… placeholders in SQL with
 * the string outputs of upstream nodes (typically script nodes that built SQL).
 */
function templateSql(sql: string, inputs: unknown[]): string {
  return sql.replace(/\{\{\s*input(\d*)\s*\}\}/g, (_, idx: string) => {
    const value = inputs[idx === "" ? 0 : Number(idx)];
    if (value === undefined) {
      throw new Error(
        `SQL references {{input${idx}}} but no upstream node provides it`
      );
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

async function executeFileNode(data: FileNodeData): Promise<NodeOutput> {
  if (!data.fileContent || !data.fileName) {
    throw new Error("No file selected — open the node and choose a file");
  }
  if (!data.tableName.trim()) {
    throw new Error("Target table name is empty");
  }
  const script = data.parserScript?.trim()
    ? data.parserScript
    : defaultParserScript(data.fileName);
  const rows = await runParserScript(script, data.fileContent, data.fileName);
  const rowCount = await insertRows(data.tableName, rows);
  return { kind: "table", tableName: data.tableName, rowCount };
}

async function executeSqlNode(
  data: SqlNodeData,
  inputs: unknown[]
): Promise<NodeOutput> {
  const sql = templateSql(data.sql, inputs).trim();
  if (!sql) throw new Error("SQL is empty");
  const result = await runQuery(sql);
  return { kind: "result", result };
}

interface ScriptExecution {
  output: NodeOutput;
  logs: string[];
}

async function executeScriptNode(
  data: ScriptNodeData,
  inputs: unknown[]
): Promise<ScriptExecution> {
  const logs: string[] = [];
  const ctx = {
    /** Outputs of upstream nodes, in connection order. */
    inputs,
    /** Convenience alias for the first upstream output. */
    input: inputs[0],
    /** Run SQL directly against PGlite from the script. */
    query: async (sql: string) => (await runQuery(sql)).rows,
    log: (...args: unknown[]) => {
      logs.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
          .join(" ")
      );
    },
  };
  const fn = new Function(
    "ctx",
    "inputs",
    "input",
    "query",
    "log",
    `"use strict"; return (async () => { ${data.code} })();`
  );
  const value = await fn(ctx, ctx.inputs, ctx.input, ctx.query, ctx.log);
  return { output: { kind: "value", value }, logs };
}

async function executeFormNode(data: FormNodeData): Promise<NodeOutput> {
  const schema = parseFormSchema(data.schemaYaml);
  const values = resolveFormValues(schema, data.values ?? {});
  assertRequiredValues(schema, values);
  return { kind: "value", value: values };
}

async function executeVizNode(
  data: VizNodeData,
  inputs: unknown[]
): Promise<NodeOutput> {
  const sql = templateSql(data.sql, inputs).trim();
  if (!sql) throw new Error("SQL is empty");
  const result = await runQuery(sql);
  return { kind: "result", result };
}

export interface RunCallbacks {
  onNodeStart: (id: string) => void;
  onNodeSuccess: (id: string, patch: Record<string, unknown>) => void;
  onNodeError: (id: string, error: string) => void;
}

/** Execute a set of nodes in dependency order. Stops a branch on failure. */
export async function runNodes(
  nodesToRun: WorkflowNode[],
  allNodes: WorkflowNode[],
  edges: Edge[],
  callbacks: RunCallbacks
): Promise<void> {
  const sorted = topoSort(allNodes, edges);
  const runSet = new Set(nodesToRun.map((n) => n.id));
  const outputs = new Map<string, NodeOutput>();
  const failed = new Set<string>();

  for (const node of allNodes) {
    if (!runSet.has(node.id) && node.data.output) {
      outputs.set(node.id, node.data.output);
    }
  }

  for (const node of sorted) {
    if (!runSet.has(node.id)) continue;
    // Group nodes are visual containers — they never execute.
    if (node.type === "group") continue;
    const upstream = incomingIds(node.id, edges);
    if (upstream.some((id) => failed.has(id))) {
      failed.add(node.id);
      callbacks.onNodeError(node.id, "Skipped: an upstream node failed");
      continue;
    }
    const inputs = upstream.map((id) => outputToInputValue(outputs.get(id)));
    callbacks.onNodeStart(node.id);
    try {
      let output: NodeOutput;
      let patch: Record<string, unknown> = {};
      switch (node.type) {
        case "file": {
          output = await executeFileNode(node.data as FileNodeData);
          patch = {
            rowCount: output.kind === "table" ? output.rowCount : undefined,
          };
          break;
        }
        case "sql": {
          output = await executeSqlNode(node.data as SqlNodeData, inputs);
          patch = {
            lastResult: output.kind === "result" ? output.result : undefined,
          };
          break;
        }
        case "script": {
          const { output: scriptOutput, logs } = await executeScriptNode(
            node.data as ScriptNodeData,
            inputs
          );
          output = scriptOutput;
          const value = scriptOutput.kind === "value" ? scriptOutput.value : undefined;
          patch = {
            logs,
            lastValue:
              value === undefined
                ? undefined
                : typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2),
          };
          break;
        }
        case "viz": {
          output = await executeVizNode(node.data as VizNodeData, inputs);
          patch = {
            lastResult: output.kind === "result" ? output.result : undefined,
          };
          break;
        }
        case "form": {
          output = await executeFormNode(node.data as FormNodeData);
          patch = {
            values: output.kind === "value" ? output.value : undefined,
          };
          break;
        }
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }
      outputs.set(node.id, output);
      callbacks.onNodeSuccess(node.id, { ...patch, output });
    } catch (err) {
      failed.add(node.id);
      callbacks.onNodeError(
        node.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

/** A node plus everything reachable downstream of it. */
export function withDownstream(
  startId: string,
  nodes: WorkflowNode[],
  edges: Edge[]
): WorkflowNode[] {
  const reachable = new Set<string>([startId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (reachable.has(e.source) && !reachable.has(e.target)) {
        reachable.add(e.target);
        grew = true;
      }
    }
  }
  return nodes.filter((n) => reachable.has(n.id));
}
