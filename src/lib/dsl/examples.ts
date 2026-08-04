/** Example DSL programs and the seed data used by the playground. */

export interface DslExample {
  id: string;
  title: string;
  description: string;
  source: string;
}

export const EXAMPLES: DslExample[] = [
  {
    id: "normalizar-transacciones",
    title: "Normalizar transacciones",
    description:
      "Ejemplo completo: parámetros, filtros, columnas derivadas, condicional y selección.",
    source: `proceso normalizar_transacciones

parametro fecha_inicio = "2026-01-01"
parametro fecha_fin = "2026-12-31"
parametro sistema_origen = "BANCO"

desde banco.crudo.transacciones

si fecha_transaccion >= $fecha_inicio
si fecha_transaccion < $fecha_fin
si estado = "ACTIVO"

agregar columna cuenta_normalizada =
    mayusculas(recortar(cuenta))

agregar columna monto_convertido =
    convertir_decimal(monto_original)

agregar columna monto_normalizado =
    redondear(absoluto(monto_convertido), 2)

agregar columna tipo_transaccion =
    si monto_convertido > 0 entonces "CREDITO"
    sino si monto_convertido < 0 entonces "DEBITO"
    sino "CERO"
    fin

agregar columna es_monto_alto =
    monto_normalizado >= 10000

agregar columna sistema =
    $sistema_origen

agregar columna fecha_carga =
    fecha_actual()

seleccionar
    id_transaccion,
    cuenta_normalizada,
    monto_normalizado,
    tipo_transaccion,
    es_monto_alto,
    fecha_transaccion,
    sistema,
    fecha_carga

escribir depurado.transacciones
    modo reemplazar
`,
  },
  {
    id: "filtrar-por-fecha",
    title: "Filtrar por fecha",
    description: "Parámetros obligatorios usados como filtros enlazados.",
    source: `proceso transacciones_por_fecha

parametro fecha_inicio
parametro fecha_fin

desde banco.crudo.transacciones

si fecha_transaccion >= $fecha_inicio
si fecha_transaccion < $fecha_fin

escribir depurado.transacciones_periodo
    modo reemplazar
`,
  },
  {
    id: "clasificar-montos",
    title: "Clasificar montos",
    description: "Expresión condicional con varias ramas que genera un CASE.",
    source: `proceso clasificar_monto

desde banco.crudo.transacciones

agregar columna monto_decimal =
    convertir_decimal(monto_original)

agregar columna nivel =
    si monto_decimal >= 10000 entonces "ALTO"
    sino si monto_decimal >= 1000 entonces "MEDIO"
    sino "BAJO"
    fin

escribir depurado.transacciones_clasificadas
    modo reemplazar
`,
  },
  {
    id: "unir-tablas",
    title: "Unir tablas (join)",
    description:
      "LEFT JOIN entre dos tablas con alias, columnas calificadas y renombre en seleccionar.",
    source: `proceso enriquecer_transacciones

desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = t.id_transaccion

agregar columna monto_conciliado =
    coalescer(m.monto, 0)

seleccionar
    t.id_transaccion como id_transaccion,
    cuenta,
    monto_original,
    monto_conciliado,
    referencia

escribir depurado.transacciones_enriquecidas
    modo reemplazar
`,
  },
  {
    id: "error-operador",
    title: "Error: operador ==",
    description: "Demuestra el diagnóstico DSL105 con sugerencia.",
    source: `proceso ejemplo

desde banco.crudo.transacciones

si estado == "ACTIVO"

escribir depurado.transacciones_activas
    modo reemplazar
`,
  },
];

/** Seed for the playground: crudo.transacciones with a few sample rows. */
export const SEED_SQL = `
CREATE SCHEMA IF NOT EXISTS crudo;
DROP TABLE IF EXISTS crudo.transacciones;
CREATE TABLE crudo.transacciones (
  id_transaccion INTEGER NOT NULL,
  cuenta TEXT,
  monto_original TEXT,
  estado TEXT,
  fecha_transaccion DATE
);
INSERT INTO crudo.transacciones VALUES
  (1, '  ach-001 ', '1250.50',  'ACTIVO',    DATE '2026-01-15'),
  (2, 'ACH-002',    '-89.99',   'ACTIVO',    DATE '2026-02-03'),
  (3, ' visa-9 ',   '15000',    'ACTIVO',    DATE '2026-03-21'),
  (4, 'MC-77',      '0',        'ACTIVO',    DATE '2026-04-11'),
  (5, 'ach-010',    '532.10',   'PENDIENTE', DATE '2026-05-30'),
  (6, 'AMEX-3',     '-12000',   'ACTIVO',    DATE '2026-06-18'),
  (7, 'visa-12',    '75.25',    'CANCELADO', DATE '2026-07-02'),
  (8, ' ach-020',   '999.99',   'ACTIVO',    DATE '2025-12-30');
DROP TABLE IF EXISTS crudo.movimientos;
CREATE TABLE crudo.movimientos (
  id_transaccion INTEGER NOT NULL,
  monto NUMERIC,
  referencia TEXT,
  fecha DATE
);
INSERT INTO crudo.movimientos VALUES
  (1, 1250.50, 'MOV-A1', DATE '2026-01-15'),
  (2, -89.99,  'MOV-B4', DATE '2026-02-03'),
  (3, 14990,   'MOV-C9', DATE '2026-03-22'),
  (6, -12000,  'MOV-F2', DATE '2026-06-18');
`;

export const SEED_TABLE = { schema: "crudo", table: "transacciones" };
