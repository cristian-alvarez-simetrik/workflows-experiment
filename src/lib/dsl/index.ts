/**
 * Compilador DSL de transformaciones ETL hacia SQL (versión 0.1).
 *
 * Pipeline: DSL → lexer → parser → AST → análisis semántico → plan lógico
 *           → SQL PostgreSQL → ejecutor PGlite (navegador).
 */

export * from "./diagnostics";
export * from "./lexer";
export * from "./ast";
export { parse } from "./parser";
export * from "./semantic-types";
export * from "./functions";
export * from "./plan";
export * from "./schema-provider";
export { analyze } from "./analyzer";
export type { AnalysisResult } from "./analyzer";
export * from "./sql-dialect";
export { PostgreSqlDialect } from "./postgres-dialect";
export * from "./sql-compiler";
export * from "./artifact";
export * from "./compile";
export * from "./executor";
