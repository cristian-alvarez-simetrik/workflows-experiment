/**
 * Transactional executor over PGlite.
 *
 * Nota de adaptación al navegador: PostgreSQL no admite parámetros enlazados
 * dentro de sentencias utilitarias como CREATE TABLE AS (protocolo extendido),
 * así que el ejecutor re-emite el SQL con un dialecto que sustituye cada
 * referencia $n por un literal correctamente escapado. Los valores nunca se
 * concatenan como texto crudo: pasan por el mismo emisor tipado del dialecto.
 * El artefacto compilado conserva los placeholders $n para ejecutores que sí
 * soporten enlace nativo (p. ej. `pg` en Node).
 */

import type { PGlite } from "@electric-sql/pglite";
import type { LogicalPlan, TypedParameterReference } from "./plan";
import { PostgreSqlDialect } from "./postgres-dialect";
import { compileSql } from "./sql-compiler";

export type ParameterValue = string | number | boolean | null;

export interface ExecutionResult {
  processName: string;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  source: { connection: string; schema: string; table: string };
  target: { schema: string; table: string };
  success: boolean;
  rowCount?: number;
  error?: string;
  /** Values actually used, for display. Not logged anywhere else. */
  resolvedParameters?: Record<string, ParameterValue>;
}

export class MissingParameterError extends Error {
  constructor(names: string[]) {
    super(
      `Faltan valores para los parámetros obligatorios: ${names
        .map((n) => `"${n}"`)
        .join(", ")}.`
    );
    this.name = "MissingParameterError";
  }
}

/** Dialect that inlines resolved parameter values as escaped literals. */
class LiteralBindingDialect extends PostgreSqlDialect {
  private values: Map<number, ParameterValue>;

  constructor(values: Map<number, ParameterValue>) {
    super();
    this.values = values;
  }

  override emitExpression(
    expression: Parameters<PostgreSqlDialect["emitExpression"]>[0]
  ): string {
    if (expression.kind === "parameter") {
      return this.emitLiteral(expression);
    }
    return super.emitExpression(expression);
  }

  private emitLiteral(reference: TypedParameterReference): string {
    if (!this.values.has(reference.index)) {
      throw new MissingParameterError([reference.name]);
    }
    const value = this.values.get(reference.index)!;
    if (value === null) return "NULL";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`Valor numérico inválido para "${reference.name}".`);
      }
      return String(value);
    }
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    // Text literals keep PostgreSQL's contextual coercion (dates, numbers...).
    return this.quoteStringLiteral(value);
  }
}

/**
 * Resolves parameter values: provided > default > error (before touching
 * the database, per spec §8).
 */
export function resolveParameters(
  plan: LogicalPlan,
  provided: Record<string, ParameterValue | undefined>
): { byIndex: Map<number, ParameterValue>; byName: Record<string, ParameterValue> } {
  const byIndex = new Map<number, ParameterValue>();
  const byName: Record<string, ParameterValue> = {};
  const missing: string[] = [];

  for (const parameter of plan.parameters) {
    const givenValue = provided[parameter.name];
    let value: ParameterValue;
    if (givenValue !== undefined) {
      value = givenValue;
    } else if (!parameter.required) {
      value = parameter.defaultValue ?? null;
    } else {
      missing.push(parameter.name);
      continue;
    }
    byName[parameter.name] = value;
    if (parameter.index !== undefined) {
      byIndex.set(parameter.index, value);
    }
  }

  if (missing.length > 0) throw new MissingParameterError(missing);
  return { byIndex, byName };
}

export async function execute(
  db: PGlite,
  plan: LogicalPlan,
  providedParameters: Record<string, ParameterValue | undefined>
): Promise<ExecutionResult> {
  const startedAt = new Date();
  const start = performance.now();

  const scan = findScan(plan);
  const base: Omit<
    ExecutionResult,
    "success" | "finishedAt" | "durationMs"
  > = {
    processName: plan.processName,
    startedAt,
    source: {
      connection: scan.connection,
      schema: scan.schema,
      table: scan.table,
    },
    target: { schema: plan.output.schema, table: plan.output.table },
  };

  const finish = (
    partial: Partial<ExecutionResult> & { success: boolean }
  ): ExecutionResult => ({
    ...base,
    finishedAt: new Date(),
    durationMs: performance.now() - start,
    ...partial,
  });

  let resolved: ReturnType<typeof resolveParameters>;
  try {
    // Fails before opening any transaction when a required value is missing.
    resolved = resolveParameters(plan, providedParameters);
  } catch (err) {
    return finish({ success: false, error: (err as Error).message });
  }

  const dialect = new LiteralBindingDialect(resolved.byIndex);
  let statements;
  try {
    statements = compileSql(plan, dialect).statements;
  } catch (err) {
    return finish({
      success: false,
      error: (err as Error).message,
      resolvedParameters: resolved.byName,
    });
  }

  const quotedSchema = `"${plan.output.schema.replace(/"/g, '""')}"`;
  const quotedTable = `${quotedSchema}."${plan.output.table.replace(/"/g, '""')}"`;

  try {
    await db.exec("BEGIN");
    await db.exec(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    for (const statement of statements) {
      await db.exec(statement.sql);
    }
    await db.exec("COMMIT");
  } catch (err) {
    try {
      await db.exec("ROLLBACK");
    } catch {
      // Connection-level failure; nothing else to clean up.
    }
    return finish({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      resolvedParameters: resolved.byName,
    });
  }

  let rowCount: number | undefined;
  try {
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${quotedTable}`
    );
    rowCount = count.rows[0]?.n;
  } catch {
    rowCount = undefined;
  }

  return finish({
    success: true,
    rowCount,
    resolvedParameters: resolved.byName,
  });
}

function findScan(plan: LogicalPlan) {
  let node = plan.root;
  while (node.type !== "Scan") node = node.input;
  return node;
}
