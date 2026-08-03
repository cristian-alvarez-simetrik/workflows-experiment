
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { Maximize2, Table2 } from "lucide-react";
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
import type { VizNodeData } from "@/lib/types";
import { CodeEditor } from "../code-editor";
import { NodeWrapper } from "./node-wrapper";
import { ResultsTable } from "../results-table";

export function VizNode({ id, data, selected }: NodeProps) {
  const nodeData = data as VizNodeData;
  const { updateNodeData } = useReactFlow();
  const result = nodeData.lastResult;

  return (
    <NodeWrapper
      id={id}
      icon={Table2}
      iconClassName="text-emerald-400"
      typeLabel="Visualization"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      headerExtra={
        result ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Maximize2 className="h-3 w-3" />
              </Button>
            </DialogTrigger>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>{nodeData.label}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {result.rows.length} rows · {result.durationMs.toFixed(0)} ms
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto">
                <ResultsTable result={result} />
              </div>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
    >
      <div className="nodrag nowheel space-y-2">
        <CodeEditor
          value={nodeData.sql}
          language="sql"
          onChange={(sql) => updateNodeData(id, { sql })}
          placeholder="SELECT * FROM my_table LIMIT 50"
          minHeight="4rem"
          maxHeight="7rem"
        />
        {result ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {result.rows.length} rows
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                showing first {Math.min(result.rows.length, 8)}
              </span>
            </div>
            <div className="max-h-48 overflow-auto">
              <ResultsTable result={result} maxRows={8} />
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Run the node to preview results here.
          </p>
        )}
      </div>
    </NodeWrapper>
  );
}
