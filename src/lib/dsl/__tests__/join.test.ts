import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../compile";
import { DiagnosticCodes } from "../diagnostics";
import { execute } from "../executor";
import { PGliteSchemaProvider } from "../schema-provider";
import { analyzeSource, compileSource, mustParse, parseSource } from "./helpers";

/** transacciones (t) LEFT JOIN movimientos (m) with everything selected. */
const JOINED = `proceso conciliar

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = t.id_transaccion
    y m.fecha = t.fecha_transaccion

escribir depurado.conciliado
    modo reemplazar
`;

describe("unir: parser", () => {
  it("parsea tipo, tabla, alias y condición", () => {
    const program = mustParse(JOINED);
    expect(program.joins).toHaveLength(1);
    const join = program.joins[0];
    expect(join.joinType).toBe("left");
    expect(join.schema).toBe("crudo");
    expect(join.table).toBe("movimientos");
    expect(join.alias).toBe("m");
    expect(join.condition.type).toBe("BinaryExpression");
    expect(program.source.alias).toBe("t");
  });

  it("acepta referencias calificadas alias.columna en expresiones", () => {
    const program = mustParse(JOINED);
    const condition = program.joins[0].condition;
    if (condition.type !== "BinaryExpression") throw new Error("binaria");
    const left = condition.left;
    if (left.type !== "BinaryExpression") throw new Error("binaria");
    expect(left.left).toMatchObject({
      type: "ColumnReference",
      qualifier: "m",
      name: "id_transaccion",
    });
  });

  it("exige el tipo de unión", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

unir banco.crudo.movimientos como m
    en m.id_transaccion = id_transaccion

escribir depurado.salida
    modo reemplazar
`);
    const diag = diagnostics.find(
      (d) => d.code === DiagnosticCodes.MISSING_TOKEN
    );
    expect(diag?.message).toContain("tipo de unión");
  });

  it("exige el alias con como", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

unir izquierda banco.crudo.movimientos
    en id_transaccion = id_transaccion

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some(
        (d) =>
          d.code === DiagnosticCodes.MISSING_TOKEN &&
          d.message.includes('"como <alias>"')
      )
    ).toBe(true);
  });

  it("exige la condición en", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

unir izquierda banco.crudo.movimientos como m

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some(
        (d) =>
          d.code === DiagnosticCodes.MISSING_TOKEN &&
          d.message.includes('condición "en"')
      )
    ).toBe(true);
  });

  it("rechaza unir después de transformaciones", () => {
    const { diagnostics } = parseSource(`proceso p

desde banco.crudo.transacciones

agregar columna x =
    1

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = id_transaccion

escribir depurado.salida
    modo reemplazar
`);
    expect(
      diagnostics.some(
        (d) => d.code === DiagnosticCodes.INVALID_PROGRAM_ORDER
      )
    ).toBe(true);
  });

  it("seleccionar admite alias.columna como nombre_salida", () => {
    const program = mustParse(`proceso p

desde banco.crudo.transacciones como t

seleccionar
    t.cuenta como cuenta_origen,
    monto

escribir depurado.salida
    modo reemplazar
`);
    expect(program.selection?.columns[0]).toMatchObject({
      column: { qualifier: "t", name: "cuenta" },
      alias: "cuenta_origen",
    });
    expect(program.selection?.columns[1].alias).toBeUndefined();
  });
});

describe("unir: análisis semántico", () => {
  it("las columnas en conflicto se aplanan como alias_columna", async () => {
    const result = await analyzeSource(JOINED);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const names = result.plan!.outputSchema.map((c) => c.name);
    // id_transaccion y monto existen en ambas tablas → prefijadas.
    expect(names).toContain("t_id_transaccion");
    expect(names).toContain("m_id_transaccion");
    expect(names).toContain("t_monto");
    expect(names).toContain("m_monto");
    // Las columnas únicas conservan su nombre.
    expect(names).toContain("cuenta");
    expect(names).toContain("referencia");
  });

  it("una referencia sin calificar a una columna ambigua es error", async () => {
    const result = await analyzeSource(`proceso p

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = t.id_transaccion

agregar columna copia =
    monto

escribir depurado.salida
    modo reemplazar
`);
    const diag = result.diagnostics.find(
      (d) => d.code === DiagnosticCodes.AMBIGUOUS_COLUMN
    );
    expect(diag?.message).toContain('"monto" es ambigua');
  });

  it("un alias desconocido es error", async () => {
    const result = await analyzeSource(`proceso p

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en x.id_transaccion = t.id_transaccion

escribir depurado.salida
    modo reemplazar
`);
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.UNKNOWN_ALIAS
      )
    ).toBe(true);
  });

  it("un alias repetido es error", async () => {
    const result = await analyzeSource(`proceso p

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como t
    en id_transaccion = id_transaccion

escribir depurado.salida
    modo reemplazar
`);
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.DUPLICATE_ALIAS
      )
    ).toBe(true);
  });

  it("la condición en debe ser booleana", async () => {
    const result = await analyzeSource(`proceso p

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.monto + t.monto

escribir depurado.salida
    modo reemplazar
`);
    expect(
      result.diagnostics.some(
        (d) => d.code === DiagnosticCodes.JOIN_NOT_BOOLEAN
      )
    ).toBe(true);
  });

  it("un join externo vuelve anulables las columnas del lado no preservado", async () => {
    const result = await analyzeSource(JOINED);
    const referencia = result.plan!.outputSchema.find(
      (c) => c.name === "referencia"
    );
    expect(referencia?.nullable).toBe(true);
    const mId = result.plan!.outputSchema.find(
      (c) => c.name === "m_id_transaccion"
    );
    expect(mId?.nullable).toBe(true); // NOT NULL en la tabla, anulable tras LEFT JOIN
  });

  it("seleccionar con como renombra la salida", async () => {
    const result = await analyzeSource(`proceso p

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = t.id_transaccion

seleccionar
    t.id_transaccion como id_transaccion,
    m.monto como monto_movimiento,
    referencia

escribir depurado.salida
    modo reemplazar
`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.plan!.outputSchema.map((c) => c.name)).toEqual([
      "id_transaccion",
      "monto_movimiento",
      "referencia",
    ]);
  });
});

describe("unir: SQL generado", () => {
  it("emite el CTE del join con ON calificado y columnas aplanadas", async () => {
    const output = await compileSource(JOINED);
    expect(output.ok).toBe(true);
    const sql = output.sql!.statements.find(
      (s) => s.kind === "create-target"
    )!.sql;
    expect(sql).toContain('LEFT JOIN "crudo"."movimientos" AS "m"');
    expect(sql).toContain('paso_0."id_transaccion" AS "t_id_transaccion"');
    expect(sql).toContain('"m"."id_transaccion" AS "m_id_transaccion"');
    expect(sql).toContain(
      'ON (("m"."id_transaccion" = paso_0."id_transaccion") AND ("m"."fecha" = paso_0."fecha_transaccion"))'
    );
  });

  it("el artefacto declara los joins y la versión 0.2", async () => {
    const output = await compileSource(JOINED);
    expect(output.artifact!.dslVersion).toBe("0.2.0");
    expect(output.artifact!.joins).toEqual([
      {
        schema: "crudo",
        table: "movimientos",
        alias: "m",
        joinType: "left",
      },
    ]);
  });
});

describe("unir: ejecución en PGlite", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS crudo;
      CREATE TABLE crudo.sistema (
        user_id TEXT,
        transaction_date DATE,
        monto_sistema NUMERIC
      );
      CREATE TABLE crudo.banco (
        user_id TEXT,
        date DATE,
        monto_banco NUMERIC
      );
      INSERT INTO crudo.sistema VALUES
        ('1001', DATE '2026-01-10', 100.00),
        ('1002', DATE '2026-01-11', 250.50),
        ('1003', DATE '2026-01-12', 75.25);
      INSERT INTO crudo.banco VALUES
        ('1001', DATE '2026-01-10', 100.00),
        ('1002', DATE '2026-01-11', 249.50);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("LEFT JOIN + clasificación de conciliación de punta a punta", async () => {
    const output = await compile(
      `proceso conciliar

desde banco.crudo.sistema como s

unir izquierda banco.crudo.banco como b
    en b.user_id = s.user_id
    y b.date = s.transaction_date

agregar columna diferencia =
    monto_sistema - coalescer(monto_banco, 0)

agregar columna estado =
    si es_nulo(monto_banco) entonces "FALTANTE_EN_BANCO"
    sino si diferencia = 0 entonces "CONCILIADO"
    sino "DESCUADRE"
    fin

seleccionar
    s.user_id como user_id,
    monto_sistema,
    monto_banco,
    estado

escribir depurado.conciliacion
    modo reemplazar
`,
      new PGliteSchemaProvider(db)
    );
    expect(
      output.diagnostics.filter((d) => d.severity === "error")
    ).toEqual([]);
    const result = await execute(db, output.plan!, {});
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3);

    const rows = await db.query<{ user_id: string; estado: string }>(
      "SELECT user_id, estado FROM depurado.conciliacion ORDER BY user_id"
    );
    expect(rows.rows).toEqual([
      { user_id: "1001", estado: "CONCILIADO" },
      { user_id: "1002", estado: "DESCUADRE" },
      { user_id: "1003", estado: "FALTANTE_EN_BANCO" },
    ]);
  });

  it("unir interna descarta filas sin correspondencia", async () => {
    const output = await compile(
      `proceso interseccion

desde banco.crudo.sistema como s

unir interna banco.crudo.banco como b
    en b.user_id = s.user_id

escribir depurado.interseccion
    modo reemplazar
`,
      new PGliteSchemaProvider(db)
    );
    expect(
      output.diagnostics.filter((d) => d.severity === "error")
    ).toEqual([]);
    const result = await execute(db, output.plan!, {});
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(2);
  });

  it("reporta la tabla del unir cuando no existe", async () => {
    const output = await compile(
      `proceso p

desde banco.crudo.sistema como s

unir izquierda banco.crudo.no_existe como b
    en b.user_id = s.user_id

escribir depurado.salida
    modo reemplazar
`,
      new PGliteSchemaProvider(db)
    );
    expect(output.ok).toBe(false);
    expect(
      output.diagnostics.some(
        (d) =>
          d.code === DiagnosticCodes.SOURCE_TABLE_NOT_FOUND &&
          d.message.includes("no_existe")
      )
    ).toBe(true);
  });
});
