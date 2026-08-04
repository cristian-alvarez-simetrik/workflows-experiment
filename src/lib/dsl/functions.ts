/**
 * Central function registry. Each DSL function declares its arity, argument
 * validation, return-type inference, and per-dialect SQL emission.
 * The parser knows nothing about individual functions.
 */

import type { ExpressionNode } from "./ast";
import type { TypedFunctionCall } from "./plan";
import {
  BOOLEAN,
  DATE,
  DECIMAL,
  INTEGER,
  SemanticType,
  TEXT,
  TIMESTAMP,
  UNKNOWN,
  isDateLike,
  isFlexible,
  isNumeric,
  typeName,
} from "./semantic-types";
import type { SqlDialect } from "./sql-dialect";

export interface FunctionDefinition {
  name: string;
  minArgs: number;
  maxArgs: number;
  /**
   * Returns an error message when the argument types (or literal shapes)
   * are invalid, or null when they are acceptable.
   */
  validateArguments(
    argumentTypes: SemanticType[],
    argumentNodes: ExpressionNode[]
  ): string | null;
  inferReturnType(argumentTypes: SemanticType[]): SemanticType;
  emitSql(
    argumentsSql: string[],
    expression: TypedFunctionCall,
    dialect: SqlDialect
  ): string;
}

/** DSL date formats accepted by convertir_fecha in version 0.2. */
export const SUPPORTED_DATE_FORMATS = ["yyyy-MM-dd", "dd/MM/yyyy", "yyyyMMdd"];

const acceptsText = (t: SemanticType) => t.kind === "text" || isFlexible(t);
const acceptsNumeric = (t: SemanticType) => isNumeric(t) || isFlexible(t);
const acceptsDate = (t: SemanticType) => isDateLike(t) || isFlexible(t);
const acceptsInteger = (t: SemanticType) =>
  t.kind === "integer" || isFlexible(t);

function checkPositions(
  types: SemanticType[],
  checks: {
    accepts: (t: SemanticType) => boolean;
    label: string;
  }[]
): string | null {
  for (let i = 0; i < types.length; i++) {
    const check = checks[Math.min(i, checks.length - 1)];
    if (!check.accepts(types[i])) {
      return `el argumento ${i + 1} debe ser ${check.label}, pero se obtuvo ${typeName(types[i])}`;
    }
  }
  return null;
}

const textArg = { accepts: acceptsText, label: "texto" };
const numericArg = { accepts: acceptsNumeric, label: "numérico" };
const integerArg = { accepts: acceptsInteger, label: "entero" };
const dateArg = { accepts: acceptsDate, label: "fecha" };
const anyArg = { accepts: () => true, label: "cualquier valor" };

function simpleCall(sqlName: string) {
  return (argumentsSql: string[]) => `${sqlName}(${argumentsSql.join(", ")})`;
}

const definitions: FunctionDefinition[] = [
  // --- Texto -----------------------------------------------------------
  {
    name: "mayusculas",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [textArg]),
    inferReturnType: () => TEXT,
    emitSql: simpleCall("UPPER"),
  },
  {
    name: "minusculas",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [textArg]),
    inferReturnType: () => TEXT,
    emitSql: simpleCall("LOWER"),
  },
  {
    name: "recortar",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [textArg]),
    inferReturnType: () => TEXT,
    emitSql: simpleCall("TRIM"),
  },
  {
    name: "concatenar",
    minArgs: 2,
    maxArgs: Number.POSITIVE_INFINITY,
    validateArguments: () => null, // CONCAT accepts any value and casts to text
    inferReturnType: () => TEXT,
    emitSql: simpleCall("CONCAT"),
  },
  {
    name: "reemplazar",
    minArgs: 3,
    maxArgs: 3,
    validateArguments: (types) =>
      checkPositions(types, [textArg, textArg, textArg]),
    inferReturnType: () => TEXT,
    emitSql: simpleCall("REPLACE"),
  },
  {
    name: "longitud",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [textArg]),
    inferReturnType: () => INTEGER,
    emitSql: simpleCall("LENGTH"),
  },
  {
    name: "subtexto",
    minArgs: 3,
    maxArgs: 3,
    validateArguments: (types) =>
      checkPositions(types, [textArg, integerArg, integerArg]),
    inferReturnType: () => TEXT,
    // 1-based indices, same as PostgreSQL.
    emitSql: ([value, start, length]) =>
      `SUBSTRING(${value} FROM ${start} FOR ${length})`,
  },

  // --- Numéricas -------------------------------------------------------
  {
    name: "absoluto",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [numericArg]),
    inferReturnType: (types) =>
      types[0].kind === "integer" ? INTEGER : DECIMAL,
    emitSql: simpleCall("ABS"),
  },
  {
    name: "redondear",
    minArgs: 2,
    maxArgs: 2,
    validateArguments: (types) =>
      checkPositions(types, [numericArg, integerArg]),
    inferReturnType: () => DECIMAL,
    // ROUND with a scale requires NUMERIC in PostgreSQL.
    emitSql: ([value, decimals]) =>
      `ROUND(CAST(${value} AS NUMERIC), ${decimals})`,
  },

  // --- Conversiones ----------------------------------------------------
  {
    name: "convertir_decimal",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [anyArg]),
    inferReturnType: () => DECIMAL,
    emitSql: ([value]) => `CAST(${value} AS NUMERIC)`,
  },
  {
    name: "convertir_entero",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [anyArg]),
    inferReturnType: () => INTEGER,
    emitSql: ([value]) => `CAST(${value} AS BIGINT)`,
  },
  {
    name: "convertir_texto",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [anyArg]),
    inferReturnType: () => TEXT,
    emitSql: ([value]) => `CAST(${value} AS TEXT)`,
  },
  {
    name: "convertir_fecha",
    minArgs: 2,
    maxArgs: 2,
    validateArguments: (types, nodes) => {
      const base = checkPositions(types, [textArg, textArg]);
      if (base) return base;
      const format = nodes[1];
      if (format.type !== "StringLiteral") {
        return "el formato debe ser un literal de texto";
      }
      if (!SUPPORTED_DATE_FORMATS.includes(format.value)) {
        return `el formato "${format.value}" no está soportado. Formatos válidos: ${SUPPORTED_DATE_FORMATS.map((f) => `"${f}"`).join(", ")}`;
      }
      return null;
    },
    inferReturnType: () => DATE,
    emitSql: ([value], expression, dialect) => {
      const dslFormat = expression.meta?.dslDateFormat ?? "";
      const translated = dialect.translateDateFormat(dslFormat) ?? dslFormat;
      return `TO_DATE(${value}, ${dialect.quoteStringLiteral(translated)})`;
    },
  },

  // --- Nulos -----------------------------------------------------------
  {
    name: "coalescer",
    minArgs: 2,
    maxArgs: 2,
    validateArguments: () => null,
    inferReturnType: (types) =>
      types[0].kind !== "null" && types[0].kind !== "unknown"
        ? types[0]
        : types[1],
    emitSql: simpleCall("COALESCE"),
  },
  {
    name: "es_nulo",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: () => null,
    inferReturnType: () => BOOLEAN,
    emitSql: ([value]) => `(${value} IS NULL)`,
  },
  {
    name: "no_es_nulo",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: () => null,
    inferReturnType: () => BOOLEAN,
    emitSql: ([value]) => `(${value} IS NOT NULL)`,
  },

  // --- Fechas ----------------------------------------------------------
  {
    name: "anio",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [dateArg]),
    inferReturnType: () => INTEGER,
    emitSql: ([value]) => `EXTRACT(YEAR FROM ${value})`,
  },
  {
    name: "mes",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [dateArg]),
    inferReturnType: () => INTEGER,
    emitSql: ([value]) => `EXTRACT(MONTH FROM ${value})`,
  },
  {
    name: "dia",
    minArgs: 1,
    maxArgs: 1,
    validateArguments: (types) => checkPositions(types, [dateArg]),
    inferReturnType: () => INTEGER,
    emitSql: ([value]) => `EXTRACT(DAY FROM ${value})`,
  },
  {
    name: "sumar_dias",
    minArgs: 2,
    maxArgs: 2,
    validateArguments: (types) => checkPositions(types, [dateArg, integerArg]),
    inferReturnType: (types) => (isDateLike(types[0]) ? types[0] : DATE),
    emitSql: ([fecha, cantidad]) =>
      `(${fecha} + (${cantidad}) * INTERVAL '1 day')`,
  },
  {
    name: "diferencia_dias",
    minArgs: 2,
    maxArgs: 2,
    validateArguments: (types) => checkPositions(types, [dateArg, dateArg]),
    inferReturnType: () => INTEGER,
    // diferencia_dias(inicio, fin) = fin - inicio
    emitSql: ([inicio, fin]) => `(${fin} - ${inicio})`,
  },
  {
    name: "fecha_actual",
    minArgs: 0,
    maxArgs: 0,
    validateArguments: () => null,
    inferReturnType: () => DATE,
    emitSql: () => "CURRENT_DATE",
  },
  {
    name: "fecha_hora_actual",
    minArgs: 0,
    maxArgs: 0,
    validateArguments: () => null,
    inferReturnType: () => TIMESTAMP,
    emitSql: () => "CURRENT_TIMESTAMP",
  },
];

const registry = new Map<string, FunctionDefinition>(
  definitions.map((d) => [d.name, d])
);

export function getFunction(name: string): FunctionDefinition | undefined {
  return registry.get(name);
}

export function listFunctions(): FunctionDefinition[] {
  return definitions;
}

export { UNKNOWN as UNKNOWN_TYPE };
