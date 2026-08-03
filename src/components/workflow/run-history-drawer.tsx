
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  History,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  clearRuns,
  listRuns,
  type RunNodeEntry,
  type RunRecord,
} from "@/lib/run-history";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function StatusIcon({ status }: { status: RunNodeEntry["status"] | "success" | "error" }) {
  if (status === "success") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === "error") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  }
  return <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function RunList({
  runs,
  onSelect,
  onClear,
}: {
  runs: RunRecord[];
  onSelect: (run: RunRecord) => void;
  onClear: () => void;
}) {
  if (runs.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No runs yet — run a node or the whole workflow and it will show up here.
      </p>
    );
  }
  return (
    <>
      <ScrollArea className="min-h-0 flex-1 px-4">
        <ul className="space-y-1.5 pb-2">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                onClick={() => onSelect(run)}
                className="flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <StatusIcon status={run.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {run.trigger}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatTime(run.startedAt)} · {run.nodes.length} node
                    {run.nodes.length === 1 ? "" : "s"} ·{" "}
                    {formatDuration(run.finishedAt - run.startedAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <div className="border-t px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={onClear}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear history
        </Button>
      </div>
    </>
  );
}

function RunDetails({ run }: { run: RunRecord }) {
  return (
    <ScrollArea className="min-h-0 flex-1 px-4">
      <div className="space-y-2 pb-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <StatusIcon status={run.status} />
          <span>{formatTime(run.startedAt)}</span>
          <span>·</span>
          <span>{formatDuration(run.finishedAt - run.startedAt)} total</span>
        </div>
        {run.nodes.map((entry) => (
          <div
            key={entry.nodeId}
            className={cn(
              "rounded-md border p-2.5",
              entry.status === "error" && "border-red-500/40 bg-red-500/5"
            )}
          >
            <div className="flex items-center gap-2">
              <StatusIcon status={entry.status} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {entry.label}
              </span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {entry.type}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {formatDuration(entry.durationMs)}
              </span>
            </div>
            {entry.summary && (
              <p className="mt-1 pl-6 font-mono text-xs text-muted-foreground">
                {entry.summary}
              </p>
            )}
            {entry.error && (
              <p className="mt-1 pl-6 text-xs break-words text-red-400">
                {entry.error}
              </p>
            )}
            {(entry.logs?.length ?? 0) > 0 && (
              <pre className="mt-1.5 ml-6 whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {entry.logs!.join("\n")}
              </pre>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

interface RunHistoryDrawerProps {
  workflowId: string | null;
  /** Bump to make an open drawer re-read the stored runs. */
  refreshKey: number;
}

export function RunHistoryDrawer({
  workflowId,
  refreshKey,
}: RunHistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selected, setSelected] = useState<RunRecord | null>(null);

  useEffect(() => {
    if (open && workflowId) setRuns(listRuns(workflowId));
  }, [open, workflowId, refreshKey]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(null);
      }}
      modal={false}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="h-4 w-4" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 border-l shadow-2xl sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <div className="flex items-center gap-1.5">
            {selected && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
            )}
            <SheetTitle>
              {selected ? selected.trigger : "Run history"}
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Past workflow runs with per-node logs
          </SheetDescription>
        </SheetHeader>
        {selected ? (
          <RunDetails run={selected} />
        ) : (
          <RunList
            runs={runs}
            onSelect={setSelected}
            onClear={() => {
              if (workflowId) clearRuns(workflowId);
              setRuns([]);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
