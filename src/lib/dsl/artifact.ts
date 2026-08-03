/** Compiled artifact: the portable JSON output of the `compilar` step. */

import type { LogicalPlan } from "./plan";
import type { SqlStatement } from "./sql-compiler";

export interface CompiledArtifact {
  compilerVersion: string;
  dslVersion: string;
  processName: string;
  source: { connection: string; schema: string; table: string };
  target: {
    connection: string;
    schema: string;
    table: string;
    mode: "replace";
  };
  parameters: {
    name: string;
    required: boolean;
    defaultValue?: string | number | boolean | null;
  }[];
  parameterOrder: string[];
  parameterDefaults: Record<string, string | number | boolean | null>;
  outputSchema: { name: string; type: string }[];
  statements: SqlStatement[];
  sourceHash: string;
}

export const COMPILER_VERSION = "0.1.0";
export const DSL_VERSION = "0.1.0";

/** Normalize the DSL source before hashing: LF endings, no trailing blanks. */
export function normalizeSource(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildArtifact(
  source: string,
  plan: LogicalPlan,
  scanInfo: { connection: string; schema: string; table: string },
  statements: SqlStatement[]
): Promise<CompiledArtifact> {
  const parameterDefaults: Record<string, string | number | boolean | null> =
    {};
  for (const parameter of plan.parameters) {
    if (!parameter.required) {
      parameterDefaults[parameter.name] = parameter.defaultValue ?? null;
    }
  }

  return {
    compilerVersion: COMPILER_VERSION,
    dslVersion: DSL_VERSION,
    processName: plan.processName,
    source: scanInfo,
    target: {
      connection: plan.sourceConnection,
      schema: plan.output.schema,
      table: plan.output.table,
      mode: "replace",
    },
    parameters: plan.parameters.map((p) => ({
      name: p.name,
      required: p.required,
      ...(p.required ? {} : { defaultValue: p.defaultValue ?? null }),
    })),
    parameterOrder: plan.parameterOrder,
    parameterDefaults,
    outputSchema: plan.outputSchema.map((c) => ({
      name: c.name,
      type: c.type.kind,
    })),
    statements,
    sourceHash: await sha256Hex(normalizeSource(source)),
  };
}
