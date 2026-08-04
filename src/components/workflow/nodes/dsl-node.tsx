import { useState } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronUp, FileCode2, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { DslNodeData } from "@/lib/types";
import { CodeEditor } from "../code-editor";
import { CodeEditorDrawer } from "../code-editor-drawer";
import { NodeWrapper } from "./node-wrapper";
import { ResultsTable } from "../results-table";

const DSL_PLACEHOLDER = `proceso mi_proceso

desde banco.crudo.transacciones

escribir depurado.salida
    modo reemplazar`;

/** True when the DSL declares parameters, so the params editor is relevant. */
const declaresParameters = (dsl: string): boolean => /^\s*parametro\s/im.test(dsl);

export function DslNode({ id, data, selected }: NodeProps) {
  const nodeData = data as DslNodeData;
  const { updateNodeData } = useReactFlow();
  const result = nodeData.lastResult;
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  return (
    <NodeWrapper
      id={id}
      icon={FileCode2}
      iconClassName="text-fuchsia-400"
      typeLabel="DSL"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      headerExtra={
        <>
          {result && (
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Ver tabla resultado"
                >
                  <Table2 className="h-3 w-3" />
                </Button>
              </DialogTrigger>
              <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
                <DialogHeader>
                  <DialogTitle>{nodeData.label}</DialogTitle>
                  <DialogDescription className="font-mono text-xs">
                    {nodeData.targetTable} · {nodeData.rowCount ?? result.rows.length}{" "}
                    rows
                  </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-auto">
                  <ResultsTable result={result} />
                </div>
              </DialogContent>
            </Dialog>
          )}
          <CodeEditorDrawer
            title="Edit DSL"
            description="Proceso ETL compilado a SQL y ejecutado en PGlite al correr el nodo. La salida del nodo es el nombre de la tabla destino (esquema.tabla); un nodo DSL posterior puede leerla con «desde banco.{{input}}» o unir dos entradas con «desde banco.{{input0}} como s» + «unir izquierda banco.{{input1}} como b» seguido de «en b.col = s.col»."
            value={nodeData.dsl}
            language="text"
            placeholder={DSL_PLACEHOLDER}
            onSave={(dsl) => updateNodeData(id, { dsl })}
          />
        </>
      }
    >
      <div className="nodrag nowheel space-y-2">
        <Textarea
          value={nodeData.description ?? ""}
          onChange={(e) => updateNodeData(id, { description: e.target.value })}
          placeholder="Describe qué hace este proceso… (el DSL se edita con el botón de expandir)"
          className="min-h-14 resize-none border-none bg-transparent p-1 text-xs leading-snug text-muted-foreground shadow-none focus-visible:ring-1 dark:bg-transparent"
        />
        {declaresParameters(nodeData.dsl) && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Parámetros (JSON)
            </p>
            <CodeEditor
              value={nodeData.paramsJson ?? ""}
              language="json"
              onChange={(paramsJson) => updateNodeData(id, { paramsJson })}
              placeholder={'{"fecha_inicio": "2026-01-01"}'}
              minHeight="2rem"
              maxHeight="5rem"
            />
          </div>
        )}
        {result ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[10px]">
                → {nodeData.targetTable}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {nodeData.rowCount ?? result.rows.length} rows
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-5 w-5"
                title={
                  previewCollapsed ? "Mostrar tabla resultado" : "Ocultar tabla resultado"
                }
                onClick={() => setPreviewCollapsed((c) => !c)}
              >
                {previewCollapsed ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
              </Button>
            </div>
            {!previewCollapsed && (
              <div className="max-h-48 overflow-auto">
                <ResultsTable result={result} maxRows={8} />
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Run the node to compile the DSL and create the target table.
          </p>
        )}
      </div>
    </NodeWrapper>
  );
}
