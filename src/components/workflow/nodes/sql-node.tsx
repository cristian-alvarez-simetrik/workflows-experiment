
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SqlNodeData } from "@/lib/types";
import { CodeEditor } from "../code-editor";
import { CodeEditorDrawer } from "../code-editor-drawer";
import { NodeWrapper } from "./node-wrapper";

export function SqlNode({ id, data, selected }: NodeProps) {
  const nodeData = data as SqlNodeData;
  const { updateNodeData } = useReactFlow();

  return (
    <NodeWrapper
      id={id}
      icon={Database}
      iconClassName="text-sky-400"
      typeLabel="SQL"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      headerExtra={
        <CodeEditorDrawer
          title="Edit SQL"
          description="Runs against the in-browser PGlite database. Use {{input}} to inline the output of an upstream node (e.g. SQL built by a script node)."
          value={nodeData.sql}
          language="sql"
          placeholder="SELECT * FROM my_table LIMIT 10"
          onSave={(sql) => updateNodeData(id, { sql })}
        />
      }
    >
      <div className="nodrag nowheel space-y-2">
        <CodeEditor
          value={nodeData.sql}
          language="sql"
          onChange={(sql) => updateNodeData(id, { sql })}
          placeholder={"SELECT * FROM my_table\n-- {{input}} inlines upstream output"}
          minHeight="5rem"
          maxHeight="10rem"
        />
        {nodeData.lastResult && (
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {nodeData.lastResult.rows.length} rows
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {nodeData.lastResult.durationMs.toFixed(0)} ms
            </span>
          </div>
        )}
      </div>
    </NodeWrapper>
  );
}
