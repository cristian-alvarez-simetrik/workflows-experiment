"use client";

import Papa from "papaparse";
import { getDb } from "./db";

export function sanitizeIdentifier(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "t$1");
  return cleaned || "uploaded_file";
}

/** Default parser script for a file, picked by extension. */
export function defaultParserScript(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "tsv") {
    return `// content: raw file text. Return an array of row objects.
// parseCsv(content, papaparseOptions?) is available.
return parseCsv(content);`;
  }
  if (ext === "json") {
    return `// content: raw file text. Return an array of row objects.
const data = JSON.parse(content);
return Array.isArray(data) ? data : [data];`;
  }
  return `// content: raw file text. Return an array of row objects.
return content
  .split(/\\r?\\n/)
  .filter(Boolean)
  .map((line, i) => ({ line_number: i + 1, line }));`;
}

/**
 * Run a file node's parser script. In scope:
 *   content  – raw file text
 *   fileName – original file name
 *   parseCsv – papaparse helper returning row objects
 * Must return (or resolve to) an array of row objects.
 */
export async function runParserScript(
  script: string,
  content: string,
  fileName: string
): Promise<Record<string, unknown>[]> {
  const parseCsv = (
    text: string,
    options?: Papa.ParseConfig<Record<string, unknown>>
  ) => {
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      ...options,
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
    }
    return parsed.data;
  };

  const fn = new Function(
    "content",
    "fileName",
    "parseCsv",
    `"use strict"; return (async () => { ${script} })();`
  );
  const rows = await fn(content, fileName, parseCsv);

  if (!Array.isArray(rows)) {
    throw new Error("Parser script must return an array of row objects");
  }
  if (rows.length === 0) {
    throw new Error("Parser script returned no rows");
  }
  if (rows.some((r) => typeof r !== "object" || r === null || Array.isArray(r))) {
    throw new Error("Every row returned by the parser must be a plain object");
  }
  return rows as Record<string, unknown>[];
}

type ColumnType = "double precision" | "boolean" | "text";

function inferColumnType(values: unknown[]): ColumnType {
  let sawValue = false;
  let allNumeric = true;
  let allBoolean = true;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    sawValue = true;
    if (typeof v !== "number" || Number.isNaN(v)) allNumeric = false;
    if (typeof v !== "boolean") allBoolean = false;
  }
  if (!sawValue) return "text";
  if (allNumeric) return "double precision";
  if (allBoolean) return "boolean";
  return "text";
}

/** Create (or replace) a table and insert the parsed rows into it. */
export async function insertRows(
  tableName: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  const db = await getDb();
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (columns.length === 0) throw new Error("Rows have no columns");

  const normalized = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      const v = row[c];
      out[c] =
        v === undefined || v === ""
          ? null
          : v !== null && typeof v === "object"
            ? JSON.stringify(v)
            : v;
    }
    return out;
  });

  const safeCols = columns.map((c) => sanitizeIdentifier(c) || "col");
  const types = columns.map((c) =>
    inferColumnType(normalized.map((r) => r[c]))
  );

  const colDefs = safeCols.map((c, i) => `"${c}" ${types[i]}`).join(", ");
  await db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
  await db.exec(`CREATE TABLE "${tableName}" (${colDefs})`);

  const colList = safeCols.map((c) => `"${c}"`).join(", ");
  const batchSize = 500;
  for (let offset = 0; offset < normalized.length; offset += batchSize) {
    const batch = normalized.slice(offset, offset + batchSize);
    const params: unknown[] = [];
    const tuples = batch
      .map((row) => {
        const placeholders = columns.map((c) => {
          params.push(row[c]);
          return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");
    await db.query(
      `INSERT INTO "${tableName}" (${colList}) VALUES ${tuples}`,
      params
    );
  }
  return normalized.length;
}
