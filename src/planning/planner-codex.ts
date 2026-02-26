import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter } from "../providers/adapters/codex.js";
import { validateDag } from "./dag-schema.js";
import type { DagSpec } from "../core/types.js";
import { REASON_CODES } from "../core/reason-codes.js";

export interface PlannerResult {
  dag: DagSpec;
  rawResponse: string;
  retries: number;
}

const PLANNER_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array"
    },
    edges: {
      type: "array"
    }
  },
  required: ["nodes", "edges"]
};

function plannerPrompt(objective: string): string {
  return [
    "Generate a strict JSON DAG for a heterogeneous coding orchestrator.",
    "Rules:",
    "- Return JSON only.",
    "- Use TaskContract fields exactly.",
    "- Include write scopes and command policy for each task.",
    "- Keep dependencies explicit and acyclic.",
    `Objective: ${objective}`
  ].join("\n");
}

function extractJsonPayload(raw: string): unknown {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Planner returned non-JSON output");
  }
}

export async function generateDagWithCodex(objective: string, cwd: string): Promise<PlannerResult> {
  const adapter = new CodexAdapter();
  const schemaPath = join(tmpdir(), `orch-planner-schema-${Date.now()}.json`);
  writeFileSync(schemaPath, JSON.stringify(PLANNER_SCHEMA), "utf8");

  let lastError: Error | undefined;
  let raw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await adapter.execute({
      prompt: plannerPrompt(objective),
      cwd,
      timeoutMs: 180_000,
      outputSchemaPath: schemaPath
    });

    raw = result.stdout;

    if (result.exitCode !== 0) {
      lastError = new Error(`Planner command failed (attempt ${attempt}): ${result.stderr || result.stdout}`);
      continue;
    }

    try {
      const parsed = extractJsonPayload(raw);
      const dag = validateDag(parsed);
      return { dag, rawResponse: raw, retries: attempt - 1 };
    } catch (error) {
      lastError = error as Error;
    }
  }

  const failure = new Error(`Planner failed after retries: ${lastError?.message ?? REASON_CODES.PLAN_PROVIDER_FAILED}`);
  (failure as Error & { reasonCode?: string }).reasonCode = REASON_CODES.PLAN_SCHEMA_INVALID;
  throw failure;
}
