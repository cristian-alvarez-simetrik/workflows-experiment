# Compilador DSL de transformaciones ETL → SQL (v0.2)

Compilador en TypeScript que corre 100 % en el navegador. Pipeline:

```
fuente DSL → lexer → parser (descendente + Pratt) → AST
           → análisis semántico → plan lógico → SQL PostgreSQL
           → ejecutor transaccional sobre PGlite
```

Playground: ruta `#/dsl` de la app (React Router). Los ejemplos y datos de
muestra viven en `examples.ts`.

## Módulos

| Archivo | Rol |
| --- | --- |
| `diagnostics.ts` | Diagnósticos estructurados (código, rango, hint) + formateador CLI |
| `lexer.ts` | Tokens con posición; detecta `==`, `<>`, cadenas sin cerrar |
| `ast.ts` | AST independiente de SQL, con `SourceRange` en cada nodo |
| `parser.ts` | Parser de instrucciones + Pratt para expresiones |
| `semantic-types.ts` | Sistema interno de tipos y reglas de compatibilidad |
| `functions.ts` | Registro central de funciones (arity, tipos, emisión SQL) |
| `analyzer.ts` | Validación semántica y construcción del plan lógico |
| `plan.ts` | Plan lógico tipado (Scan/Join/Filter/AddColumn/Project) |
| `sql-dialect.ts` | Interfaz de dialecto (preparada para Redshift/Snowflake/BigQuery) |
| `postgres-dialect.ts` | Dialecto PostgreSQL |
| `sql-compiler.ts` | Un CTE determinista por paso (`paso_0`, `paso_1`, …) |
| `artifact.ts` | Artefacto compilado JSON + hash SHA-256 de la fuente normalizada |
| `schema-provider.ts` | Proveedores de esquema: JSON estático y PGlite (`information_schema`) |
| `executor.ts` | Ejecutor transaccional (BEGIN → DROP → CREATE AS → COMMIT/ROLLBACK) |

Pruebas: `__tests__/` (vitest, `npm test`). Cubren lexer, parser,
precedencia, semántica, SQL generado y ejecución real contra PGlite en
memoria (incluido rollback por conversión inválida).

## Decisiones técnicas

1. **Precedencia de `no`** — La especificación se contradice (§15.3 vs §19.2).
   Se sigue §19.2: `o < y < no < comparaciones`, de modo que
   `no estado = "X"` niega la comparación completa, como en el ejemplo de §10.
2. **Posición de parámetros** — `$n` se asigna por orden de primera
   referencia; referencias repetidas reutilizan la posición. Los parámetros
   declarados pero no usados no ocupan posición (evita el error de PostgreSQL
   "bind message supplies N parameters") y generan una advertencia.
3. **Parámetros en PGlite** — PostgreSQL no admite parámetros enlazados en
   sentencias utilitarias (`CREATE TABLE AS`). El artefacto compilado conserva
   los placeholders `$n`; el ejecutor del navegador re-emite el SQL con un
   dialecto que sustituye cada parámetro por un literal escapado por el emisor
   tipado (nunca concatenación cruda).
4. **Coerción fecha × texto** — Comparar `date`/`timestamp` con `text` es
   válido: el DSL no tiene literales de fecha, así que "2026-01-01" llega como
   texto y PostgreSQL lo coerciona contextualmente. Cualquier otra mezcla de
   tipos en comparaciones sigue siendo error.
5. **Valores predeterminados de parámetros** — Deben ser literales
   (texto, número, booleano, nulo, con signo unario opcional).
6. **`convertir_fecha`** — El formato debe ser un literal de texto de la lista
   soportada (`yyyy-MM-dd`, `dd/MM/yyyy`, `yyyyMMdd`); se traduce por dialecto.
7. **Coma final** — `seleccionar` permite una coma final opcional.
8. **Límites de instrucción por líneas** — Un token en la columna 1 inicia una
   instrucción; las continuaciones deben ir indentadas (§5.1). Una continuación
   sin indentar produce `DSL208` (falta expresión) más el error de instrucción
   desconocida correspondiente.
9. **`CREATE SCHEMA IF NOT EXISTS`** — El ejecutor lo emite dentro de la
   transacción antes del `DROP`, porque el esquema destino puede no existir en
   una base recién creada. No forma parte del artefacto.
10. **Sin CLI / Node** — Adaptación al navegador solicitada: no hay CLI ni
    ejecutor `pg`; el equivalente de `validar` / `compilar` / `ejecutar` son
    los botones del playground. `JsonSchemaProvider` cubre la compilación sin
    base de datos.

## Joins (`unir`, v0.2)

```
desde banco.crudo.transacciones como t

unir izquierda banco.crudo.movimientos como m
    en m.id_transaccion = t.id_transaccion
    y m.fecha = t.fecha_transaccion
```

- Tipos: `interna`, `izquierda`, `derecha`, `completa` (obligatorio); el alias
  (`como`) también es obligatorio en `unir` y opcional en `desde` (por defecto,
  el nombre de la tabla).
- Las instrucciones `unir` deben ir inmediatamente después de `desde`, antes
  de `si` / `agregar columna` / `seleccionar` (`DSL205` si no).
- En expresiones se admite `alias.columna`. Una columna presente en más de una
  tabla sin calificar produce `DSL316` (ambigua); un alias inexistente,
  `DSL315`; un alias repetido, `DSL317`; una condición `en` no booleana,
  `DSL318`.
- Aplanado tras el join: las columnas con nombre único lo conservan; las que
  chocan pasan a `alias_columna` (p. ej. `t_id_transaccion`). `seleccionar`
  admite `alias.columna como nombre_salida` para renombrar la salida.
- Nulabilidad: los joins externos vuelven anulables las columnas del lado no
  preservado.
- SQL: el join es un CTE `paso_n` más, con lista explícita de columnas y `ON`
  calificado (`paso_{n-1}."col"` / `"alias"."col"`). El artefacto (v0.2)
  declara los joins en un campo `joins`.

## Fuera de alcance (v0.2)

Sin `establecer`, `eliminar`, `renombrar`, `filtrar`, agregaciones,
`group by`, ventanas, `modo anexar`, upsert/merge, SQL embebido ni múltiples
destinos. Las palabras excluidas producen `DSL204` con mensaje de versión.
