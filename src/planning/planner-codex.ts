import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeminiAdapter } from "../providers/adapters/gemini.js";
import { validateDag } from "./dag-schema.js";
import type { DagSpec, TaskContract } from "../core/types.js";
import { REASON_CODES } from "../core/reason-codes.js";

export interface PlannerResult {
  dag: DagSpec;
  rawResponse: string;
  retries: number;
}

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string" },
          title: { type: "string" },
          provider: { type: "string", enum: ["codex", "claude", "gemini"] },
          type: { type: "string", enum: ["code", "refactor", "test", "docs", "deps", "repair"] },
          dependencies: {
            type: "array",
            items: { type: "string" }
          },
          writeScope: {
            type: "object",
            additionalProperties: false,
            properties: {
              allow: { type: "array", items: { type: "string" } },
              deny: { type: "array", items: { type: "string" } },
              ownership: { type: "string", enum: ["exclusive", "shared-serial", "shared-append"] },
              sharedKey: { type: ["string", "null"] }
            },
            required: ["allow", "deny", "ownership", "sharedKey"]
          },
          commandPolicy: {
            type: "object",
            additionalProperties: false,
            properties: {
              allow: { type: "array", items: { type: "string" } },
              deny: { type: "array", items: { type: "string" } },
              network: { type: "string", enum: ["deny", "allow"] }
            },
            required: ["allow", "deny", "network"]
          },
          expected: {
            type: "object",
            additionalProperties: false,
            properties: {
              files: { type: ["array", "null"], items: { type: "string" } },
              exports: {
                type: ["array", "null"],
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    file: { type: "string" },
                    name: { type: "string" },
                    kind: { type: "string", enum: ["function", "class", "type", "interface", "const"] }
                  },
                  required: ["file", "name", "kind"]
                }
              },
              tests: {
                type: ["array", "null"],
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    file: { type: "string" },
                    contains: { type: ["string", "null"] }
                  },
                  required: ["file", "contains"]
                }
              }
            },
            required: ["files", "exports", "tests"]
          },
          verify: {
            type: "object",
            additionalProperties: false,
            properties: {
              gateCommand: { type: ["string", "null"] },
              gateTimeoutSec: { type: ["number", "null"] },
              outputVerificationRequired: { type: "boolean" }
            },
            required: ["gateCommand", "gateTimeoutSec", "outputVerificationRequired"]
          },
          artifactIO: {
            type: "object",
            additionalProperties: false,
            properties: {
              consumes: { type: ["array", "null"], items: { type: "string" } },
              produces: { type: ["array", "null"], items: { type: "string" } }
            },
            required: ["consumes", "produces"]
          }
        },
        required: ["taskId", "title", "provider", "type", "dependencies", "writeScope", "commandPolicy", "expected", "verify", "artifactIO"]
      }
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" }
        },
        required: ["from", "to"]
      }
    }
  },
  required: ["nodes", "edges"]
};

function plannerPrompt(objective: string, repoContext: string, pendingTasks?: TaskContract[]): string {
  const lines = [
    "Generate a strict JSON DAG for a heterogeneous coding orchestrator.",
    "Rules:",
    "- Return JSON only.",
    "- Use TaskContract fields exactly.",
    "- Include write scopes and command policy for each task.",
    "- Keep dependencies explicit and acyclic.",
    `Objective: ${objective}`
  ];
  if (repoContext) {
    lines.push("\nRepository Context:");
    lines.push(repoContext);
  }
  if (pendingTasks && pendingTasks.length > 0) {
    lines.push("\nPreviously Planned & Pending Tasks (to be reviewed/dropped/modified):");
    lines.push(JSON.stringify(pendingTasks, null, 2));
  }
  return lines.join("\n");
}

export function extractJsonPayload(raw: string): unknown {
  // 1. Try to find JSON inside markdown code blocks
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches = [...raw.matchAll(markdownRegex)];
  for (const match of matches) {
    try {
      const inner = JSON.parse((match[1] ?? "").trim());
      if (inner && typeof inner === "object" && typeof (inner as any).response === "string") {
        return extractJsonPayload((inner as any).response);
      }
      return inner;
    } catch {
      // Continue searching
    }
  }

  // 2. Aggressive brace matching
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof (parsed as any).response === "string") {
        return extractJsonPayload((parsed as any).response);
      }
      return parsed;
    } catch {
      // Continue to line-by-line
    }
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      event &&
      typeof event === "object" &&
      (event as { type?: unknown }).type === "item.completed"
    ) {
      const item = (event as { item?: unknown }).item;
      if (item && typeof item === "object" && (item as { type?: unknown }).type === "agent_message") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") {
          try {
            return JSON.parse(text);
          } catch {
            // Continue scanning in case a later message is valid JSON.
          }
        }
      }
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && typeof (parsed as any).response === "string") {
        return extractJsonPayload((parsed as any).response);
      }
      return parsed;
    } catch {
      continue;
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as any).response === "string") {
      return extractJsonPayload((parsed as any).response);
    }
    return parsed;
  } catch {
    console.error("DEBUG: Failed to parse planner output as JSON. Length:", raw.length);
    if (raw.length > 0) {
      console.error("DEBUG: Start of output:", raw.slice(0, 500));
      console.error("DEBUG: End of output:", raw.slice(-500));
    }
    throw new Error("Planner returned non-JSON output");
  }
}

export async function generateDagWithCodex(objective: string, cwd: string, pendingTasks?: TaskContract[]): Promise<PlannerResult> {
  const adapter = new GeminiAdapter();
  const schemaPath = join(tmpdir(), `orch-planner-schema-${Date.now()}.json`);
  writeFileSync(schemaPath, JSON.stringify(PLANNER_SCHEMA), "utf8");

  let repoContext = "";
  try {
    const pkgJson = readFileSync(join(cwd, "package.json"), "utf8");
    repoContext += `package.json:\n${pkgJson}\n`;
  } catch {}

  let lastError: Error | undefined;
  let raw = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    process.stdout.write(`Planning attempt ${attempt}/3...\n`);
    const result = await adapter.execute({
      prompt: plannerPrompt(objective, repoContext, pendingTasks),
      cwd,
      timeoutMs: 180_000,
      executionMode: "host"
    });

    raw = result.stdout;

    if (result.exitCode !== 0) {
      process.stdout.write(`Attempt ${attempt} failed with exit code ${result.exitCode}.\n`);
      lastError = new Error(`Planner command failed (attempt ${attempt}): ${result.stderr || result.stdout}`);
      continue;
    }

    try {
      const parsed = extractJsonPayload(raw);
      const dag = validateDag(parsed);
      process.stdout.write(`Plan generated successfully on attempt ${attempt}.\n`);
      return { dag, rawResponse: raw, retries: attempt - 1 };
    } catch (error) {
      process.stdout.write(`Attempt ${attempt} failed schema validation: ${(error as Error).message}\n`);
      lastError = error as Error;
    }
  }

  const failure = new Error(`Planner failed after retries: ${lastError?.message ?? REASON_CODES.PLAN_PROVIDER_FAILED}`);
  (failure as Error & { reasonCode?: string }).reasonCode = REASON_CODES.PLAN_SCHEMA_INVALID;
  throw failure;
}
