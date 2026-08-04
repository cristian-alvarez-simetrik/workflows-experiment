
import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "./types";

export interface StoredWorkflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: Edge[];
  updatedAt: number;
}

const WORKFLOWS_KEY = "workflow-studio:workflows";
const ACTIVE_KEY = "workflow-studio:active";

/** Strip volatile runtime state before persisting. */
function serializeNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((n) => ({
    ...n,
    selected: false,
    data: { ...n.data, status: "idle" as const, output: undefined, error: undefined },
  }));
}

export function listWorkflows(): StoredWorkflow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WORKFLOWS_KEY);
    return raw ? (JSON.parse(raw) as StoredWorkflow[]) : [];
  } catch {
    return [];
  }
}

export function saveWorkflow(workflow: StoredWorkflow): void {
  const all = listWorkflows();
  const next = {
    ...workflow,
    nodes: serializeNodes(workflow.nodes),
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  window.localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(all));
}

export function deleteWorkflow(id: string): void {
  const all = listWorkflows().filter((w) => w.id !== id);
  window.localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(all));
}

export function deleteAllWorkflows(): void {
  window.localStorage.removeItem(WORKFLOWS_KEY);
}

export function getActiveWorkflowId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}

export function setActiveWorkflowId(id: string): void {
  window.localStorage.setItem(ACTIVE_KEY, id);
}

export function createWorkflow(name: string): StoredWorkflow {
  return {
    id: crypto.randomUUID(),
    name,
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}
