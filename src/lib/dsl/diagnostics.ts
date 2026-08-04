/**
 * Structured diagnostics for the ETL DSL compiler.
 *
 * Code ranges:
 *   DSL1xx — lexical errors
 *   DSL2xx — syntax errors
 *   DSL3xx — semantic errors
 *   DSL4xx — SQL compilation errors
 *   DSL5xx — execution errors
 */

export interface SourcePosition {
  offset: number;
  line: number; // 1-based
  column: number; // 1-based
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  range: SourceRange;
  hint?: string;
}

export const DiagnosticCodes = {
  // Lexer
  INVALID_CHARACTER: "DSL101",
  UNTERMINATED_STRING: "DSL102",
  INVALID_NUMBER: "DSL103",
  DOUBLE_EQUALS: "DSL105",
  UNSUPPORTED_OPERATOR: "DSL106",
  // Parser
  UNEXPECTED_TOKEN: "DSL201",
  MISSING_TOKEN: "DSL202",
  UNKNOWN_STATEMENT: "DSL203",
  UNSUPPORTED_FEATURE: "DSL204",
  INVALID_PROGRAM_ORDER: "DSL205",
  DUPLICATE_STATEMENT: "DSL206",
  INVALID_REFERENCE: "DSL207",
  MISSING_EXPRESSION: "DSL208",
  UNSUPPORTED_MODE: "DSL209",
  // Semantic
  UNKNOWN_COLUMN: "DSL301",
  COLUMN_ALREADY_EXISTS: "DSL302",
  UNDECLARED_PARAMETER: "DSL303",
  DUPLICATE_PARAMETER: "DSL304",
  UNKNOWN_FUNCTION: "DSL305",
  BAD_ARGUMENT_COUNT: "DSL306",
  BAD_ARGUMENT_TYPE: "DSL307",
  INCOMPATIBLE_OPERANDS: "DSL308",
  FILTER_NOT_BOOLEAN: "DSL309",
  CONDITION_NOT_BOOLEAN: "DSL310",
  INCOMPATIBLE_BRANCHES: "DSL311",
  DUPLICATE_SELECT_COLUMN: "DSL312",
  UNSUPPORTED_DATE_FORMAT: "DSL313",
  UNKNOWN_SOURCE_TYPE: "DSL314",
  UNKNOWN_ALIAS: "DSL315",
  AMBIGUOUS_COLUMN: "DSL316",
  DUPLICATE_ALIAS: "DSL317",
  JOIN_NOT_BOOLEAN: "DSL318",
  // SQL compilation
  SQL_GENERATION: "DSL401",
  // Execution
  MISSING_PARAMETER_VALUE: "DSL501",
  SOURCE_TABLE_NOT_FOUND: "DSL502",
  EXECUTION_FAILED: "DSL503",
} as const;

export function makeRange(
  start: SourcePosition,
  end: SourcePosition
): SourceRange {
  return { start, end };
}

export const ZERO_POSITION: SourcePosition = { offset: 0, line: 1, column: 1 };
export const ZERO_RANGE: SourceRange = {
  start: ZERO_POSITION,
  end: ZERO_POSITION,
};

/**
 * Renders a diagnostic in the CLI-style format required by the spec:
 *
 *   DSL105: El operador "==" no existe.
 *
 *   proceso.etl:8:11
 *
 *   8 | si estado == "ACTIVO"
 *                 ^^
 *
 *   Utilice "=" para comparar valores.
 */
export function formatDiagnostic(
  diagnostic: Diagnostic,
  source: string,
  fileName = "proceso.etl"
): string {
  const { code, message, range, hint } = diagnostic;
  const lines = source.split("\n");
  const lineText = lines[range.start.line - 1] ?? "";
  const lineNo = String(range.start.line);
  const caretStart = range.start.column - 1;
  const caretLength =
    range.end.line === range.start.line
      ? Math.max(1, range.end.column - range.start.column)
      : Math.max(1, lineText.length - caretStart);

  const parts = [
    `${code}: ${message}`,
    "",
    `${fileName}:${range.start.line}:${range.start.column}`,
    "",
    `${lineNo} | ${lineText}`,
    `${" ".repeat(lineNo.length + 3 + caretStart)}${"^".repeat(caretLength)}`,
  ];
  if (hint) {
    parts.push("", hint);
  }
  return parts.join("\n");
}
