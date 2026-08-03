import { describe, expect, it } from "vitest";
import { DiagnosticCodes } from "../diagnostics";
import { analyzeSource, wrapExpression } from "./helpers";

const HEADER = `proceso p

desde banco.crudo.transacciones
`;
const FOOTER = `
escribir depurado.salida
    modo reemplazar
`;

function programWith(body: string, params = ""): string {
  return `proceso p\n${params}\ndesde banco.crudo.transacciones\n${body}${FOOTER}`;
}

describe("analizador semántico", () => {
  it("acepta columnas de la fuente", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna copia =\n    cuenta\n`)
    );
    expect(result.plan).toBeDefined();
    expect(result.plan!.outputSchema.at(-1)).toMatchObject({
      name: "copia",
      type: { kind: "text" },
    });
  });

  it("rechaza columnas inexistentes", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna x =\n    columna_fantasma\n`)
    );
    const diag = result.diagnostics.find(
      (d) => d.code === DiagnosticCodes.UNKNOWN_COLUMN
    );
    expect(diag?.message).toBe(
      'La columna "columna_fantasma" no existe en este punto del proceso.'
    );
  });

  it("permite usar columnas creadas en pasos anteriores", async () => {
    const result = await analyzeSource(
      programWith(
        `\nagregar columna monto_convertido =\n    convertir_decimal(monto_original)\n\nagregar columna monto_normalizado =\n    redondear(absoluto(monto_convertido), 2)\n`
      )
    );
    expect(result.plan).toBeDefined();
  });

  it("rechaza referencias a columnas futuras", async () => {
    const result = await analyzeSource(
      programWith(
        `\nagregar columna monto_normalizado =\n    redondear(absoluto(monto_convertido), 2)\n\nagregar columna monto_convertido =\n    convertir_decimal(monto_original)\n`
      )
    );
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === DiagnosticCodes.UNKNOWN_COLUMN &&
          d.message.includes("monto_convertido")
      )
    ).toBe(true);
  });

  it("rechaza sobrescribir una columna fuente", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna monto =\n    absoluto(monto)\n`)
    );
    const diag = result.diagnostics.find(
      (d) => d.code === DiagnosticCodes.COLUMN_ALREADY_EXISTS
    );
    expect(diag?.message).toBe(
      'La columna "monto" ya existe. "agregar columna" solo permite crear columnas nuevas.'
    );
  });

  it("rechaza columnas agregadas duplicadas", async () => {
    const result = await analyzeSource(
      programWith(
        `\nagregar columna nueva =\n    1\n\nagregar columna nueva =\n    2\n`
      )
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.COLUMN_ALREADY_EXISTS
      )
    ).toBe(true);
  });

  it("rechaza parámetros no declarados", async () => {
    const result = await analyzeSource(
      programWith(`\nsi fecha_transaccion >= $fecha_inicio\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.UNDECLARED_PARAMETER
      )
    ).toBe(true);
  });

  it("rechaza parámetros duplicados", async () => {
    const result = await analyzeSource(
      programWith(`\nsi monto > 0\n`, "\nparametro a\nparametro a\n")
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.DUPLICATE_PARAMETER
      )
    ).toBe(true);
  });

  it("rechaza funciones inexistentes", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna x =\n    piso(monto)\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.UNKNOWN_FUNCTION
      )
    ).toBe(true);
  });

  it("valida la cantidad de argumentos", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna x =\n    redondear(monto)\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.BAD_ARGUMENT_COUNT
      )
    ).toBe(true);
  });

  it("rechaza tipos de argumento incompatibles", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna x =\n    absoluto(estado)\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.BAD_ARGUMENT_TYPE
      )
    ).toBe(true);
  });

  it("rechaza monto + estado (decimal + texto)", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna x =\n    monto + estado\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.INCOMPATIBLE_OPERANDS
      )
    ).toBe(true);
  });

  it("rechaza filtros no booleanos con el mensaje de la especificación", async () => {
    const result = await analyzeSource(programWith(`\nsi monto + 10\n`));
    const diag = result.diagnostics.find(
      (d) => d.code === DiagnosticCodes.FILTER_NOT_BOOLEAN
    );
    expect(diag?.message).toBe(
      'La expresión de la instrucción "si" debe ser booleana, pero se obtuvo un número.'
    );
  });

  it("no bloquea comparaciones contra parámetros desconocidos", async () => {
    const result = await analyzeSource(
      programWith(
        `\nsi fecha_transaccion >= $fecha_inicio\n`,
        "\nparametro fecha_inicio\n"
      )
    );
    expect(result.plan).toBeDefined();
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      []
    );
  });

  it("permite comparar fecha con texto (coerción documentada)", async () => {
    const result = await analyzeSource(
      programWith(
        `\nsi fecha_transaccion >= $fecha_inicio\n`,
        '\nparametro fecha_inicio = "2026-01-01"\n'
      )
    );
    expect(result.plan).toBeDefined();
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      []
    );
  });

  it("rechaza ramas condicionales incompatibles", async () => {
    const result = await analyzeSource(
      programWith(
        `\nagregar columna x =\n    si monto > 0 entonces "POSITIVO"\n    sino 0\n    fin\n`
      )
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.INCOMPATIBLE_BRANCHES
      )
    ).toBe(true);
  });

  it("rechaza seleccionar columnas inexistentes", async () => {
    const result = await analyzeSource(
      programWith(`\nseleccionar id_transaccion, columna_inexistente\n`)
    );
    const diag = result.diagnostics.find(
      (d) => d.code === DiagnosticCodes.UNKNOWN_COLUMN
    );
    expect(diag?.message).toBe(
      'La columna "columna_inexistente" no existe en el esquema actual.'
    );
  });

  it("rechaza columnas repetidas en seleccionar", async () => {
    const result = await analyzeSource(
      programWith(`\nseleccionar cuenta, cuenta\n`)
    );
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.DUPLICATE_SELECT_COLUMN
      )
    ).toBe(true);
  });

  it("sin seleccionar, la salida contiene fuente + agregadas en orden", async () => {
    const result = await analyzeSource(
      programWith(`\nagregar columna extra =\n    1\n`)
    );
    expect(result.plan!.outputSchema.map((c) => c.name)).toEqual([
      "id_transaccion",
      "cuenta",
      "monto",
      "monto_original",
      "impuesto",
      "estado",
      "fecha_transaccion",
      "extra",
    ]);
  });

  it("valida el formato de convertir_fecha", async () => {
    const bad = await analyzeSource(
      programWith(
        `\nagregar columna f =\n    convertir_fecha(monto_original, "MM-dd-yyyy")\n`
      )
    );
    expect(
      bad.diagnostics.some((d) => d.code === DiagnosticCodes.BAD_ARGUMENT_TYPE)
    ).toBe(true);

    const good = await analyzeSource(
      programWith(
        `\nagregar columna f =\n    convertir_fecha(monto_original, "yyyy-MM-dd")\n`
      )
    );
    expect(good.plan).toBeDefined();
  });

  it("asigna posiciones de parámetros y reutiliza referencias repetidas", async () => {
    const result = await analyzeSource(
      programWith(
        `\nsi fecha_transaccion >= $fecha_inicio o fecha_transaccion >= $fecha_inicio\nsi estado = $estado\n`,
        "\nparametro fecha_inicio\nparametro estado = \"ACTIVO\"\n"
      )
    );
    expect(result.plan!.parameterOrder).toEqual(["fecha_inicio", "estado"]);
    const params = result.plan!.parameters;
    expect(params.find((p) => p.name === "fecha_inicio")!.index).toBe(1);
    expect(params.find((p) => p.name === "estado")!.index).toBe(2);
  });
});

// wrapExpression se usa en parser.test.ts; referenciado aquí para claridad.
void wrapExpression;
void HEADER;
