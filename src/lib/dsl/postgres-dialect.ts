/** PostgreSQL dialect. PGlite speaks PostgreSQL, so it shares this dialect. */

import { getFunction } from "./functions";
import type { TypedExpression, TypedFunctionCall } from "./plan";
import type { SqlDialect } from "./sql-dialect";

const DATE_FORMAT_TRANSLATIONS: Record<string, string> = {
  "yyyy-MM-dd": "YYYY-MM-DD",
  "dd/MM/yyyy": "DD/MM/YYYY",
  yyyyMMdd: "YYYYMMDD",
};

export class PostgreSqlDialect implements SqlDialect {
  readonly name = "postgresql";

  quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  quoteStringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  parameterPlaceholder(index: number): string {
    return `$${index}`;
  }

  translateDateFormat(dslFormat: string): string | undefined {
    return DATE_FORMAT_TRANSLATIONS[dslFormat];
  }

  emitExpression(expression: TypedExpression): string {
    switch (expression.kind) {
      case "string-literal":
        return this.quoteStringLiteral(expression.value);
      case "number-literal":
        return String(expression.value);
      case "boolean-literal":
        return expression.value ? "TRUE" : "FALSE";
      case "null-literal":
        return "NULL";
      case "column":
        return this.quoteIdentifier(expression.name);
      case "parameter":
        return this.parameterPlaceholder(expression.index);
      case "unary": {
        const operand = this.emitExpression(expression.operand);
        if (expression.operator === "no") return `(NOT ${operand})`;
        return `(${expression.operator}${operand})`;
      }
      case "binary": {
        const left = this.emitExpression(expression.left);
        const right = this.emitExpression(expression.right);
        const operator = BINARY_SQL[expression.operator];
        return `(${left} ${operator} ${right})`;
      }
      case "function-call":
        return this.emitFunction(
          expression.name,
          expression.args.map((a) => this.emitExpression(a)),
          expression
        );
      case "conditional": {
        const whens = expression.branches
          .map(
            (b) =>
              `WHEN ${this.emitExpression(b.condition)} THEN ${this.emitExpression(b.result)}`
          )
          .join(" ");
        return `CASE ${whens} ELSE ${this.emitExpression(expression.elseResult)} END`;
      }
    }
  }

  emitFunction(
    functionName: string,
    argumentsSql: string[],
    expression: TypedFunctionCall
  ): string {
    const definition = getFunction(functionName);
    if (!definition) {
      // The analyzer guarantees registered functions; guard for safety.
      throw new Error(`Función no registrada: ${functionName}`);
    }
    return definition.emitSql(argumentsSql, expression, this);
  }

  emitCreateTableAs(schema: string, table: string, querySql: string): string {
    return `CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)} AS\n${querySql};`;
  }

  emitDropTableIfExists(schema: string, table: string): string {
    return `DROP TABLE IF EXISTS ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(table)};`;
  }
}

const BINARY_SQL: Record<string, string> = {
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "=": "=",
  "!=": "<>",
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  y: "AND",
  o: "OR",
};
