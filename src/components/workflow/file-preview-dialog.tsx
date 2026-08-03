
import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Eye } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { QueryResult } from "@/lib/types";
import { CodeEditor } from "./code-editor";
import { ResultsTable } from "./results-table";

const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_CHARS = 100_000;

type Preview =
  | { kind: "table"; result: QueryResult; totalRows: number }
  | { kind: "code"; language: "json" | "text"; text: string; truncated: boolean };

function buildPreview(fileName: string, content: string): Preview {
  const ext = fileName.split(".").pop()?.toLowerCase();

  if (ext === "csv" || ext === "tsv") {
    const parsed = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: true,
    });
    if ((parsed.meta.fields?.length ?? 0) > 0) {
      return {
        kind: "table",
        result: {
          rows: parsed.data.slice(0, MAX_PREVIEW_ROWS),
          fields: parsed.meta.fields!.map((name) => ({ name, dataTypeID: 0 })),
          durationMs: 0,
        },
        totalRows: parsed.data.length,
      };
    }
    // fall through to plain text if the CSV has no header row
  }

  if (ext === "json") {
    try {
      const pretty = JSON.stringify(JSON.parse(content), null, 2);
      return {
        kind: "code",
        language: "json",
        text: pretty.slice(0, MAX_PREVIEW_CHARS),
        truncated: pretty.length > MAX_PREVIEW_CHARS,
      };
    } catch {
      // invalid JSON — show it as plain text instead
    }
  }

  return {
    kind: "code",
    language: "text",
    text: content.slice(0, MAX_PREVIEW_CHARS),
    truncated: content.length > MAX_PREVIEW_CHARS,
  };
}

/** Eye button on a file node: shows the raw file with a format-specific view. */
export function FilePreviewDialog({
  fileName,
  content,
}: {
  fileName: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  // Parsing can be expensive — only build the preview while the dialog is open.
  const preview = useMemo(
    () => (open ? buildPreview(fileName, content) : null),
    [open, fileName, content]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Eye className="h-3 w-3" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Preview file content</TooltipContent>
      </Tooltip>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{fileName}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex items-center gap-2">
              {preview?.kind === "table" && (
                <>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {preview.totalRows} rows
                  </Badge>
                  {preview.totalRows > MAX_PREVIEW_ROWS && (
                    <span className="text-xs">
                      showing first {MAX_PREVIEW_ROWS}
                    </span>
                  )}
                </>
              )}
              {preview?.kind === "code" && (
                <>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {preview.language}
                  </Badge>
                  {preview.truncated && (
                    <span className="text-xs">
                      showing first {MAX_PREVIEW_CHARS.toLocaleString()}{" "}
                      characters
                    </span>
                  )}
                </>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {preview?.kind === "table" && <ResultsTable result={preview.result} />}
          {preview?.kind === "code" && (
            <CodeEditor
              value={preview.text}
              language={preview.language}
              readOnly
              showLineNumbers
              minHeight="10rem"
              maxHeight="65vh"
              className="text-sm"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
