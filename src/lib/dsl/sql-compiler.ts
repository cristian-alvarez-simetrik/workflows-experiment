/**
 * SQL generator: turns a logical plan into deterministic SQL.
 * Every plan step becomes its own CTE (paso_0, paso_1, ...), per spec §24.
 */

import type { LogicalPlan, LogicalPlanNode } from "./plan";
import type { SqlDialect } from "./sql-dialect";

export interface SqlStatement {
  kind: "drop-target" | "create-target";
  sql: string;
}

export interface CompiledSql {
  statements: SqlStatement[];
  /** The SELECT query alone (CTE chain), useful for previews. */
  query: string;
}

export function compileSql(
  plan: LogicalPlan,
  dialect: SqlDialect
): CompiledSql {
  // Flatten the plan chain: Scan is the deepest node.
  const steps: LogicalPlanNode[] = [];
  let node: LogicalPlanNode | undefined = plan.root;
  while (node) {
    steps.unshift(node);
    node = "input" in node ? node.input : undefined;
  }

  const cteName = (index: number) => `paso_${index}`;
  const ctes: string[] = [];

  steps.forEach((step, index) => {
    let body: string;
    switch (step.type) {
      case "Scan":
        body = [
          "    SELECT",
          "        *",
          `    FROM ${dialect.quoteIdentifier(step.schema)}.${dialect.quoteIdentifier(step.table)}`,
        ].join("\n");
        break;
      case "Filter":
        body = [
          "    SELECT",
          "        *",
          `    FROM ${cteName(index - 1)}`,
          `    WHERE ${dialect.emitExpression(step.condition)}`,
        ].join("\n");
        break;
      case "AddColumn":
        body = [
          "    SELECT",
          `        ${cteName(index - 1)}.*,`,
          `        ${dialect.emitExpression(step.expression)} AS ${dialect.quoteIdentifier(step.name)}`,
          `    FROM ${cteName(index - 1)}`,
        ].join("\n");
        break;
      case "Project":
        body = [
          "    SELECT",
          step.columns
            .map((c) => `        ${dialect.quoteIdentifier(c)}`)
            .join(",\n"),
          `    FROM ${cteName(index - 1)}`,
        ].join("\n");
        break;
    }
    ctes.push(`${cteName(index)} AS (\n${body}\n)`);
  });

  const query = [
    "WITH",
    ctes.join(",\n"),
    "SELECT",
    "    *",
    `FROM ${cteName(steps.length - 1)}`,
  ].join("\n");

  const statements: SqlStatement[] = [
    {
      kind: "drop-target",
      sql: dialect.emitDropTableIfExists(plan.output.schema, plan.output.table),
    },
    {
      kind: "create-target",
      sql: dialect.emitCreateTableAs(
        plan.output.schema,
        plan.output.table,
        query
      ),
    },
  ];

  return { statements, query };
}
