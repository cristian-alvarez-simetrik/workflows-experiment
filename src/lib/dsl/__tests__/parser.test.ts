import { describe, expect, it } from "vitest";
import type {
  AddColumnNode,
  BinaryExpressionNode,
  ConditionalExpressionNode,
} from "../ast";
import { DiagnosticCodes } from "../diagnostics";
import { mustParse, parseSource, wrapExpression } from "./helpers";

const MINIMAL = `proceso minimo

desde banco.crudo.transacciones

escribir depurado.salida
    modo reemplazar
`;

describe("parser: programa", () => {
  it("parsea el programa mínimo", () => {
    const program = mustParse(MINIMAL);
    expect(program.process.name).toBe("minimo");
    expect(program.source).toMatchObject({
      connection: "banco",
      schema: "crudo",
      table: "transacciones",
    });
    expect(program.output).toMatchObject({
      schema: "depurado",
      table: "salida",
      mode: "replace",
    });
  });

  it("parsea parámetros con y sin valor predeterminado", () => {
    const program = mustParse(`proceso p

parametro fecha_inicio
parametro sistema = "BANCO"

desde banco.crudo.transacciones

escribir depurado.salida
    modo reemplazar
`);
    expect(program.parameters).toHaveLength(2);
    expect(program.parameters[0].defaultValue).toBeUndefined();
    expect(program.parameters[1].defaultValue).toMatchObject({
      type: "StringLiteral",
      value: "BANCO",
    });
  });

  it("exige tres segmentos en desde", () => {
    const { diagnostics } = parseSource(`proceso p

desde crudo.transacciones

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.INVALID_REFERENCE)
    ).toBe(true);
  });

  it("exige dos segmentos en escribir", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

escribir banco.depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.INVALID_REFERENCE)
    ).toBe(true);
  });

  it("rechaza modo anexar", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

escribir depurado.salida
    modo anexar
`);
    const diag = diagnostics.find(
      (d) => d.code === DiagnosticCodes.UNSUPPORTED_MODE
    );
    expect(diag?.message).toContain("anexar");
    expect(diag?.message).toContain("0.2");
  });

  it("rechaza proceso duplicado", () => {
    const { diagnostics } = parseSource(`proceso a
proceso b

desde banco.crudo.transacciones

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.DUPLICATE_STATEMENT)
    ).toBe(true);
  });

  it("exige que proceso sea la primera instrucción", () => {
    const { diagnostics } = parseSource(`desde banco.crudo.transacciones
proceso tarde

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.INVALID_PROGRAM_ORDER)
    ).toBe(true);
  });

  it("rechaza instrucciones después de escribir", () => {
    const { diagnostics } = parseSource(`${MINIMAL}
si monto > 0
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.INVALID_PROGRAM_ORDER)
    ).toBe(true);
  });

  it("rechaza seleccionar antes de agregar columna", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

seleccionar id_transaccion

agregar columna x =
    1

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.INVALID_PROGRAM_ORDER)
    ).toBe(true);
  });

  it("reporta instrucciones excluidas con mensaje de versión", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

filtrar monto > 0

escribir depurado.salida
    modo reemplazar
`);
    const diag = diagnostics.find(
      (d) => d.code === DiagnosticCodes.UNSUPPORTED_FEATURE
    );
    expect(diag?.message).toContain("filtrar");
    expect(diag?.message).toContain("0.2");
  });

  it("reporta instrucciones desconocidas", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

transformar monto

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.UNKNOWN_STATEMENT)
    ).toBe(true);
  });

  it("exige indentación en líneas de continuación", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

agregar columna monto_normalizado =
redondear(absoluto(monto), 2)

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some((d) => d.code === DiagnosticCodes.MISSING_EXPRESSION)
    ).toBe(true);
  });

  it("acepta coma final opcional en seleccionar", () => {
    const program = mustParse(`proceso p

desde banco.crudo.transacciones

seleccionar
    id_transaccion,
    cuenta,

escribir depurado.salida
    modo reemplazar
`);
    expect(program.selection?.columns.map((c) => c.column.name)).toEqual([
      "id_transaccion",
      "cuenta",
    ]);
  });
});

describe("parser: expresiones", () => {
  function expressionOf(source: string) {
    const program = mustParse(wrapExpression(source));
    const addColumn = program.operations[0] as AddColumnNode;
    return addColumn.expression;
  }

  it("a + b * c respeta la precedencia", () => {
    const expr = expressionOf("monto + impuesto * 2") as BinaryExpressionNode;
    expect(expr.operator).toBe("+");
    expect((expr.right as BinaryExpressionNode).operator).toBe("*");
  });

  it("los paréntesis modifican la precedencia", () => {
    const expr = expressionOf("(monto + impuesto) * 2") as BinaryExpressionNode;
    expect(expr.operator).toBe("*");
    expect((expr.left as BinaryExpressionNode).operator).toBe("+");
  });

  it('a > 0 y b = "X" o c = "Y" agrupa como ((a>0 y b="X") o c="Y")', () => {
    const expr = expressionOf(
      'monto > 0 y estado = "X" o cuenta = "Y"'
    ) as BinaryExpressionNode;
    expect(expr.operator).toBe("o");
    expect((expr.left as BinaryExpressionNode).operator).toBe("y");
  });

  it('"no" niega la comparación completa', () => {
    const expr = expressionOf('no estado = "CANCELADO"');
    expect(expr.type).toBe("UnaryExpression");
    if (expr.type === "UnaryExpression") {
      expect(expr.operator).toBe("no");
      expect((expr.operand as BinaryExpressionNode).operator).toBe("=");
    }
  });

  it("parsea funciones anidadas", () => {
    const expr = expressionOf("mayusculas(recortar(cuenta))");
    expect(expr.type).toBe("FunctionCall");
    if (expr.type === "FunctionCall") {
      expect(expr.name).toBe("mayusculas");
      expect(expr.args[0].type).toBe("FunctionCall");
    }
  });

  it("parsea condicionales con varias ramas", () => {
    const expr = expressionOf(`si monto >= 10000 entonces "ALTO"
    sino si monto >= 1000 entonces "MEDIO"
    sino "BAJO"
    fin`) as ConditionalExpressionNode;
    expect(expr.type).toBe("ConditionalExpression");
    expect(expr.branches).toHaveLength(2);
    expect(expr.elseResult).toMatchObject({
      type: "StringLiteral",
      value: "BAJO",
    });
  });

  it("exige la rama sino", () => {
    const { diagnostics } = parseSource(
      wrapExpression(`si monto > 0 entonces "POS"
    fin`)
    );
    expect(
      diagnostics.some(
        (d) =>
          d.code === DiagnosticCodes.MISSING_TOKEN &&
          d.message.includes("sino")
      )
    ).toBe(true);
  });

  it("parsea referencias a parámetros", () => {
    const expr = expressionOf("$sistema_origen");
    expect(expr).toMatchObject({
      type: "ParameterReference",
      name: "sistema_origen",
    });
  });

  it("el signo negativo es un operador unario", () => {
    const expr = expressionOf("-15");
    expect(expr.type).toBe("UnaryExpression");
  });
});
