"use client";

import type { PGlite } from "@electric-sql/pglite";
import type { QueryResult } from "./types";

let dbPromise: Promise<PGlite> | null = null;

/**
 * Lazily create a single PGlite instance persisted to IndexedDB.
 * Dynamic import keeps the WASM bundle out of the server build.
 */
export function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = import("@electric-sql/pglite").then(({ PGlite }) =>
      PGlite.create("idb://workflow-studio")
    );
  }
  return dbPromise;
}

export async function runQuery(sql: string): Promise<QueryResult> {
  const db = await getDb();
  const start = performance.now();
  const res = await db.query(sql);
  return {
    rows: res.rows as Record<string, unknown>[],
    fields: res.fields,
    affectedRows: res.affectedRows,
    durationMs: performance.now() - start,
  };
}

/** Run multiple statements (no results returned). */
export async function runExec(sql: string): Promise<void> {
  const db = await getDb();
  await db.exec(sql);
}

export async function listTables(): Promise<
  { name: string; rowCount: number }[]
> {
  const db = await getDb();
  const res = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  const tables: { name: string; rowCount: number }[] = [];
  for (const row of res.rows) {
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${row.table_name}"`
    );
    tables.push({ name: row.table_name, rowCount: count.rows[0]?.n ?? 0 });
  }
  return tables;
}
