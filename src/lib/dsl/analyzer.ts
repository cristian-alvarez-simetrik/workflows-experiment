/**
 * Semantic analyzer: validates the AST against the source-table schema and
 * the function registry, infers types, and produces the logical plan.
 */

import type {
  ExpressionNode,
  ParameterDeclarationNode,
  ProgramNode,
} from "./ast";
import { Diagnostic, DiagnosticCodes, SourceRange } from "./diagnostics";
import { getFunction } from "./functions";
import type {
  CompiledParameter,
  LogicalColumn,
  LogicalPlan,
  LogicalPlanNode,
  TypedExpression,
} from "./plan";
import type { TableSchema } from "./schema-provider";
import {
  BOOLEAN,
  DECIMAL,
  INTEGER,
  NULL,
  SemanticType,
  TEXT,
  UNKNOWN,
  comparable,
  isFlexible,
  isNumeric,
  typeName,
  unifyBranchTypes,
} from "./semantic-types";

export interface AnalysisResult {
  plan?: LogicalPlan;
  diagnostics: Diagnostic[];
}

interface ParameterInfo {
  declaration: ParameterDeclarationNode;
  type: SemanticType;
  defaultValue?: string | number | boolean | null;
  hasDefault: boolean;
  index?: number;
  referenced: boolean;
}

export function analyze(
  program: ProgramNode,
  sourceSchema: TableSchema
): AnalysisResult {
  const diagnostics: Diagnostic[] = [];

  const error = (
    code: string,
    message: string,
    range: SourceRange,
    hint?: string
  ) => {
    diagnostics.push({ code, message, severity: "error", range, hint });
  };
  const warning = (code: string, message: string, range: SourceRange) => {
    diagnostics.push({ code, message, severity: "warning", range });
  };

  // Surface schema-provider warnings (unsupported column types).
  for (const note of sourceSchema.warnings) {
    warning(DiagnosticCodes.UNKNOWN_SOURCE_TYPE, note, program.source.range);
  }

  // -------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------

  const parameters = new Map<string, ParameterInfo>();
  let nextParameterIndex = 1;
  const parameterOrder: string[] = [];

  for (const decl of program.parameters) {
    if (parameters.has(decl.name)) {
      error(
        DiagnosticCodes.DUPLICATE_PARAMETER,
        `El parámetro "${decl.name}" ya fue declarado.`,
        decl.range
      );
      continue;
    }
    let type: SemanticType = UNKNOWN;
    let defaultValue: string | number | boolean | null | undefined;
    let hasDefault = false;
    if (decl.defaultValue) {
      const literal = extractLiteral(decl.defaultValue);
      if (!literal) {
        error(
          DiagnosticCodes.UNEXPECTED_TOKEN,
          `El valor predeterminado del parámetro "${decl.name}" debe ser un literal (texto, número, booleano o nulo).`,
          decl.defaultValue.range
        );
      } else {
        type = literal.type;
        defaultValue = literal.value;
        hasDefault = true;
      }
    }
    parameters.set(decl.name, {
      declaration: decl,
      type,
      defaultValue,
      hasDefault,
      referenced: false,
    });
  }

  // -------------------------------------------------------------------------
  // Column environment (updated step by step)
  // -------------------------------------------------------------------------

  let columns: LogicalColumn[] = sourceSchema.columns.map((c) => ({
    name: c.name,
    type: c.type,
    nullable: c.nullable,
  }));

  const findColumn = (name: string): LogicalColumn | undefined =>
    columns.find((c) => c.name === name);

  // -------------------------------------------------------------------------
  // Expression typing
  // -------------------------------------------------------------------------

  const typeExpression = (node: ExpressionNode): TypedExpression => {
    switch (node.type) {
      case "StringLiteral":
        return { kind: "string-literal", value: node.value, type: TEXT };
      case "NumberLiteral":
        return {
          kind: "number-literal",
          value: node.value,
          type: node.isInteger ? INTEGER : DECIMAL,
        };
      case "BooleanLiteral":
        return { kind: "boolean-literal", value: node.value, type: BOOLEAN };
      case "NullLiteral":
        return { kind: "null-literal", type: NULL };

      case "ColumnReference": {
        const column = findColumn(node.name);
        if (!column) {
          error(
            DiagnosticCodes.UNKNOWN_COLUMN,
            `La columna "${node.name}" no existe en este punto del proceso.`,
            node.range,
            "La columna todavía no ha sido creada o no pertenece a la tabla fuente."
          );
          return { kind: "column", name: node.name, type: UNKNOWN };
        }
        return { kind: "column", name: node.name, type: column.type };
      }

      case "ParameterReference": {
        const info = parameters.get(node.name);
        if (!info) {
          error(
            DiagnosticCodes.UNDECLARED_PARAMETER,
            `El parámetro "$${node.name}" no ha sido declarado.`,
            node.range,
            `Declárelo antes de "desde": parametro ${node.name}`
          );
          return { kind: "parameter", name: node.name, index: 0, type: UNKNOWN };
        }
        if (!info.referenced) {
          info.referenced = true;
          info.index = nextParameterIndex++;
          parameterOrder.push(node.name);
        }
        return {
          kind: "parameter",
          name: node.name,
          index: info.index!,
          type: info.type,
        };
      }

      case "UnaryExpression": {
        const operand = typeExpression(node.operand);
        if (node.operator === "no") {
          if (operand.type.kind !== "boolean" && !isFlexible(operand.type)) {
            error(
              DiagnosticCodes.INCOMPATIBLE_OPERANDS,
              `El operador "no" requiere un valor booleano, pero se obtuvo ${typeName(operand.type)}.`,
              node.range
            );
          }
          return { kind: "unary", operator: "no", operand, type: BOOLEAN };
        }
        // Numeric unary +/-.
        if (!isNumeric(operand.type) && !isFlexible(operand.type)) {
          error(
            DiagnosticCodes.INCOMPATIBLE_OPERANDS,
            `El operador unario "${node.operator}" requiere un valor numérico, pero se obtuvo ${typeName(operand.type)}.`,
            node.range
          );
        }
        return {
          kind: "unary",
          operator: node.operator,
          operand,
          type: isNumeric(operand.type) ? operand.type : UNKNOWN,
        };
      }

      case "BinaryExpression": {
        const left = typeExpression(node.left);
        const right = typeExpression(node.right);
        const op = node.operator;

        if (op === "y" || op === "o") {
          for (const side of [left, right]) {
            if (side.type.kind !== "boolean" && !isFlexible(side.type)) {
              error(
                DiagnosticCodes.INCOMPATIBLE_OPERANDS,
                `El operador "${op}" requiere operandos booleanos, pero se obtuvo ${typeName(side.type)}.`,
                node.range
              );
            }
          }
          return { kind: "binary", operator: op, left, right, type: BOOLEAN };
        }

        if (["=", "!=", ">", ">=", "<", "<="].includes(op)) {
          if (!comparable(left.type, right.type)) {
            error(
              DiagnosticCodes.INCOMPATIBLE_OPERANDS,
              `No se pueden comparar valores de tipo ${typeName(left.type)} y ${typeName(right.type)}.`,
              node.range
            );
          }
          return { kind: "binary", operator: op, left, right, type: BOOLEAN };
        }

        // Arithmetic + - * /
        const leftOk = isNumeric(left.type) || isFlexible(left.type);
        const rightOk = isNumeric(right.type) || isFlexible(right.type);
        if (!leftOk || !rightOk) {
          error(
            DiagnosticCodes.INCOMPATIBLE_OPERANDS,
            `El operador "${op}" requiere operandos numéricos, pero se obtuvo ${typeName(left.type)} y ${typeName(right.type)}.`,
            node.range
          );
          return { kind: "binary", operator: op, left, right, type: UNKNOWN };
        }
        let resultType: SemanticType;
        if (isFlexible(left.type) || isFlexible(right.type)) {
          resultType = UNKNOWN;
        } else if (
          op === "/" ||
          left.type.kind === "decimal" ||
          right.type.kind === "decimal"
        ) {
          resultType = DECIMAL;
        } else {
          resultType = INTEGER;
        }
        return { kind: "binary", operator: op, left, right, type: resultType };
      }

      case "FunctionCall": {
        const definition = getFunction(node.name);
        const args = node.args.map(typeExpression);
        if (!definition) {
          error(
            DiagnosticCodes.UNKNOWN_FUNCTION,
            `La función "${node.name}" no existe.`,
            node.range,
            "Solo pueden usarse las funciones registradas en la versión 0.1."
          );
          return {
            kind: "function-call",
            name: node.name,
            args,
            type: UNKNOWN,
          };
        }
        if (
          node.args.length < definition.minArgs ||
          node.args.length > definition.maxArgs
        ) {
          const expected =
            definition.minArgs === definition.maxArgs
              ? `${definition.minArgs}`
              : definition.maxArgs === Number.POSITIVE_INFINITY
                ? `al menos ${definition.minArgs}`
                : `entre ${definition.minArgs} y ${definition.maxArgs}`;
          error(
            DiagnosticCodes.BAD_ARGUMENT_COUNT,
            `La función "${node.name}" espera ${expected} argumento(s), pero recibió ${node.args.length}.`,
            node.range
          );
          return {
            kind: "function-call",
            name: node.name,
            args,
            type: definition.inferReturnType(args.map((a) => a.type)),
          };
        }
        const argError = definition.validateArguments(
          args.map((a) => a.type),
          node.args
        );
        if (argError) {
          error(
            DiagnosticCodes.BAD_ARGUMENT_TYPE,
            `En la función "${node.name}": ${argError}.`,
            node.range
          );
        }
        const typed: TypedExpression = {
          kind: "function-call",
          name: node.name,
          args,
          type: definition.inferReturnType(args.map((a) => a.type)),
        };
        // convertir_fecha needs the raw DSL format at SQL-generation time.
        if (node.name === "convertir_fecha") {
          const format = node.args[1];
          if (format && format.type === "StringLiteral") {
            typed.meta = { dslDateFormat: format.value };
          }
        }
        return typed;
      }

      case "ConditionalExpression": {
        const branches = node.branches.map((branch) => {
          const condition = typeExpression(branch.condition);
          if (
            condition.type.kind !== "boolean" &&
            !isFlexible(condition.type)
          ) {
            error(
              DiagnosticCodes.CONDITION_NOT_BOOLEAN,
              `La condición de la expresión condicional debe ser booleana, pero se obtuvo ${typeName(condition.type)}.`,
              branch.condition.range
            );
          }
          return { condition, result: typeExpression(branch.result) };
        });
        const elseResult = typeExpression(node.elseResult);

        let unified: SemanticType | undefined = branches[0]?.result.type;
        const allResults = [
          ...branches.map((b) => b.result.type),
          elseResult.type,
        ];
        for (let i = 1; i < allResults.length && unified; i++) {
          const next = unifyBranchTypes(unified, allResults[i]);
          if (!next) {
            error(
              DiagnosticCodes.INCOMPATIBLE_BRANCHES,
              `Las ramas de la expresión condicional devuelven tipos incompatibles: ${typeName(unified)} y ${typeName(allResults[i])}.`,
              node.range,
              "Todas las ramas (entonces/sino) deben producir el mismo tipo de valor."
            );
            unified = UNKNOWN;
            break;
          }
          unified = next;
        }
        return {
          kind: "conditional",
          branches,
          elseResult,
          type: unified ?? UNKNOWN,
        };
      }
    }
  };

  // -------------------------------------------------------------------------
  // Plan construction, step by step
  // -------------------------------------------------------------------------

  let root: LogicalPlanNode = {
    type: "Scan",
    connection: program.source.connection,
    schema: program.source.schema,
    table: program.source.table,
    outputSchema: [...columns],
  };

  for (const operation of program.operations) {
    if (operation.type === "Filter") {
      const condition = typeExpression(operation.condition);
      if (condition.type.kind !== "boolean" && !isFlexible(condition.type)) {
        error(
          DiagnosticCodes.FILTER_NOT_BOOLEAN,
          `La expresión de la instrucción "si" debe ser booleana, pero se obtuvo ${aOrUn(condition.type)}.`,
          operation.condition.range
        );
      }
      root = {
        type: "Filter",
        input: root,
        condition,
        outputSchema: [...columns],
      };
    } else {
      // AddColumn
      const existing = findColumn(operation.name);
      if (existing) {
        error(
          DiagnosticCodes.COLUMN_ALREADY_EXISTS,
          `La columna "${operation.name}" ya existe. "agregar columna" solo permite crear columnas nuevas.`,
          operation.nameRange
        );
      }
      const expression = typeExpression(operation.expression);
      if (!existing) {
        columns = [
          ...columns,
          { name: operation.name, type: expression.type, nullable: true },
        ];
      }
      root = {
        type: "AddColumn",
        input: root,
        name: operation.name,
        expression,
        outputSchema: [...columns],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  let outputSchema: LogicalColumn[] = [...columns];
  if (program.selection) {
    const seen = new Set<string>();
    const projected: LogicalColumn[] = [];
    for (const column of program.selection.columns) {
      const found = findColumn(column.name);
      if (!found) {
        error(
          DiagnosticCodes.UNKNOWN_COLUMN,
          `La columna "${column.name}" no existe en el esquema actual.`,
          column.range
        );
        continue;
      }
      if (seen.has(column.name)) {
        error(
          DiagnosticCodes.DUPLICATE_SELECT_COLUMN,
          `La columna "${column.name}" está repetida en "seleccionar".`,
          column.range
        );
        continue;
      }
      seen.add(column.name);
      projected.push(found);
    }
    outputSchema = projected;
    root = {
      type: "Project",
      input: root,
      columns: projected.map((c) => c.name),
      outputSchema: [...projected],
    };
  }

  // Unreferenced parameters are legal but suspicious.
  for (const [name, info] of parameters) {
    if (!info.referenced) {
      warning(
        DiagnosticCodes.UNDECLARED_PARAMETER,
        `El parámetro "${name}" está declarado pero nunca se utiliza.`,
        info.declaration.range
      );
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    return { diagnostics };
  }

  const compiledParameters: CompiledParameter[] = program.parameters.map(
    (decl) => {
      const info = parameters.get(decl.name)!;
      return {
        name: decl.name,
        required: !info.hasDefault,
        defaultValue: info.defaultValue,
        type: info.type,
        index: info.index,
      };
    }
  );

  const plan: LogicalPlan = {
    processName: program.process.name,
    sourceConnection: program.source.connection,
    root,
    output: {
      schema: program.output.schema,
      table: program.output.table,
      mode: "replace",
    },
    parameters: compiledParameters,
    parameterOrder,
    outputSchema,
  };

  return { plan, diagnostics };
}

/** "un número" / "un texto" phrasing for the spec's filter error message. */
function aOrUn(type: SemanticType): string {
  const phrases: Record<string, string> = {
    text: "un texto",
    integer: "un número",
    decimal: "un número",
    date: "una fecha",
    timestamp: "una fecha y hora",
    null: "nulo",
    unknown: "un valor desconocido",
    boolean: "un booleano",
  };
  return phrases[type.kind] ?? typeName(type);
}

function extractLiteral(
  node: ExpressionNode
): { value: string | number | boolean | null; type: SemanticType } | undefined {
  switch (node.type) {
    case "StringLiteral":
      return { value: node.value, type: TEXT };
    case "NumberLiteral":
      return { value: node.value, type: node.isInteger ? INTEGER : DECIMAL };
    case "BooleanLiteral":
      return { value: node.value, type: BOOLEAN };
    case "NullLiteral":
      return { value: null, type: NULL };
    case "UnaryExpression": {
      if (
        (node.operator === "-" || node.operator === "+") &&
        node.operand.type === "NumberLiteral"
      ) {
        const sign = node.operator === "-" ? -1 : 1;
        return {
          value: sign * node.operand.value,
          type: node.operand.isInteger ? INTEGER : DECIMAL,
        };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}
