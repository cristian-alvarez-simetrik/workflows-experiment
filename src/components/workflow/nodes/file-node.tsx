
import { useRef } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultParserScript, sanitizeIdentifier } from "@/lib/file-loader";
import type { FileNodeData } from "@/lib/types";
import { CodeEditor } from "../code-editor";
import { CodeEditorDrawer } from "../code-editor-drawer";
import { FilePreviewDialog } from "../file-preview-dialog";
import { NodeWrapper } from "./node-wrapper";

const PARSER_HELP = `JavaScript, async allowed. Available in scope:
  content  – raw file text
  fileName – original file name
  parseCsv(content, options?) – papaparse helper returning row objects
Return an array of row objects; they are loaded into the target PGlite table
(columns and types are inferred from the objects).`;

export function FileNode({ id, data, selected }: NodeProps) {
  const nodeData = data as FileNodeData;
  const { updateNodeData } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const content = await file.text();
    updateNodeData(id, {
      fileName: file.name,
      fileContent: content,
      tableName: sanitizeIdentifier(file.name),
      parserScript: defaultParserScript(file.name),
      label: file.name,
      status: "idle",
      error: undefined,
      rowCount: undefined,
    });
  };

  return (
    <NodeWrapper
      id={id}
      icon={FileUp}
      iconClassName="text-amber-400"
      typeLabel="File"
      label={nodeData.label}
      status={nodeData.status}
      error={nodeData.error}
      selected={selected}
      hasInput={false}
      headerExtra={
        <>
          {nodeData.fileName && nodeData.fileContent !== undefined && (
            <FilePreviewDialog
              fileName={nodeData.fileName}
              content={nodeData.fileContent}
            />
          )}
          <CodeEditorDrawer
            title="Edit parser script"
            description={PARSER_HELP}
            value={nodeData.parserScript ?? ""}
            language="javascript"
            onSave={(parserScript) => updateNodeData(id, { parserScript })}
          />
        </>
      }
    >
      <div className="nodrag space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.json,.txt,.log"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="h-3.5 w-3.5" />
          {nodeData.fileName ? "Replace file" : "Choose file (csv, json, txt)"}
        </Button>

        {nodeData.fileName && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Target table
              </Label>
              <Input
                className="h-7 font-mono text-xs"
                value={nodeData.tableName}
                onChange={(e) =>
                  updateNodeData(id, {
                    tableName:
                      sanitizeIdentifier(e.target.value) || e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Parser script
              </Label>
              <CodeEditor
                value={nodeData.parserScript ?? ""}
                language="javascript"
                onChange={(parserScript) =>
                  updateNodeData(id, { parserScript })
                }
                placeholder="return parseCsv(content);"
                minHeight="4rem"
                maxHeight="9rem"
              />
            </div>
            {nodeData.rowCount !== undefined && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {nodeData.rowCount} rows loaded
              </Badge>
            )}
          </>
        )}
      </div>
    </NodeWrapper>
  );
}
