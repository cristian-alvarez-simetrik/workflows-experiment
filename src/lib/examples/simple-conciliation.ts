import systemCsv from "../../../use_cases/simple_conciliation/system_transactions.csv?raw";
import bankCsv from "../../../use_cases/simple_conciliation/bank_movements.csv?raw";
import type { StoredWorkflow } from "../workflow-store";
import type { WorkflowNode } from "../types";

const STRING_PARSER = `// keep every column as string so the join on user_id matches split_part() text
return parseCsv(content, { dynamicTyping: false });`;

const VALIDATE_AND_BUILD = `// input = the upstream file node's table name ("bank_movements")
const table = input;

// validation: every user_email must look like "<digits>:<email>"
const bad = await query(
  \`SELECT count(*)::int AS n FROM \${table} WHERE user_email !~ '^[0-9]+:'\`
);
log("rows with malformed user_email:", bad[0].n);
if (bad[0].n > 0) {
  throw new Error(\`\${bad[0].n} rows have a malformed user_email — aborting\`);
}

// make the workflow re-runnable
await query("DROP TABLE IF EXISTS bank_movements_enriched");
await query("DROP TABLE IF EXISTS reconciliation");

// build the SQL the next node will execute
return \`CREATE TABLE bank_movements_enriched AS
SELECT split_part(user_email, ':', 1) AS user_id,
       date,
       monto,
       user_email
FROM \${table}\`;`;

const JOIN_SQL = `CREATE TABLE reconciliation AS
SELECT s.user_id,
       s.transaction_date,
       s.amount  AS system_amount,
       b.monto   AS bank_amount,
       b.user_email,
       CASE
         WHEN b.user_id IS NULL   THEN 'missing_in_bank'
         WHEN s.amount = b.monto  THEN 'matched'
         ELSE 'amount_mismatch'
       END AS status
FROM system_transactions s
LEFT JOIN bank_movements_enriched b
  ON b.user_id = s.user_id
 AND b.date    = s.transaction_date`;

const VIZ_SQL = `SELECT * FROM reconciliation ORDER BY user_id, transaction_date`;

/** Pre-wired reconciliation workflow: 2 CSVs → transform → join → table. */
export function buildSimpleConciliationExample(): StoredWorkflow {
  const nodes: WorkflowNode[] = [
    {
      id: "file-system",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        label: "system_transactions.csv",
        status: "idle",
        fileName: "system_transactions.csv",
        fileContent: systemCsv,
        tableName: "system_transactions",
        parserScript: STRING_PARSER,
      },
    },
    {
      id: "file-bank",
      type: "file",
      position: { x: 0, y: 380 },
      data: {
        label: "bank_movements.csv",
        status: "idle",
        fileName: "bank_movements.csv",
        fileContent: bankCsv,
        tableName: "bank_movements",
        parserScript: STRING_PARSER,
      },
    },
    {
      id: "script-build",
      type: "script",
      position: { x: 380, y: 350 },
      data: {
        label: "Validate + build transform SQL",
        status: "idle",
        code: VALIDATE_AND_BUILD,
      },
    },
    {
      id: "sql-transform",
      type: "sql",
      position: { x: 760, y: 330 },
      data: {
        label: "Apply the transformation",
        status: "idle",
        sql: "{{input}}",
      },
    },
    {
      id: "sql-join",
      type: "sql",
      position: { x: 1140, y: 150 },
      data: {
        label: "Join system vs bank",
        status: "idle",
        sql: JOIN_SQL,
      },
    },
    {
      id: "viz-result",
      type: "viz",
      position: { x: 1520, y: 130 },
      data: {
        label: "Reconciliation result",
        status: "idle",
        sql: VIZ_SQL,
      },
    },
  ];

  return {
    id: crypto.randomUUID(),
    name: "Simple conciliation (example)",
    nodes,
    edges: [
      { id: "e-bank-script", source: "file-bank", target: "script-build" },
      { id: "e-script-transform", source: "script-build", target: "sql-transform" },
      { id: "e-transform-join", source: "sql-transform", target: "sql-join" },
      { id: "e-system-join", source: "file-system", target: "sql-join" },
      { id: "e-join-viz", source: "sql-join", target: "viz-result" },
    ],
    updatedAt: Date.now(),
  };
}

export const simpleConciliationMeta = {
  title: "Simple conciliation",
  description:
    "Reconcile two transaction CSVs: extract the user id from an encoded email with a script-built SQL transform, join both sources by user id + date, and visualize matched vs missing rows.",
  nodeCount: 6,
  build: buildSimpleConciliationExample,
};
