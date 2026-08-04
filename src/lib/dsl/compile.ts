/**
 * Compilation pipeline:
 *   fuente DSL → lexer → parser → AST → análisis semántico → plan lógico
 *             → SQL PostgreSQL → artefacto compilado
 */

import { analyze } from "./analyzer";
import type { ProgramNode } from "./ast";
import { CompiledArtifact, buildArtifact } from "./artifact";
import { Diagnostic, DiagnosticCodes } from "./diagnostics";
import { lex } from "./lexer";
import { parse } from "./parser";
import type { LogicalPlan } from "./plan";
import { PostgreSqlDialect } from "./postgres-dialect";
import {
  SchemaNotFoundError,
  SchemaProvider,
  TableSchema,
} from "./schema-provider";
import { CompiledSql, compileSql } from "./sql-compiler";

export interface CompileOutput {
  ok: boolean;
  diagnostics: Diagnostic[];
  program?: ProgramNode;
  sourceSchema?: TableSchema;
  plan?: LogicalPlan;
  sql?: CompiledSql;
  artifact?: CompiledArtifact;
}

export async function compile(
  source: string,
  schemaProvider: SchemaProvider
): Promise<CompileOutput> {
  const diagnostics: Diagnostic[] = [];

  // 1. Lexer
  const lexResult = lex(source);
  diagnostics.push(...lexResult.diagnostics);

  // 2. Parser (runs even with lexical errors to surface more diagnostics)
  const parseResult = parse(lexResult.tokens);
  diagnostics.push(...parseResult.diagnostics);

  const hasErrors = () => diagnostics.some((d) => d.severity === "error");
  if (!parseResult.program || hasErrors()) {
    return { ok: false, diagnostics };
  }
  const program = parseResult.program;

  // 3. Source schema
  let sourceSchema: TableSchema;
  try {
    sourceSchema = await schemaProvider.getTableSchema({
      connection: program.source.connection,
      schema: program.source.schema,
      table: program.source.table,
    });
  } catch (err) {
    diagnostics.push({
      code: DiagnosticCodes.SOURCE_TABLE_NOT_FOUND,
      message:
        err instanceof SchemaNotFoundError
          ? err.message
          : `No se pudo obtener el esquema de la tabla fuente: ${String(err)}`,
      severity: "error",
      range: program.source.range,
      hint: 'Cree la tabla fuente primero (en el playground: botón "Crear datos de ejemplo").',
    });
    return { ok: false, diagnostics, program };
  }

  // 3b. Schemas of joined tables ("unir")
  const joinSchemas: TableSchema[] = [];
  for (const join of program.joins) {
    try {
      joinSchemas.push(
        await schemaProvider.getTableSchema({
          connection: join.connection,
          schema: join.schema,
          table: join.table,
        })
      );
    } catch (err) {
      diagnostics.push({
        code: DiagnosticCodes.SOURCE_TABLE_NOT_FOUND,
        message:
          err instanceof SchemaNotFoundError
            ? err.message
            : `No se pudo obtener el esquema de la tabla a unir: ${String(err)}`,
        severity: "error",
        range: join.range,
        hint: "La tabla del \"unir\" debe existir antes de compilar el proceso.",
      });
    }
  }
  if (hasErrors()) {
    return { ok: false, diagnostics, program, sourceSchema };
  }

  // 4. Semantic analysis → logical plan
  const analysis = analyze(program, sourceSchema, joinSchemas);
  diagnostics.push(...analysis.diagnostics);
  if (!analysis.plan || hasErrors()) {
    return { ok: false, diagnostics, program, sourceSchema };
  }

  // 5. SQL generation (PostgreSQL dialect)
  const dialect = new PostgreSqlDialect();
  const sql = compileSql(analysis.plan, dialect);

  // 6. Compiled artifact
  const artifact = await buildArtifact(
    source,
    analysis.plan,
    {
      connection: program.source.connection,
      schema: program.source.schema,
      table: program.source.table,
    },
    sql.statements
  );

  return {
    ok: true,
    diagnostics,
    program,
    sourceSchema,
    plan: analysis.plan,
    sql,
    artifact,
  };
}
