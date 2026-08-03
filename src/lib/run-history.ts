"use client";

export type RunNodeStatus = "success" | "error" | "skipped";

export interface RunNodeEntry {
  nodeId: string;
  label: string;
  type: string;
  status: RunNodeStatus;
  durationMs: number;
  /** Short human summary, e.g. "5 rows loaded". */
  summary?: string;
  error?: string;
  /** Script node log() output. */
  logs?: string[];
}

export interface RunRecord {
  id: string;
  workflowId: string;
  /** What started the run: "Run all" or the node it started from. */
  trigger: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "error";
  nodes: RunNodeEntry[];
}

const KEY_PREFIX = "workflow-studio:runs:";
const MAX_RUNS = 50;

export function listRuns(workflowId: string): RunRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + workflowId);
    return raw ? (JSON.parse(raw) as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendRun(run: RunRecord): void {
  const runs = [run, ...listRuns(run.workflowId)].slice(0, MAX_RUNS);
  try {
    window.localStorage.setItem(
      KEY_PREFIX + run.workflowId,
      JSON.stringify(runs)
    );
  } catch {
    // quota exceeded — drop the oldest half and retry once
    try {
      window.localStorage.setItem(
        KEY_PREFIX + run.workflowId,
        JSON.stringify(runs.slice(0, Math.ceil(runs.length / 2)))
      );
    } catch {
      // give up silently; history is best-effort
    }
  }
}

export function clearRuns(workflowId: string): void {
  window.localStorage.removeItem(KEY_PREFIX + workflowId);
}
