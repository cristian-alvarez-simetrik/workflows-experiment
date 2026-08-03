"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Code2,
  Database,
  FileUp,
  Loader2,
  Play,
  Plus,
  Table2,
  TableProperties,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { listTables } from "@/lib/db";
import { runNodes, withDownstream } from "@/lib/engine";
import { appendRun, type RunNodeEntry } from "@/lib/run-history";
import type { QueryResult, WorkflowNode, WorkflowNodeType } from "@/lib/types";
import {
  createWorkflow,
  deleteWorkflow,
  getActiveWorkflowId,
  listWorkflows,
  saveWorkflow,
  setActiveWorkflowId,
  type StoredWorkflow,
} from "@/lib/workflow-store";
import { FileNode, ScriptNode, SqlNode, VizNode } from "./nodes";
import { RunContext } from "./run-context";
import { RunHistoryDrawer } from "./run-history-drawer";

const nodeTypes: NodeTypes = {
  file: FileNode,
  sql: SqlNode,
  script: ScriptNode,
  viz: VizNode,
};

let nodeCounter = 0;

function makeNode(type: WorkflowNodeType, position: { x: number; y: number }): WorkflowNode {
  const id = `${type}-${crypto.randomUUID().slice(0, 8)}`;
  nodeCounter += 1;
  const base = { status: "idle" as const };
  const data = {
    file: { ...base, label: `File ${nodeCounter}`, tableName: "", parserScript: "" },
    sql: { ...base, label: `SQL ${nodeCounter}`, sql: "" },
    script: { ...base, label: `Script ${nodeCounter}`, code: "" },
    viz: { ...base, label: `Viz ${nodeCounter}`, sql: "" },
  }[type];
  return { id, type, position, data };
}

function TablesPopover() {
  const [tables, setTables] = useState<{ name: string; rowCount: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setTables(await listTables());
    } catch (err) {
      toast.error("Could not list tables", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover onOpenChange={(open) => open && void refresh()}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <TableProperties className="h-4 w-4" />
          Tables
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
          PGlite tables
        </div>
        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tables.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No tables yet — run a file node to load data.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tables.map((t) => (
              <li
                key={t.name}
                className="flex items-center justify-between rounded px-1.5 py-1 text-xs hover:bg-accent"
              >
                <span className="font-mono">{t.name}</span>
                <span className="text-muted-foreground">{t.rowCount} rows</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<never>([]);
  const [workflows, setWorkflows] = useState<StoredWorkflow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [runsVersion, setRunsVersion] = useState(0);
  const loaded = useRef(false);

  // Load workflows on mount; create a default one if none exist.
  useEffect(() => {
    let all = listWorkflows();
    if (all.length === 0) {
      const wf = createWorkflow("My first workflow");
      saveWorkflow(wf);
      all = [wf];
    }
    const active =
      all.find((w) => w.id === getActiveWorkflowId()) ?? all[0];
    setWorkflows(all);
    setActiveId(active.id);
    setNodes(active.nodes);
    setEdges(active.edges as never[]);
    setActiveWorkflowId(active.id);
    loaded.current = true;
  }, [setNodes, setEdges]);

  // Debounced autosave of the active workflow.
  useEffect(() => {
    if (!loaded.current || !activeId) return;
    const timer = setTimeout(() => {
      const current = listWorkflows().find((w) => w.id === activeId);
      if (!current) return;
      saveWorkflow({ ...current, nodes, edges });
      setWorkflows(listWorkflows());
    }, 600);
    return () => clearTimeout(timer);
  }, [nodes, edges, activeId]);

  const activeWorkflow = workflows.find((w) => w.id === activeId);

  const switchWorkflow = (id: string) => {
    const wf = listWorkflows().find((w) => w.id === id);
    if (!wf) return;
    setActiveId(id);
    setActiveWorkflowId(id);
    setNodes(wf.nodes);
    setEdges(wf.edges as never[]);
  };

  const addWorkflow = () => {
    const wf = createWorkflow(`Workflow ${listWorkflows().length + 1}`);
    saveWorkflow(wf);
    setWorkflows(listWorkflows());
    switchWorkflow(wf.id);
  };

  const removeWorkflow = () => {
    if (!activeId) return;
    deleteWorkflow(activeId);
    let all = listWorkflows();
    if (all.length === 0) {
      const wf = createWorkflow("My first workflow");
      saveWorkflow(wf);
      all = [wf];
    }
    setWorkflows(all);
    switchWorkflow(all[0].id);
  };

  const renameWorkflow = (name: string) => {
    if (!activeId) return;
    const wf = listWorkflows().find((w) => w.id === activeId);
    if (!wf) return;
    saveWorkflow({ ...wf, name, nodes, edges });
    setWorkflows(listWorkflows());
  };

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds) as never[]),
    [setEdges]
  );

  const addNode = (type: WorkflowNodeType) => {
    const position = {
      x: 120 + (nodes.length % 4) * 90,
      y: 100 + (nodes.length % 5) * 70,
    };
    setNodes((nds) => [...nds, makeNode(type, position)]);
  };

  const patchNode = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [setNodes]
  );

  const execute = useCallback(
    async (targets: WorkflowNode[], allNodes: WorkflowNode[], trigger: string) => {
      if (targets.length === 0) {
        toast.info("Nothing to run — add some nodes first.");
        return;
      }
      setIsRunning(true);
      let hadError = false;

      const byId = new Map(allNodes.map((n) => [n.id, n]));
      const startTimes = new Map<string, number>();
      const entries: RunNodeEntry[] = [];
      const startedAt = Date.now();

      const summarize = (patch: Record<string, unknown>): string | undefined => {
        if (typeof patch.rowCount === "number") {
          return `${patch.rowCount} rows loaded`;
        }
        const result = patch.lastResult as QueryResult | undefined;
        if (result) return `${result.rows.length} rows`;
        if (typeof patch.lastValue === "string") {
          const oneLine = patch.lastValue.replace(/\s+/g, " ").trim();
          return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
        }
        return undefined;
      };

      const entryBase = (id: string) => {
        const node = byId.get(id);
        return {
          nodeId: id,
          label: (node?.data.label as string) ?? id,
          type: node?.type ?? "unknown",
          durationMs: performance.now() - (startTimes.get(id) ?? performance.now()),
        };
      };

      try {
        await runNodes(targets, allNodes, edges, {
          onNodeStart: (id) => {
            startTimes.set(id, performance.now());
            patchNode(id, { status: "running", error: undefined });
          },
          onNodeSuccess: (id, patch) => {
            entries.push({
              ...entryBase(id),
              status: "success",
              summary: summarize(patch),
              logs: patch.logs as string[] | undefined,
            });
            patchNode(id, { ...patch, status: "success" });
          },
          onNodeError: (id, error) => {
            hadError = true;
            entries.push({
              ...entryBase(id),
              status: error.startsWith("Skipped:") ? "skipped" : "error",
              error,
            });
            patchNode(id, { status: "error", error });
          },
        });
      } catch (err) {
        toast.error("Run failed", {
          description: err instanceof Error ? err.message : String(err),
        });
        hadError = true;
      } finally {
        setIsRunning(false);
      }

      if (activeId) {
        appendRun({
          id: crypto.randomUUID(),
          workflowId: activeId,
          trigger,
          startedAt,
          finishedAt: Date.now(),
          status: hadError ? "error" : "success",
          nodes: entries,
        });
        setRunsVersion((v) => v + 1);
      }
      if (!hadError) toast.success("Run completed");
    },
    [edges, patchNode, activeId]
  );

  const runAll = useCallback(() => {
    void execute(nodes, nodes, "Run all");
  }, [execute, nodes]);

  const runNode = useCallback(
    (id: string) => {
      const start = nodes.find((n) => n.id === id);
      void execute(
        withDownstream(id, nodes, edges),
        nodes,
        `Run: ${(start?.data.label as string) ?? id}`
      );
    },
    [execute, nodes, edges]
  );

  const runner = useMemo(() => ({ runNode, isRunning }), [runNode, isRunning]);

  return (
    <TooltipProvider>
      <RunContext.Provider value={runner}>
        <div className="flex h-screen flex-col">
          <header className="flex items-center gap-2 border-b px-4 py-2">
            <Workflow className="h-5 w-5 text-primary" />
            <h1 className="mr-2 text-sm font-semibold">Workflow Studio</h1>

            {renaming ? (
              <Input
                autoFocus
                defaultValue={activeWorkflow?.name}
                className="h-8 w-52"
                onBlur={(e) => {
                  renameWorkflow(e.target.value || "Untitled");
                  setRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <Select value={activeId ?? undefined} onValueChange={switchWorkflow}>
                <SelectTrigger
                  size="sm"
                  className="w-52"
                  onDoubleClick={() => setRenaming(true)}
                >
                  <SelectValue placeholder="Select workflow" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button variant="ghost" size="sm" onClick={addWorkflow}>
              <Plus className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workflow?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{activeWorkflow?.name}” and its node graph will be removed
                    from local storage. Tables already loaded into PGlite are kept.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={removeWorkflow}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Separator orientation="vertical" className="mx-1 !h-6" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  Add node
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80">
                <DropdownMenuItem onClick={() => addNode("file")}>
                  <FileUp className="h-4 w-4 text-amber-400" />
                  File — load csv/json/txt into a table
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addNode("script")}>
                  <Code2 className="h-4 w-4 text-violet-400" />
                  Script — validations, build SQL
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addNode("sql")}>
                  <Database className="h-4 w-4 text-sky-400" />
                  SQL — execute against PGlite
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addNode("viz")}>
                  <Table2 className="h-4 w-4 text-emerald-400" />
                  Visualization — query results table
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto flex items-center gap-2">
              <RunHistoryDrawer workflowId={activeId} refreshKey={runsVersion} />
              <TablesPopover />
              <Button size="sm" onClick={runAll} disabled={isRunning}>
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run all
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
              zoomOnDoubleClick={false}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
              <Controls />
              <MiniMap pannable zoomable className="!bg-card" />
            </ReactFlow>
          </div>
        </div>
      </RunContext.Provider>
    </TooltipProvider>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
