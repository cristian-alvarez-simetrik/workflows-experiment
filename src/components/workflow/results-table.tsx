"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QueryResult } from "@/lib/types";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ResultsTable({
  result,
  maxRows,
}: {
  result: QueryResult;
  maxRows?: number;
}) {
  const columns = result.fields.map((f) => f.name);
  const rows = maxRows ? result.rows.slice(0, maxRows) : result.rows;

  if (columns.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        Statement executed — no rows returned
        {result.affectedRows ? ` (${result.affectedRows} affected)` : ""}.
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c}
                className="h-8 whitespace-nowrap font-mono text-xs"
              >
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell
                  key={c}
                  className="whitespace-nowrap py-1.5 font-mono text-xs"
                >
                  {formatCell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-3 text-center text-xs text-muted-foreground"
              >
                0 rows
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
