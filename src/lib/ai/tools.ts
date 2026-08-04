import { tool } from "ai";
import { z } from "zod";
import { enabledNodeTypes } from "../app-settings";
import type { WorkflowNodeType } from "../types";
import type { AgentApiRef } from "./agent-api";

/** Short add_node blurb per creatable node type. */
const NODE_TYPE_BLURBS: Partial<Record<WorkflowNodeType, string>> = {
  file: "file (load a file into a PGlite table via a parser script — the USER must pick the actual file in the node UI)",
  sql: "sql (run SQL against PGlite)",
  script: "script (JavaScript for validations or building SQL for downstream nodes)",
  viz: "viz (render a query result as a table)",
  dsl: "dsl (Spanish ETL DSL compiled to SQL; creates a target table and outputs its schema.table name)",
  form: "form (YAML-defined form whose output is the JSON of the values the user fills in)",
};

/**
 * Workflow tools for the chat agent. Created once per panel mount; every
 * call goes through apiRef.current, which CanvasInner rebuilds each render,
 * so the tools always see the live canvas state.
 */
export function createWorkflowTools(apiRef: AgentApiRef) {
  const api = () => apiRef.current;

  // Basic mode exposes only file + dsl; advanced mode everything.
  const creatable = enabledNodeTypes();

  return {
    list_nodes: tool({
      description:
        "List all nodes in the current workflow with their ids, types, labels, statuses and connections. Call this first to understand the graph.",
      inputSchema: z.object({}),
      execute: async () => api().listNodes(),
    }),

    get_node: tool({
      description:
        "Get the full detail of one node: its SQL, script code, parser script, table name, last error, logs and a truncated preview of its last result. File contents are never included.",
      inputSchema: z.object({ nodeId: z.string() }),
      execute: async ({ nodeId }) => api().getNode(nodeId),
    }),

    add_node: tool({
      description: `Add a new node to the workflow and return its id. Types: ${creatable
        .map((t) => NODE_TYPE_BLURBS[t])
        .filter(Boolean)
        .join(", ")}.`,
      inputSchema: z.object({
        type: z.enum(creatable as [WorkflowNodeType, ...WorkflowNodeType[]]),
        label: z.string().optional().describe("Human-friendly node title"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Canvas position; omit to auto-place"),
      }),
      execute: async ({ type, label, position }) => {
        if (!enabledNodeTypes().includes(type)) {
          throw new Error(
            `Node type "${type}" is not enabled — the user must turn on advanced mode on the home page first.`
          );
        }
        return { nodeId: api().addNode(type, label, position) };
      },
    }),

    update_node: tool({
      description:
        "Update fields of an existing node. Only include the fields you want to change. 'sql' applies to sql/viz nodes, 'code' to script nodes, 'parserScript'/'tableName' to file nodes, 'dsl'/'description'/'paramsJson' to dsl nodes, 'schemaYaml'/'values' to form nodes, 'label' and 'position' to any node.",
      inputSchema: z.object({
        nodeId: z.string(),
        label: z.string().optional(),
        sql: z.string().optional(),
        code: z.string().optional(),
        parserScript: z.string().optional(),
        tableName: z.string().optional(),
        dsl: z
          .string()
          .optional()
          .describe("ETL DSL source (dsl nodes only)"),
        description: z
          .string()
          .optional()
          .describe(
            "Short human-readable summary shown on the node card (dsl nodes only)"
          ),
        paramsJson: z
          .string()
          .optional()
          .describe('JSON object with DSL parameter values (dsl nodes only), e.g. {"fecha_inicio": "2026-01-01"}'),
        schemaYaml: z
          .string()
          .optional()
          .describe("YAML form schema (form nodes only)"),
        values: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Form values keyed by field name (form nodes only)"),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
      execute: async ({ nodeId, ...fields }) => {
        // Models often send every optional field as "" — treat empty values
        // as "not provided" instead of failing type validation on them.
        const defined = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined && v !== "")
        );
        if (Object.keys(defined).length === 0) {
          throw new Error("No fields to update were provided.");
        }
        api().updateNode(nodeId, defined);
        return { ok: true, updated: Object.keys(defined) };
      },
    }),

    connect_nodes: tool({
      description:
        "Connect two nodes with an edge so the source's output flows into the target.",
      inputSchema: z.object({
        sourceId: z.string(),
        targetId: z.string(),
      }),
      execute: async ({ sourceId, targetId }) => ({
        edgeId: api().connectNodes(sourceId, targetId),
      }),
    }),

    delete_node: tool({
      description: "Delete a node and all edges attached to it.",
      inputSchema: z.object({ nodeId: z.string() }),
      execute: async ({ nodeId }) => {
        api().deleteNode(nodeId);
        return { ok: true };
      },
    }),

    run_workflow: tool({
      description:
        "Run every node in the workflow in dependency order. Returns per-node status, summaries, errors and script logs. Always inspect the result for errors.",
      inputSchema: z.object({}),
      execute: async () => api().runWorkflow(),
    }),

    run_node: tool({
      description:
        "Run one node and everything downstream of it. Returns per-node results like run_workflow.",
      inputSchema: z.object({ nodeId: z.string() }),
      execute: async ({ nodeId }) => api().runNode(nodeId),
    }),

    get_run_history: tool({
      description:
        "Read the most recent run records for this workflow (newest first), including per-node statuses, errors and logs.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ limit }) => api().getRunHistory(limit),
    }),

    query_database: tool({
      description:
        "Run a SQL statement directly against the in-browser PGlite database, e.g. to inspect tables or verify data. Results are capped at 50 rows.",
      inputSchema: z.object({ sql: z.string() }),
      execute: async ({ sql }) => api().queryDatabase(sql),
    }),
  };
}

export type WorkflowTools = ReturnType<typeof createWorkflowTools>;
