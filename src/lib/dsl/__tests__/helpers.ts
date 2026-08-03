import { analyze } from "../analyzer";
import type { ProgramNode } from "../ast";
import { compile } from "../compile";
import { lex } from "../lexer";
import { parse } from "../parser";
import { JsonSchemaProvider, TableSchema } from "../schema-provider";

export const SAMPLE_SCHEMA_DOC = {
  connection: "banco",
  schema: "crudo",
  table: "transacciones",
  columns: [
    { name: "id_transaccion", type: "integer", nullable: false },
    { name: "cuenta", type: "text", nullable: true },
    { name: "monto", type: "decimal", nullable: true },
    { name: "monto_original", type: "text", nullable: true },
    { name: "impuesto", type: "decimal", nullable: true },
    { name: "estado", type: "text", nullable: true },
    { name: "fecha_transaccion", type: "date", nullable: true },
  ],
};

export const provider = new JsonSchemaProvider([SAMPLE_SCHEMA_DOC]);

export function parseSource(source: string) {
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  return {
    program: parsed.program,
    diagnostics: [...lexed.diagnostics, ...parsed.diagnostics],
  };
}

export function mustParse(source: string): ProgramNode {
  const { program, diagnostics } = parseSource(source);
  if (!program) {
    throw new Error(
      `El programa no parseó: ${diagnostics.map((d) => d.message).join(" | ")}`
    );
  }
  return program;
}

export async function analyzeSource(source: string) {
  const program = mustParse(source);
  const schema: TableSchema = await provider.getTableSchema({
    connection: "banco",
    schema: "crudo",
    table: "transacciones",
  });
  return analyze(program, schema);
}

export async function compileSource(source: string) {
  return compile(source, provider);
}

/** Wraps an expression in a minimal valid program to test expression parsing. */
export function wrapExpression(expression: string): string {
  return `proceso prueba

desde banco.crudo.transacciones

agregar columna resultado =
    ${expression}

escribir depurado.salida
    modo reemplazar
`;
}
