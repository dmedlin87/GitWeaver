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
              files: { type: "array", items: { type: "string" } },
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
