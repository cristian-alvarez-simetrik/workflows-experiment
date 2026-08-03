import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  FileCode2,
  Hammer,
  Play,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { TablesDialog } from "@/components/dsl/tables-dialog";
import { CodeEditor } from "@/components/workflow/code-editor";
import { ResultsTable } from "@/components/workflow/results-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDb } from "@/lib/db";
import {
  CompileOutput,
  Diagnostic,
  ExecutionResult,
  PGliteSchemaProvider,
  ParameterValue,
  compile,
  execute,
  formatDiagnostic,
  typeName,
} from "@/lib/dsl";
import { EXAMPLES, SEED_SQL, SEED_TABLE } from "@/lib/dsl/examples";
import type { QueryResult } from "@/lib/types";

const STORAGE_KEY = "dsl-playground-source";

function loadInitialSource(): string {
  return localStorage.getItem(STORAGE_KEY) ?? EXAMPLES[0].source;
}

type TabId = "diagnostics" | "sql" | "artifact" | "result";

export function DslPlaygroundPage() {
  const [source, setSource] = useState(loadInitialSource);
  const [exampleId, setExampleId] = useState<string | undefined>(undefined);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<CompileOutput | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState<"validate" | "compile" | "run" | "seed" | null>(
    null
  );
  const [tab, setTab] = useState<TabId>("diagnostics");
  const [seeded, setSeeded] = useState<boolean | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, source);
  }, [source]);

  // Detect whether the sample source table already exists.
  useEffect(() => {
    getDb()
      .then((db) =>
        db.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = $2`,
          [SEED_TABLE.schema, SEED_TABLE.table]
        )
      )
      .then((res) => setSeeded(res.rows.length > 0))
      .catch(() => setSeeded(false));
  }, []);

  const declaredParameters = useMemo(
    () => output?.program?.parameters ?? [],
    [output]
  );

  const runCompile = useCallback(async (): Promise<CompileOutput> => {
    const db = await getDb();
    const result = await compile(source, new PGliteSchemaProvider(db));
    setOutput(result);
    return result;
  }, [source]);

  const handleValidate = async () => {
    setBusy("validate");
    try {
      const result = await runCompile();
      setTab("diagnostics");
      if (result.ok) {
        toast.success(`Proceso válido: ${result.plan!.processName}`);
      } else {
        toast.error("El proceso tiene errores.");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCompile = async () => {
    setBusy("compile");
    try {
      const result = await runCompile();
      if (result.ok) {
        setTab("sql");
        toast.success("SQL generado.");
      } else {
        setTab("diagnostics");
        toast.error("No se pudo compilar: revise los diagnósticos.");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleRun = async () => {
    setBusy("run");
    setExecution(null);
    setPreview(null);
    try {
      const result = await runCompile();
      if (!result.ok || !result.plan) {
        setTab("diagnostics");
        toast.error("No se pudo ejecutar: revise los diagnósticos.");
        return;
      }
      const provided: Record<string, ParameterValue | undefined> = {};
      for (const parameter of result.program?.parameters ?? []) {
        const raw = paramValues[parameter.name];
        provided[parameter.name] =
          raw === undefined || raw === "" ? undefined : raw;
      }
      const db = await getDb();
      const executionResult = await execute(db, result.plan, provided);
      setExecution(executionResult);
      setTab("result");
      if (executionResult.success) {
        const target = `${executionResult.target.schema}.${executionResult.target.table}`;
        toast.success(
          `Tabla ${target} creada (${executionResult.rowCount ?? 0} filas).`
        );
        const previewResult = await db.query(
          `SELECT * FROM "${executionResult.target.schema}"."${executionResult.target.table}" LIMIT 100`
        );
        setPreview({
          rows: previewResult.rows as Record<string, unknown>[],
          fields: previewResult.fields,
          durationMs: executionResult.durationMs,
        });
      } else {
        toast.error("La ejecución falló (rollback aplicado).");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleSeed = async () => {
    setBusy("seed");
    try {
      const db = await getDb();
      await db.exec(SEED_SQL);
      setSeeded(true);
      toast.success(
        `Tabla ${SEED_TABLE.schema}.${SEED_TABLE.table} creada con datos de ejemplo.`
      );
    } catch (err) {
      toast.error(`No se pudo crear la tabla de ejemplo: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const loadExample = (id: string) => {
    const example = EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    setExampleId(id);
    setSource(example.source);
    setOutput(null);
    setExecution(null);
    setPreview(null);
  };

  const errors = (output?.diagnostics ?? []).filter(
    (d) => d.severity === "error"
  );
  const warnings = (output?.diagnostics ?? []).filter(
    (d) => d.severity === "warning"
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <FileCode2 className="h-5 w-5 text-primary" />
        <div className="mr-4">
          <h1 className="text-sm font-semibold leading-tight">
            DSL Playground
          </h1>
          <p className="text-xs text-muted-foreground">
            Transformaciones ETL → SQL PostgreSQL, ejecutado en PGlite
          </p>
        </div>

        <Select value={exampleId} onValueChange={loadExample}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Cargar ejemplo…" />
          </SelectTrigger>
          <SelectContent>
            {EXAMPLES.map((example) => (
              <SelectItem key={example.id} value={example.id}>
                {example.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <TablesDialog />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeed}
            disabled={busy !== null}
          >
            <Database className="h-4 w-4" />
            {seeded ? "Recrear datos de ejemplo" : "Crear datos de ejemplo"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={busy !== null}
          >
            <ShieldCheck className="h-4 w-4" />
            Validar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCompile}
            disabled={busy !== null}
          >
            <Hammer className="h-4 w-4" />
            Compilar
          </Button>
          <Button size="sm" onClick={handleRun} disabled={busy !== null}>
            <Play className="h-4 w-4" />
            Ejecutar
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* Editor */}
        <div className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              proceso.etl
            </span>
            {seeded === false && (
              <span className="text-xs text-amber-500">
                Cree los datos de ejemplo antes de ejecutar
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <CodeEditor
              value={source}
              language="text"
              onChange={setSource}
              showLineNumbers
              minHeight="100%"
              maxHeight="none"
              className="h-full [&_.cm-editor]:h-full"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex min-h-0 flex-col">
          {declaredParameters.length > 0 && (
            <div className="border-b px-4 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Parámetros
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {declaredParameters.map((parameter) => (
                  <div key={parameter.name} className="space-y-1">
                    <Label
                      htmlFor={`param-${parameter.name}`}
                      className="font-mono text-xs"
                    >
                      ${parameter.name}
                      {!parameter.defaultValue && (
                        <span className="text-destructive"> *</span>
                      )}
                    </Label>
                    <Input
                      id={`param-${parameter.name}`}
                      className="h-7 font-mono text-xs"
                      placeholder={
                        parameter.defaultValue
                          ? "(usa el valor predeterminado)"
                          : "obligatorio"
                      }
                      value={paramValues[parameter.name] ?? ""}
                      onChange={(e) =>
                        setParamValues((prev) => ({
                          ...prev,
                          [parameter.name]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as TabId)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="diagnostics">
                Diagnósticos
                {output && (
                  <Badge
                    variant={errors.length > 0 ? "destructive" : "secondary"}
                    className="ml-1 px-1.5 text-[10px]"
                  >
                    {errors.length + warnings.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sql">SQL</TabsTrigger>
              <TabsTrigger value="artifact">Artefacto</TabsTrigger>
              <TabsTrigger value="result">Resultado</TabsTrigger>
            </TabsList>

            <TabsContent
              value="diagnostics"
              className="min-h-0 flex-1 overflow-auto p-4"
            >
              <DiagnosticsView output={output} source={source} />
            </TabsContent>

            <TabsContent
              value="sql"
              className="min-h-0 flex-1 overflow-auto p-4"
            >
              {output?.sql ? (
                <div className="space-y-3">
                  {output.sql.statements.map((statement) => (
                    <div key={statement.kind}>
                      <p className="mb-1 font-mono text-xs text-muted-foreground">
                        -- {statement.kind}
                      </p>
                      <CodeEditor
                        value={statement.sql}
                        language="sql"
                        readOnly
                        minHeight="2rem"
                        maxHeight="30rem"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyHint text='Presione "Compilar" para generar el SQL.' />
              )}
            </TabsContent>

            <TabsContent
              value="artifact"
              className="min-h-0 flex-1 overflow-auto p-4"
            >
              {output?.artifact ? (
                <CodeEditor
                  value={JSON.stringify(output.artifact, null, 2)}
                  language="json"
                  readOnly
                  minHeight="2rem"
                  maxHeight="40rem"
                />
              ) : (
                <EmptyHint text="El artefacto compilado aparecerá aquí después de compilar." />
              )}
            </TabsContent>

            <TabsContent
              value="result"
              className="min-h-0 flex-1 overflow-auto p-4"
            >
              {execution ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {execution.success ? (
                      <Badge className="bg-emerald-600 text-white">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Éxito
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <TriangleAlert className="mr-1 h-3 w-3" />
                        Error (rollback)
                      </Badge>
                    )}
                    <span className="font-mono text-muted-foreground">
                      {execution.target.schema}.{execution.target.table}
                    </span>
                    <span className="text-muted-foreground">
                      {execution.durationMs.toFixed(0)} ms
                      {execution.rowCount !== undefined
                        ? ` · ${execution.rowCount} filas`
                        : ""}
                    </span>
                  </div>
                  {execution.error && (
                    <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 font-mono text-xs text-destructive">
                      {execution.error}
                    </pre>
                  )}
                  {execution.resolvedParameters &&
                    Object.keys(execution.resolvedParameters).length > 0 && (
                      <p className="font-mono text-xs text-muted-foreground">
                        Parámetros:{" "}
                        {Object.entries(execution.resolvedParameters)
                          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                          .join("  ")}
                      </p>
                    )}
                  {preview && <ResultsTable result={preview} maxRows={100} />}
                </div>
              ) : (
                <EmptyHint text='Presione "Ejecutar" para crear la tabla destino en PGlite.' />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function DiagnosticsView({
  output,
  source,
}: {
  output: CompileOutput | null;
  source: string;
}) {
  if (!output) {
    return (
      <EmptyHint text='Presione "Validar" para analizar el proceso (lexer → parser → semántica).' />
    );
  }

  const { diagnostics } = output;

  return (
    <div className="space-y-4">
      {output.ok && output.plan && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Proceso válido: {output.plan.processName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Origen:</span>{" "}
              <span className="font-mono">
                {output.program!.source.connection}.
                {output.program!.source.schema}.{output.program!.source.table}
              </span>
            </p>
            <p>
              <span className="font-medium text-foreground">Destino:</span>{" "}
              <span className="font-mono">
                {output.program!.source.connection}.{output.plan.output.schema}
                .{output.plan.output.table}
              </span>{" "}
              (modo reemplazar)
            </p>
            <p>
              <span className="font-medium text-foreground">
                Transformaciones:
              </span>{" "}
              {output.program!.operations.filter((o) => o.type === "Filter")
                .length}{" "}
              filtro(s) ·{" "}
              {
                output.program!.operations.filter((o) => o.type === "AddColumn")
                  .length
              }{" "}
              columna(s) agregada(s) ·{" "}
              {output.program!.selection ? "1 selección" : "sin selección"}
            </p>
            <div>
              <p className="mb-1 font-medium text-foreground">
                Columnas de salida:
              </p>
              <div className="flex flex-wrap gap-1">
                {output.plan.outputSchema.map((column) => (
                  <Badge
                    key={column.name}
                    variant="secondary"
                    className="font-mono text-[10px]"
                  >
                    {column.name}: {typeName(column.type)}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {diagnostics.length === 0 && output.ok && (
        <p className="text-xs text-muted-foreground">
          Sin advertencias ni errores.
        </p>
      )}

      {diagnostics.map((diagnostic, i) => (
        <DiagnosticCard key={i} diagnostic={diagnostic} source={source} />
      ))}
    </div>
  );
}

function DiagnosticCard({
  diagnostic,
  source,
}: {
  diagnostic: Diagnostic;
  source: string;
}) {
  const isError = diagnostic.severity === "error";
  return (
    <div
      className={`rounded-md border p-3 ${
        isError
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge
          variant={isError ? "destructive" : "secondary"}
          className="font-mono text-[10px]"
        >
          {diagnostic.code}
        </Badge>
        <span className="text-xs text-muted-foreground">
          línea {diagnostic.range.start.line}, columna{" "}
          {diagnostic.range.start.column}
        </span>
      </div>
      <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed">
        {formatDiagnostic(diagnostic, source)}
      </pre>
    </div>
  );
}
