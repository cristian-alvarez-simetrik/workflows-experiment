
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { Code2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ScriptNodeData } from "@/lib/types";
import { CodeEditor } from "../code-editor";
import { CodeEditorDrawer } from "../code-editor-drawer";
import { NodeWrapper } from "./node-wrapper";

const SCRIPT_HELP = `JavaScript, async allowed. Available in scope:
  inputs   – array of upstream node outputs
  input    – first upstream output
  query(sql) – run SQL against PGlite, returns rows
  log(...) – print to the node's log panel
Whatever you return becomes this node's output —
return a SQL string to feed a downstream SQL node.`;

export function ScriptNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ScriptNodeData;
  const { updateNodeData } = useReactFlow();

  // Script outputs are either JSON (objects, arrays, primitives) or a SQL
  // string built for a downstream node — pick the highlighting to match.
  const outputLanguage = /^\s*[\[{"]/.test(nodeData.lastValue ?? "")
    ? "json"
    : "sql";

  return (
    <NodeWrapper
      id={id}
      icon={Code2}
      iconClassName="text-violet-400"
      typeLabel="Script"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      headerExtra={
        <CodeEditorDrawer
          title="Edit script"
          description={SCRIPT_HELP}
          value={nodeData.code}
          language="javascript"
          placeholder={`const rows = await query("SELECT count(*)::int AS n FROM my_table");\nlog("rows:", rows[0].n);\nreturn \`SELECT * FROM my_table LIMIT \${rows[0].n > 100 ? 100 : rows[0].n}\`;`}
          onSave={(code) => updateNodeData(id, { code })}
        />
      }
    >
      <div className="nodrag nowheel space-y-2">
        <CodeEditor
          value={nodeData.code}
          language="javascript"
          onChange={(code) => updateNodeData(id, { code })}
          placeholder={"// return a value for downstream nodes\n// query(sql), log(...), inputs available"}
          minHeight="5rem"
          maxHeight="10rem"
        />
        {(nodeData.logs?.length ?? 0) > 0 && (
          <ScrollArea className="max-h-24 rounded-md border bg-muted/40 p-2">
            <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
              {nodeData.logs!.join("\n")}
            </pre>
          </ScrollArea>
        )}
        {nodeData.lastValue !== undefined && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Output
            </div>
            <CodeEditor
              value={nodeData.lastValue}
              language={outputLanguage}
              readOnly
              minHeight="2rem"
              maxHeight="6rem"
            />
          </div>
        )}
      </div>
    </NodeWrapper>
  );
}
