/**
 * SQL generator: turns a logical plan into deterministic SQL.
 * Every plan step becomes its own CTE (paso_0, paso_1, ...), per spec §24.
 */

import type { LogicalPlan, LogicalPlanNode, TypedExpression } from "./plan";
import type { SqlDialect } from "./sql-dialect";

const JOIN_SQL: Record<string, string> = {
  inner: "INNER JOIN",
  left: "LEFT JOIN",
  right: "RIGHT JOIN",
  full: "FULL OUTER JOIN",
};

/**
 * Clones a join condition, prefixing every column reference with the SQL
 * qualifier of its side (the previous CTE or the joined table's alias).
 */
function qualifyJoinColumns(
  expression: TypedExpression,
  leftQualifier: string,
  rightQualifier: string
): TypedExpression {
  const recurse = (e: TypedExpression): TypedExpression =>
    qualifyJoinColumns(e, leftQualifier, rightQualifier);
  switch (expression.kind) {
    case "column":
      return {
        ...expression,
        sqlQualifier:
          expression.joinSide === "right" ? rightQualifier : leftQualifier,
      };
    case "unary":
      return { ...expression, operand: recurse(expression.operand) };
    case "binary":
      return {
        ...expression,
        left: recurse(expression.left),
        right: recurse(expression.right),
      };
    case "function-call":
      return { ...expression, args: expression.args.map(recurse) };
    case "conditional":
      return {
        ...expression,
        branches: expression.branches.map((b) => ({
          condition: recurse(b.condition),
          result: recurse(b.result),
        })),
        elseResult: recurse(expression.elseResult),
      };
    default:
      return expression;
  }
}

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
      case "Join": {
        const left = cteName(index - 1);
        const rightAlias = dialect.quoteIdentifier(step.alias);
        const condition = qualifyJoinColumns(step.condition, left, rightAlias);
        const columnLines = step.columns.map((c) => {
          const side = c.side === "left" ? left : rightAlias;
          const source = `${side}.${dialect.quoteIdentifier(c.sourceName)}`;
          return c.sourceName === c.outputName && c.side === "left"
            ? `        ${source}`
            : `        ${source} AS ${dialect.quoteIdentifier(c.outputName)}`;
        });
        body = [
          "    SELECT",
          columnLines.join(",\n"),
          `    FROM ${left}`,
          `    ${JOIN_SQL[step.joinType]} ${dialect.quoteIdentifier(step.schema)}.${dialect.quoteIdentifier(step.table)} AS ${rightAlias}`,
          `        ON ${dialect.emitExpression(condition)}`,
        ].join("\n");
        break;
      }
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
            .map((c) =>
              c.source === c.output
                ? `        ${dialect.quoteIdentifier(c.source)}`
                : `        ${dialect.quoteIdentifier(c.source)} AS ${dialect.quoteIdentifier(c.output)}`
            )
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
