import { useState } from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { Boxes, ChevronDown, ChevronRight, Loader2, Play, Trash2 } from "lucide-react";
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
import type { GroupNodeData, NodeStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkflowRunner } from "../run-context";

export const GROUP_COLLAPSED_SIZE = { width: 320, height: 96 };

const statusDot: Record<NodeStatus, string> = {
  idle: "bg-muted-foreground/40",
  running: "bg-blue-500 animate-pulse",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

export function GroupNode({ id, data, selected }: NodeProps) {
  const nodeData = data as GroupNodeData;
  const collapsed = nodeData.collapsed === true;
  const { setNodes, setEdges, getNodes, getEdges, deleteElements } =
    useReactFlow();
  const { runNode, isRunning } = useWorkflowRunner();
  const [renaming, setRenaming] = useState(false);

  const children = getNodes().filter((n) => n.parentId === id);

  const commitRename = (value: string) => {
    const next = value.trim();
    if (next && next !== nodeData.label) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, label: next } } : n
        )
      );
    }
    setRenaming(false);
  };

  /** Run the group's entry nodes (children with no upstream inside the group). */
  const runGroup = () => {
    const edges = getEdges();
    const childIds = new Set(children.map((c) => c.id));
    const root = children.find(
      (c) => !edges.some((e) => e.target === c.id && childIds.has(e.source))
    );
    if (root) runNode(root.id);
  };

  const toggleCollapsed = () => {
    const collapsing = !collapsed;
    const childIds = new Set(
      getNodes()
        .filter((n) => n.parentId === id)
        .map((n) => n.id)
    );
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === id) {
          const currentSize = {
            width: Number(n.style?.width ?? n.measured?.width ?? 400),
            height: Number(n.style?.height ?? n.measured?.height ?? 300),
          };
          const nextSize = collapsing
            ? GROUP_COLLAPSED_SIZE
            : (n.data as GroupNodeData).expandedSize ?? currentSize;
          return {
            ...n,
            style: { ...n.style, ...nextSize },
            data: {
              ...n.data,
              collapsed: collapsing,
              expandedSize: collapsing
                ? currentSize
                : (n.data as GroupNodeData).expandedSize,
            },
          };
        }
        if (n.parentId === id) return { ...n, hidden: collapsing };
        return n;
      })
    );
    setEdges((eds) =>
      eds.map((e) =>
        childIds.has(e.source) || childIds.has(e.target)
          ? { ...e, hidden: collapsing }
          : e
      )
    );
  };

  const deleteGroup = () => {
    void deleteElements({
      nodes: [{ id }, ...children.map((c) => ({ id: c.id }))],
    });
  };

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-xl border-2 border-dashed transition-colors",
        collapsed
          ? "border-primary/50 bg-card shadow-md"
          : "border-primary/30 bg-primary/[0.03]",
        selected && "ring-2 ring-ring/60"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-t-[10px] px-3 py-2",
          !collapsed && "border-b border-dashed border-primary/20 bg-card/60"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {collapsed ? "Expand group" : "Collapse group"}
          </TooltipContent>
        </Tooltip>
        <Boxes className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              defaultValue={nodeData.label}
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
              {nodeData.label}
            </div>
          )}
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {collapsed ? `Group · ${children.length} nodes hidden` : "Group"}
          </div>
        </div>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            statusDot[nodeData.status] ?? statusDot.idle
          )}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              disabled={isRunning || children.length === 0}
              onClick={runGroup}
            >
              {nodeData.status === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run group</TooltipContent>
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
            <TooltipContent>Delete group</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{nodeData.label}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The group and its {children.length} inner nodes will be
                removed. Tables already created in PGlite are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={deleteGroup}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {collapsed && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground">
          Expand to see and edit the inner nodes.
        </div>
      )}
    </div>
  );
}
