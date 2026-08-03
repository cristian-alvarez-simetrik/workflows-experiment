import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "../compile";
import { execute } from "../executor";
import { PGliteSchemaProvider } from "../schema-provider";
import { SEED_SQL } from "../examples";

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create(); // in-memory
  await db.exec(SEED_SQL);
});

afterAll(async () => {
  await db.close();
});

async function compileAndRun(
  source: string,
  params: Record<string, string> = {}
) {
  const output = await compile(source, new PGliteSchemaProvider(db));
  if (!output.ok) {
    throw new Error(
      output.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" | ")
    );
  }
  return execute(db, output.plan!, params);
}

describe("ejecutor PGlite", () => {
  it("crea la tabla destino con las transformaciones aplicadas", async () => {
    const result = await compileAndRun(`proceso normalizar

desde banco.crudo.transacciones

si estado = "ACTIVO"

agregar columna cuenta_normalizada =
    mayusculas(recortar(cuenta))

agregar columna monto_decimal =
    convertir_decimal(monto_original)

seleccionar
    id_transaccion,
    cuenta_normalizada,
    monto_decimal

escribir depurado.transacciones
    modo reemplazar
`);
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(6); // 6 filas ACTIVO en el seed

    const rows = await db.query<{
      id_transaccion: number;
      cuenta_normalizada: string;
    }>(
      `SELECT id_transaccion, cuenta_normalizada
         FROM depurado.transacciones ORDER BY id_transaccion`
    );
    expect(rows.rows[0].cuenta_normalizada).toBe("ACH-001");
  });

  it("enlaza parámetros y aplica valores predeterminados", async () => {
    const result = await compileAndRun(
      `proceso por_fecha

parametro fecha_inicio
parametro estado = "ACTIVO"

desde banco.crudo.transacciones

si fecha_transaccion >= $fecha_inicio
si estado = $estado

escribir depurado.periodo
    modo reemplazar
`,
      { fecha_inicio: "2026-03-01" }
    );
    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3); // ids 3, 4, 6
    expect(result.resolvedParameters).toEqual({
      fecha_inicio: "2026-03-01",
      estado: "ACTIVO",
    });
  });

  it("falla antes de tocar la base cuando falta un parámetro obligatorio", async () => {
    const result = await compileAndRun(`proceso falta_parametro

parametro fecha_inicio

desde banco.crudo.transacciones

si fecha_transaccion >= $fecha_inicio

escribir depurado.no_debe_existir
    modo reemplazar
`);
    expect(result.success).toBe(false);
    expect(result.error).toContain("fecha_inicio");
    const tables = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'depurado' AND table_name = 'no_debe_existir'`
    );
    expect(tables.rows).toHaveLength(0);
  });

  it("hace rollback cuando una conversión falla y no deja tablas parciales", async () => {
    // cuenta ("ach-001") no es convertible a número → CAST aborta.
    const result = await compileAndRun(`proceso conversion_invalida

desde banco.crudo.transacciones

agregar columna imposible =
    convertir_decimal(cuenta)

escribir depurado.rota
    modo reemplazar
`);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    const tables = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'depurado' AND table_name = 'rota'`
    );
    expect(tables.rows).toHaveLength(0);
  });

  it("reemplaza la tabla destino en ejecuciones sucesivas", async () => {
    const source = `proceso reemplazo

desde banco.crudo.transacciones

escribir depurado.copia
    modo reemplazar
`;
    const first = await compileAndRun(source);
    const second = await compileAndRun(source);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.rowCount).toBe(8);
  });
});
