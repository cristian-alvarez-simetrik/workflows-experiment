/** Internal semantic type system for the ETL DSL compiler. */

export type SemanticTypeKind =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "null"
  | "unknown";

export interface SemanticType {
  kind: SemanticTypeKind;
}

export const TEXT: SemanticType = { kind: "text" };
export const INTEGER: SemanticType = { kind: "integer" };
export const DECIMAL: SemanticType = { kind: "decimal" };
export const BOOLEAN: SemanticType = { kind: "boolean" };
export const DATE: SemanticType = { kind: "date" };
export const TIMESTAMP: SemanticType = { kind: "timestamp" };
export const NULL: SemanticType = { kind: "null" };
export const UNKNOWN: SemanticType = { kind: "unknown" };

export function typeName(type: SemanticType): string {
  const names: Record<SemanticTypeKind, string> = {
    text: "texto",
    integer: "entero",
    decimal: "decimal",
    boolean: "booleano",
    date: "fecha",
    timestamp: "fecha y hora",
    null: "nulo",
    unknown: "desconocido",
  };
  return names[type.kind];
}

export const isNumeric = (t: SemanticType): boolean =>
  t.kind === "integer" || t.kind === "decimal";

export const isFlexible = (t: SemanticType): boolean =>
  t.kind === "unknown" || t.kind === "null";

export const isDateLike = (t: SemanticType): boolean =>
  t.kind === "date" || t.kind === "timestamp";

/**
 * Can the two operand types appear together in a comparison?
 *
 * Regla de coerción documentada: fecha/fecha-hora es comparable con texto,
 * porque las fechas del DSL se escriben como literales o parámetros de texto
 * ("2026-01-01") y PostgreSQL los coerciona contextualmente a fecha.
 */
export function comparable(a: SemanticType, b: SemanticType): boolean {
  if (isFlexible(a) || isFlexible(b)) return true;
  if (a.kind === b.kind) return true;
  if (isNumeric(a) && isNumeric(b)) return true;
  if (isDateLike(a) && isDateLike(b)) return true;
  if (
    (isDateLike(a) && b.kind === "text") ||
    (isDateLike(b) && a.kind === "text")
  ) {
    return true;
  }
  return false;
}

/**
 * Unify the types of two conditional branches.
 * Returns undefined when the branches are incompatible.
 */
export function unifyBranchTypes(
  a: SemanticType,
  b: SemanticType
): SemanticType | undefined {
  if (a.kind === b.kind) return a;
  if (a.kind === "null") return b;
  if (b.kind === "null") return a;
  if (a.kind === "unknown" || b.kind === "unknown") return UNKNOWN;
  if (isNumeric(a) && isNumeric(b)) return DECIMAL;
  if (isDateLike(a) && isDateLike(b)) return TIMESTAMP;
  return undefined;
}

/** Map a semantic type to the PostgreSQL type used when materializing. */
export function toPostgresType(type: SemanticType): string {
  switch (type.kind) {
    case "text":
      return "TEXT";
    case "integer":
      return "BIGINT";
    case "decimal":
      return "NUMERIC";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "timestamp":
      return "TIMESTAMP";
    default:
      return "TEXT";
  }
}

/** Map a PostgreSQL data type (information_schema) to a semantic type. */
export function fromPostgresType(dataType: string): SemanticType | undefined {
  const normalized = dataType.toLowerCase();
  if (
    ["character varying", "varchar", "text", "character", "char", "name"].some(
      (t) => normalized === t
    )
  ) {
    return TEXT;
  }
  if (["smallint", "integer", "bigint", "int2", "int4", "int8"].includes(normalized)) {
    return INTEGER;
  }
  if (
    ["numeric", "decimal", "real", "double precision", "float4", "float8"].includes(
      normalized
    )
  ) {
    return DECIMAL;
  }
  if (normalized === "boolean" || normalized === "bool") return BOOLEAN;
  if (normalized === "date") return DATE;
  if (normalized.startsWith("timestamp")) return TIMESTAMP;
  return undefined;
}
