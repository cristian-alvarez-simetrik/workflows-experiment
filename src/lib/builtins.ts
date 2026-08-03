import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "./types";

/**
 * Built-in nodes: pre-configured groups of native nodes that solve one
 * specific task. Each factory returns the group container plus its children
 * (positions relative to the group) and the edges wiring them together.
 */

export type BuiltinKind = "transformation-column" | "conciliation";

export interface BuiltinTemplate {
  nodes: WorkflowNode[];
  edges: Edge[];
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target };
}

const idle = { status: "idle" as const };

// --- Transformation column ---------------------------------------------------

const TRANSFORMATION_FORM_SCHEMA = `title: New transformation column
fields:
  - name: source_table
    label: Source table
    type: text
    required: true
    placeholder: my_table
    help: Existing PGlite table to transform
  - name: new_table
    label: New table name
    type: text
    required: true
    placeholder: my_table_enriched
  - name: column_name
    label: New column name
    type: text
    required: true
    placeholder: total_with_tax
  - name: formula
    label: SQL formula
    type: textarea
    required: true
    placeholder: amount * 1.19
    help: SQL expression computed for each row (can reference any source column)
`;

const TRANSFORMATION_BUILD_SQL = `// Builds the CREATE TABLE statement for the transformation column.
const form = input; // output of the form node
if (!form) throw new Error("Run the form node first");
await query(\`DROP TABLE IF EXISTS "\${form.new_table}"\`);
const sql = \`CREATE TABLE "\${form.new_table}" AS
SELECT *, (\${form.formula}) AS "\${form.column_name}"
FROM "\${form.source_table}"\`;
log(sql);
return sql;`;

const TRANSFORMATION_PREVIEW = `// Runs after the sql node; builds the preview query for the viz node.
const form = inputs.find(
  (v) => v && typeof v === "object" && !Array.isArray(v) && v.new_table
);
if (!form) throw new Error("Form values not found — connect the form node");
return \`SELECT * FROM "\${form.new_table}" LIMIT 100\`;`;

export function makeTransformationColumnGroup(position: {
  x: number;
  y: number;
}): BuiltinTemplate {
  const groupId = uid("group");
  const formId = uid("form");
  const buildId = uid("script");
  const applyId = uid("sql");
  const previewId = uid("script");
  const vizId = uid("viz");

  const group: WorkflowNode = {
    id: groupId,
    type: "group",
    position,
    style: { width: 1020, height: 660 },
    data: {
      ...idle,
      label: "Transformation column",
      builtinKind: "transformation-column",
    },
  };

  const child = (
    id: string,
    type: WorkflowNode["type"],
    x: number,
    y: number,
    data: WorkflowNode["data"]
  ): WorkflowNode => ({
    id,
    type,
    position: { x, y },
    parentId: groupId,
    expandParent: true,
    data,
  });

  return {
    nodes: [
      group,
      child(formId, "form", 24, 64, {
        ...idle,
        label: "Setup",
        schemaYaml: TRANSFORMATION_FORM_SCHEMA,
        values: {},
      }),
      child(buildId, "script", 364, 64, {
        ...idle,
        label: "Build SQL",
        code: TRANSFORMATION_BUILD_SQL,
      }),
      child(applyId, "sql", 704, 64, {
        ...idle,
        label: "Create table",
        sql: "{{input}}",
      }),
      child(previewId, "script", 364, 380, {
        ...idle,
        label: "Preview query",
        code: TRANSFORMATION_PREVIEW,
      }),
      child(vizId, "viz", 704, 380, {
        ...idle,
        label: "Result",
        sql: "{{input}}",
      }),
    ],
    edges: [
      edge(formId, buildId),
      edge(buildId, applyId),
      edge(formId, previewId),
      edge(applyId, previewId),
      edge(previewId, vizId),
    ],
  };
}

// --- Conciliation --------------------------------------------------------------

const CONCILIATION_FORM_SCHEMA = `title: Conciliation
fields:
  - name: name
    label: Conciliation name
    type: text
    required: true
    placeholder: bank_vs_ledger
    help: The result table is created with this name
  - name: left_table
    label: Left table
    type: text
    required: true
    placeholder: bank_movements
  - name: right_table
    label: Right table
    type: text
    required: true
    placeholder: ledger_entries
  - name: sweeps
    label: Sweeps
    type: list
    item_label: Sweep
    required: true
    help: Each sweep adds one equality condition to the join
    fields:
      - name: left_column
        label: Left column
        type: text
        required: true
      - name: right_column
        label: Right column
        type: text
        required: true
      - name: tolerance
        label: Tolerance
        type: number
        default: 0
        help: For numeric columns, max allowed difference (0 = exact match)
`;

const CONCILIATION_BUILD_SQL = `// Builds the conciliation table: FULL OUTER JOIN of both sides on the sweeps.
const form = input; // output of the form node
if (!form) throw new Error("Run the form node first");
const sweeps = form.sweeps ?? [];
if (sweeps.length === 0) throw new Error("Add at least one sweep in the form");

const cols = async (table) =>
  (await query(
    \`SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '\${table}'
     ORDER BY ordinal_position\`
  )).map((r) => r.column_name);

const leftCols = await cols(form.left_table);
const rightCols = await cols(form.right_table);
if (leftCols.length === 0) throw new Error(\`Table "\${form.left_table}" not found\`);
if (rightCols.length === 0) throw new Error(\`Table "\${form.right_table}" not found\`);

// Prefix columns so both sides can coexist in the result table.
const select = [
  ...leftCols.map((c) => \`l."\${c}" AS "left_\${c}"\`),
  ...rightCols.map((c) => \`r."\${c}" AS "right_\${c}"\`),
].join(",\\n  ");

const on = sweeps
  .map((s) =>
    Number(s.tolerance) > 0
      ? \`ABS(l."\${s.left_column}"::numeric - r."\${s.right_column}"::numeric) <= \${Number(s.tolerance)}\`
      : \`l."\${s.left_column}" = r."\${s.right_column}"\`
  )
  .join("\\n  AND ");

await query(\`DROP TABLE IF EXISTS "\${form.name}"\`);
const sql = \`CREATE TABLE "\${form.name}" AS
SELECT
  CASE WHEN r IS NULL THEN 'left_only'
       WHEN l IS NULL THEN 'right_only'
       ELSE 'matched' END AS conciliation_status,
  \${select}
FROM "\${form.left_table}" l
FULL OUTER JOIN "\${form.right_table}" r ON \${on}\`;
log(sql);
return sql;`;

const CONCILIATION_PREVIEW = `// Runs after the sql node; builds the preview query for the viz node.
const form = inputs.find(
  (v) => v && typeof v === "object" && !Array.isArray(v) && v.name
);
if (!form) throw new Error("Form values not found — connect the form node");
return \`SELECT * FROM "\${form.name}" ORDER BY conciliation_status LIMIT 200\`;`;

export function makeConciliationGroup(position: {
  x: number;
  y: number;
}): BuiltinTemplate {
  const groupId = uid("group");
  const formId = uid("form");
  const buildId = uid("script");
  const applyId = uid("sql");
  const previewId = uid("script");
  const vizId = uid("viz");

  const group: WorkflowNode = {
    id: groupId,
    type: "group",
    position,
    style: { width: 1020, height: 880 },
    data: {
      ...idle,
      label: "Conciliation",
      builtinKind: "conciliation",
    },
  };

  const child = (
    id: string,
    type: WorkflowNode["type"],
    x: number,
    y: number,
    data: WorkflowNode["data"]
  ): WorkflowNode => ({
    id,
    type,
    position: { x, y },
    parentId: groupId,
    expandParent: true,
    data,
  });

  return {
    nodes: [
      group,
      child(formId, "form", 24, 64, {
        ...idle,
        label: "Setup",
        schemaYaml: CONCILIATION_FORM_SCHEMA,
        values: { sweeps: [{ left_column: "", right_column: "", tolerance: 0 }] },
      }),
      child(buildId, "script", 364, 64, {
        ...idle,
        label: "Build join SQL",
        code: CONCILIATION_BUILD_SQL,
      }),
      child(applyId, "sql", 704, 64, {
        ...idle,
        label: "Create conciliation",
        sql: "{{input}}",
      }),
      child(previewId, "script", 364, 480, {
        ...idle,
        label: "Preview query",
        code: CONCILIATION_PREVIEW,
      }),
      child(vizId, "viz", 704, 480, {
        ...idle,
        label: "Conciliation result",
        sql: "{{input}}",
      }),
    ],
    edges: [
      edge(formId, buildId),
      edge(buildId, applyId),
      edge(formId, previewId),
      edge(applyId, previewId),
      edge(previewId, vizId),
    ],
  };
}

export const BUILTIN_FACTORIES: Record<
  BuiltinKind,
  (position: { x: number; y: number }) => BuiltinTemplate
> = {
  "transformation-column": makeTransformationColumnGroup,
  conciliation: makeConciliationGroup,
};
