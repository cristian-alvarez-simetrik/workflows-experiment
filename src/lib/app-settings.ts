/** App-level settings persisted in localStorage. */

import type { WorkflowNodeType } from "./types";

const ADVANCED_KEY = "workflow-studio:advanced-mode";

/** Node types available by default: the DSL-first experience. */
const BASIC_NODE_TYPES: WorkflowNodeType[] = ["file", "dsl"];

/** Everything the canvas supports (groups are created only by templates). */
const ADVANCED_NODE_TYPES: WorkflowNodeType[] = [
  "file",
  "dsl",
  "form",
  "script",
  "sql",
  "viz",
];

export function isAdvancedMode(): boolean {
  return localStorage.getItem(ADVANCED_KEY) === "true";
}

export function setAdvancedMode(enabled: boolean): void {
  localStorage.setItem(ADVANCED_KEY, String(enabled));
}

/**
 * Node types that can currently be created — by the user (Add node menu)
 * and by the assistant (add_node tool, system prompt).
 */
export function enabledNodeTypes(): WorkflowNodeType[] {
  return isAdvancedMode() ? ADVANCED_NODE_TYPES : BASIC_NODE_TYPES;
}
