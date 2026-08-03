/** Source-table schema providers: static JSON and live PGlite introspection. */

import type { PGlite } from "@electric-sql/pglite";
import {
  SemanticType,
  UNKNOWN,
  fromPostgresType,
} from "./semantic-types";

export interface TableColumn {
  name: string;
  type: SemanticType;
  nullable: boolean;
}

export interface TableSchema {
  connection: string;
  schema: string;
  table: string;
  columns: TableColumn[];
  /** Non-fatal notes, e.g. unsupported column types mapped to unknown. */
  warnings: string[];
}

export interface TableRef {
  connection: string;
  schema: string;
  table: string;
}

export interface SchemaProvider {
  getTableSchema(input: TableRef): Promise<TableSchema>;
}

export class SchemaNotFoundError extends Error {
  constructor(ref: TableRef) {
    super(
      `La tabla fuente "${ref.schema}.${ref.table}" no existe en la base de datos.`
    );
    this.name = "SchemaNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// JSON provider (compile without a database connection)
// ---------------------------------------------------------------------------

export interface JsonSchemaDocument {
  connection: string;
  schema: string;
  table: string;
  columns: { name: string; type: string; nullable?: boolean }[];
}

const JSON_TYPE_MAP: Record<string, SemanticType["kind"]> = {
  text: "text",
  integer: "integer",
  decimal: "decimal",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamp",
};

export class JsonSchemaProvider implements SchemaProvider {
  private documents: JsonSchemaDocument[];

  constructor(documents: JsonSchemaDocument[]) {
    this.documents = documents;
  }

  async getTableSchema(input: TableRef): Promise<TableSchema> {
    const doc = this.documents.find(
      (d) =>
        d.connection.toLowerCase() === input.connection &&
        d.schema.toLowerCase() === input.schema &&
        d.table.toLowerCase() === input.table
    );
    if (!doc) throw new SchemaNotFoundError(input);

    const warnings: string[] = [];
    const columns: TableColumn[] = doc.columns.map((c) => {
      const kind = JSON_TYPE_MAP[c.type.toLowerCase()];
      if (!kind) {
        warnings.push(
          `El tipo "${c.type}" de la columna "${c.name}" no está soportado; se tratará como desconocido.`
        );
      }
      return {
        name: c.name.toLowerCase(),
        type: kind ? { kind } : UNKNOWN,
        nullable: c.nullable ?? true,
      };
    });
    return { ...input, columns, warnings };
  }
}

// ---------------------------------------------------------------------------
// PGlite provider (introspects information_schema.columns)
// ---------------------------------------------------------------------------

export class PGliteSchemaProvider implements SchemaProvider {
  private db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  async getTableSchema(input: TableRef): Promise<TableSchema> {
    const res = await this.db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [input.schema, input.table]
    );

    if (res.rows.length === 0) throw new SchemaNotFoundError(input);

    const warnings: string[] = [];
    const columns: TableColumn[] = res.rows.map((row) => {
      const type = fromPostgresType(row.data_type);
      if (!type) {
        warnings.push(
          `El tipo PostgreSQL "${row.data_type}" de la columna "${row.column_name}" no está soportado; se tratará como desconocido.`
        );
      }
      return {
        name: row.column_name.toLowerCase(),
        type: type ?? UNKNOWN,
        nullable: row.is_nullable === "YES",
      };
    });

    return { ...input, columns, warnings };
  }
}
