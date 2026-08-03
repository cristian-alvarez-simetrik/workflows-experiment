/**
 * SQL dialect abstraction. The compiler core never emits dialect-specific
 * SQL directly; new dialects (Redshift, Snowflake, BigQuery) implement this
 * interface without touching the parser or the language model.
 */

import type { TypedExpression, TypedFunctionCall } from "./plan";

export interface SqlDialect {
  readonly name: string;

  quoteIdentifier(identifier: string): string;

  quoteStringLiteral(value: string): string;

  emitExpression(expression: TypedExpression): string;

  emitFunction(
    functionName: string,
    argumentsSql: string[],
    expression: TypedFunctionCall
  ): string;

  emitCreateTableAs(schema: string, table: string, querySql: string): string;

  emitDropTableIfExists(schema: string, table: string): string;

  /** How bound parameters appear in SQL text ($1, ?, :p1, ...). */
  parameterPlaceholder(index: number): string;

  /** Translate a DSL date format literal (e.g. "yyyy-MM-dd") or undefined. */
  translateDateFormat(dslFormat: string): string | undefined;
}
