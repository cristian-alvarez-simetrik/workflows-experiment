"use client";

import { useState } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Loader2, Play, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NodeStatus } from "@/lib/types";
import { useWorkflowRunner } from "../run-context";

const statusRing: Record<NodeStatus, string> = {
  idle: "border-border",
  running: "border-blue-500/70",
  success: "border-emerald-500/70",
  error: "border-red-500/70",
};

const statusDot: Record<NodeStatus, string> = {
  idle: "bg-muted-foreground/40",
  running: "bg-blue-500 animate-pulse",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

interface NodeWrapperProps {
  id: string;
  icon: LucideIcon;
  iconClassName?: string;
  typeLabel: string;
  label: string;
  status: NodeStatus;
  error?: string;
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

export function NodeWrapper({
  id,
  icon: Icon,
  iconClassName,
  typeLabel,
  label,
  status,
  error,
  selected,
  hasInput = true,
  hasOutput = true,
  headerExtra,
  children,
}: NodeWrapperProps) {
  const { runNode, isRunning } = useWorkflowRunner();
  const { deleteElements, updateNodeData } = useReactFlow();
  const [renaming, setRenaming] = useState(false);

  const commitRename = (value: string) => {
    const next = value.trim();
    if (next && next !== label) updateNodeData(id, { label: next });
    setRenaming(false);
  };

  return (
    <div
      className={cn(
        "w-72 rounded-lg border bg-card text-card-foreground shadow-md transition-colors",
        statusRing[status],
        selected && "ring-2 ring-ring/60",
      )}
    >
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground"
        />
      )}
      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-background !bg-primary"
        />
      )}

      <div className="space-y-1.5 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <Input
                autoFocus
                defaultValue={label}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => commitRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="nodrag h-6 px-1 text-sm font-medium"
              />
            ) : (
              <div
                className="truncate text-sm font-medium leading-tight"
                title="Double-click to rename"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                }}
              >
                {label}
              </div>
            )}
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {typeLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {headerExtra}
          <span
            className={cn(
              "ml-auto mr-1 h-2 w-2 shrink-0 rounded-full",
              statusDot[status],
            )}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={isRunning}
                onClick={() => runNode(id)}
              >
                {status === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run node + downstream</TooltipContent>
          </Tooltip>
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Delete node</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The node and its connections will be removed from the
                  workflow. Tables it already loaded into PGlite are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteElements({ nodes: [{ id }] })}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="px-3 py-2">{children}</div>

      {error && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 break-words">
          {error}
        </div>
      )}
    </div>
  );
}
