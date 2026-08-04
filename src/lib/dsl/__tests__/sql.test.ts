import { describe, expect, it } from "vitest";
import { compileSource } from "./helpers";

function programWith(body: string, params = ""): string {
  return `proceso p\n${params}\ndesde banco.crudo.transacciones\n${body}
escribir depurado.salida
    modo reemplazar
`;
}

async function createSql(source: string): Promise<string> {
  const output = await compileSource(source);
  if (!output.ok) {
    throw new Error(
      output.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" | ")
    );
  }
  return output.sql!.statements.find((s) => s.kind === "create-target")!.sql;
}

describe("generación SQL", () => {
  it("genera DROP y CREATE por separado", async () => {
    const output = await compileSource(programWith(""));
    expect(output.sql!.statements.map((s) => s.kind)).toEqual([
      "drop-target",
      "create-target",
    ]);
    expect(output.sql!.statements[0].sql).toBe(
      'DROP TABLE IF EXISTS "depurado"."salida";'
    );
  });

  it("lee la tabla fuente sin la conexión en el SQL", async () => {
    const sql = await createSql(programWith(""));
    expect(sql).toContain('FROM "crudo"."transacciones"');
    expect(sql).not.toContain("banco");
  });

  it("cada paso genera un CTE determinista", async () => {
    const sql = await createSql(
      programWith(`\nsi estado = "ACTIVO"\n\nagregar columna copia =\n    cuenta\n`)
    );
    expect(sql).toContain("paso_0 AS (");
    expect(sql).toContain("paso_1 AS (");
    expect(sql).toContain("paso_2 AS (");
    expect(sql).toContain("FROM paso_2");
  });

  it("los filtros se convierten en WHERE", async () => {
    const sql = await createSql(
      programWith(`\nsi monto > 0 y estado = "ACTIVO"\n`)
    );
    expect(sql).toContain(`WHERE (("monto" > 0) AND ("estado" = 'ACTIVO'))`);
  });

  it("las funciones de texto anidadas emiten UPPER(TRIM(...))", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna cuenta_normalizada =\n    mayusculas(recortar(cuenta))\n`
      )
    );
    expect(sql).toContain(`UPPER(TRIM("cuenta")) AS "cuenta_normalizada"`);
  });

  it("dividir emite SPLIT_PART", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna parte =\n    dividir(cuenta, "-", 2)\n`
      )
    );
    expect(sql).toContain(`SPLIT_PART("cuenta", '-', 2) AS "parte"`);
  });

  it("redondear fuerza NUMERIC para ROUND con escala", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna x =\n    redondear(absoluto(monto), 2)\n`
      )
    );
    expect(sql).toContain(`ROUND(CAST(ABS("monto") AS NUMERIC), 2) AS "x"`);
  });

  it("las conversiones emiten CAST", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna x =\n    convertir_decimal(monto_original)\n`
      )
    );
    expect(sql).toContain(`CAST("monto_original" AS NUMERIC) AS "x"`);
  });

  it("convertir_fecha traduce el formato DSL a PostgreSQL", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna f =\n    convertir_fecha(monto_original, "dd/MM/yyyy")\n`
      )
    );
    expect(sql).toContain(`TO_DATE("monto_original", 'DD/MM/YYYY')`);
  });

  it("los condicionales emiten CASE/WHEN/ELSE/END", async () => {
    const sql = await createSql(
      programWith(
        `\nagregar columna nivel =\n    si monto >= 10000 entonces "ALTO"\n    sino si monto >= 1000 entonces "MEDIO"\n    sino "BAJO"\n    fin\n`
      )
    );
    expect(sql).toContain(
      `CASE WHEN ("monto" >= 10000) THEN 'ALTO' WHEN ("monto" >= 1000) THEN 'MEDIO' ELSE 'BAJO' END`
    );
  });

  it("los parámetros se emiten como placeholders enlazados", async () => {
    const sql = await createSql(
      programWith(
        `\nsi fecha_transaccion >= $fecha_inicio\nsi estado = $estado\n`,
        '\nparametro fecha_inicio\nparametro estado = "ACTIVO"\n'
      )
    );
    expect(sql).toContain(`"fecha_transaccion" >= $1`);
    expect(sql).toContain(`"estado" = $2`);
  });

  it("las referencias repetidas al mismo parámetro reutilizan la posición", async () => {
    const sql = await createSql(
      programWith(
        `\nsi fecha_transaccion >= $f o fecha_transaccion <= $f\n`,
        "\nparametro f\n"
      )
    );
    expect(sql.match(/\$1/g)?.length).toBe(2);
    expect(sql).not.toContain("$2");
  });

  it("seleccionar define columnas y orden", async () => {
    const sql = await createSql(
      programWith(`\nseleccionar cuenta, id_transaccion\n`)
    );
    expect(sql).toMatch(/"cuenta",\n\s+"id_transaccion"/);
  });

  it("escapa comillas simples en literales de texto", async () => {
    const sql = await createSql(
      programWith(`\nsi estado = "O'BRIEN"\n`)
    );
    expect(sql).toContain(`'O''BRIEN'`);
  });

  it("el SQL es determinista", async () => {
    const source = programWith(
      `\nsi estado = "ACTIVO"\n\nagregar columna x =\n    monto + impuesto\n`
    );
    const first = await createSql(source);
    const second = await createSql(source);
    expect(first).toBe(second);
  });

  it("el artefacto incluye orden de parámetros, defaults y hash", async () => {
    const output = await compileSource(
      programWith(
        `\nsi estado = $estado\nsi fecha_transaccion >= $fecha_inicio\n`,
        '\nparametro fecha_inicio\nparametro estado = "ACTIVO"\n'
      )
    );
    expect(output.ok).toBe(true);
    const artifact = output.artifact!;
    expect(artifact.parameterOrder).toEqual(["estado", "fecha_inicio"]);
    expect(artifact.parameterDefaults).toEqual({ estado: "ACTIVO" });
    expect(artifact.parameters).toEqual([
      { name: "fecha_inicio", required: true },
      { name: "estado", required: false, defaultValue: "ACTIVO" },
    ]);
    expect(artifact.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.target).toMatchObject({
      schema: "depurado",
      table: "salida",
      mode: "replace",
    });
  });
});
