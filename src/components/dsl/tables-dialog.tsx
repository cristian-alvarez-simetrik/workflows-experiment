import { useCallback, useEffect, useState } from "react";
import { Database, RefreshCw, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ResultsTable } from "@/components/workflow/results-table";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { QueryResult } from "@/lib/types";

interface TableInfo {
  schema: string;
  name: string;
  rowCount: number;
  columns: { name: string; type: string; nullable: boolean }[];
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function loadTables(): Promise<TableInfo[]> {
  const db = await getDb();
  const tablesRes = await db.query<{
    table_schema: string;
    table_name: string;
  }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name`
  );

  const tables: TableInfo[] = [];
  for (const row of tablesRes.rows) {
    const [count, columns] = await Promise.all([
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${quote(row.table_schema)}.${quote(row.table_name)}`
      ),
      db.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [row.table_schema, row.table_name]
      ),
    ]);
    tables.push({
      schema: row.table_schema,
      name: row.table_name,
      rowCount: count.rows[0]?.n ?? 0,
      columns: columns.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
      })),
    });
  }
  return tables;
}

/**
 * Dialog listing every user table in PGlite (the tables `desde` reads from
 * and the ones `escribir` creates), with columns and a data preview.
 */
export function TablesDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<TableInfo | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadTables();
      setTables(loaded);
      setSelected((current) => {
        if (!current) return loaded[0] ?? null;
        return (
          loaded.find(
            (t) => t.schema === current.schema && t.name === current.name
          ) ??
          loaded[0] ??
          null
        );
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    getDb()
      .then((db) => {
        const start = performance.now();
        return db
          .query(
            `SELECT * FROM ${quote(selected.schema)}.${quote(selected.name)} LIMIT 50`
          )
          .then((res) => ({ res, durationMs: performance.now() - start }));
      })
      .then(({ res, durationMs }) => {
        if (cancelled) return;
        setPreview({
          rows: res.rows as Record<string, unknown>[],
          fields: res.fields,
          durationMs,
        });
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Table2 className="h-4 w-4" />
          Ver tablas
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Tablas en PGlite
          </DialogTitle>
          <DialogDescription>
            Las tablas fuente que lee <code className="font-mono">desde</code>{" "}
            y las tablas destino que crea{" "}
            <code className="font-mono">escribir</code>, tal como existen en la
            base de datos del navegador.
          </DialogDescription>
        </DialogHeader>

        {loading && tables.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Consultando information_schema…
          </div>
        ) : tables.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No hay tablas todavía. Use “Crear datos de ejemplo” para crear{" "}
            <span className="font-mono">crudo.transacciones</span>.
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_1fr]">
            {/* Table list */}
            <ScrollArea className="max-h-[60vh] rounded-md border">
              <div className="p-1">
                {tables.map((table) => {
                  const isSelected =
                    selected?.schema === table.schema &&
                    selected?.name === table.name;
                  return (
                    <button
                      key={`${table.schema}.${table.name}`}
                      onClick={() => setSelected(table)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs transition-colors",
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted"
                      )}
                    >
                      <Table2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {table.schema}.{table.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="px-1.5 text-[10px] tabular-nums"
                      >
                        {table.rowCount}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Detail */}
            <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
              {selected && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {selected.schema}.{selected.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selected.rowCount} filas
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-7 w-7"
                      onClick={() => void refresh()}
                      disabled={loading}
                    >
                      <RefreshCw
                        className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                      />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.columns.map((column) => (
                      <Badge
                        key={column.name}
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {column.name}: {column.type}
                        {column.nullable ? "" : " · not null"}
                      </Badge>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {previewLoading ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                        <Spinner className="h-4 w-4" />
                        Cargando datos…
                      </div>
                    ) : preview ? (
                      <ResultsTable result={preview} maxRows={50} />
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Vista previa limitada a 50 filas.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
