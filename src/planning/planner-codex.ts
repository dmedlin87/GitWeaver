import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviderAdapter } from "../providers/adapters/index.js";
import { validateDag } from "./dag-schema.js";
import type { DagSpec, ProviderId, TaskContract } from "../core/types.js";
import { REASON_CODES } from "../core/reason-codes.js";

export interface PlannerResult {
  dag: DagSpec;
  rawResponse: string;
  retries: number;
  plannerProvider?: ProviderId;
}

export interface PlannerOptions {
  plannerProvider?: ProviderId;
}

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      minItems: 1,
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
              allow: { type: "array", items: { type: "string" }, minItems: 1 },
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

// Write the Codex output-schema file once at module load. PLANNER_SCHEMA is static
// data so a single stable file reused across all planning calls avoids temp-file
// accumulation (previously Date.now() produced a new file per plan invocation).
const _CODEX_SCHEMA_PATH = join(tmpdir(), "orch-planner-schema.json");
writeFileSync(_CODEX_SCHEMA_PATH, JSON.stringify(PLANNER_SCHEMA), "utf8");

function plannerPrompt(
  objective: string,
  repoContext: string,
  pendingTasks?: TaskContract[],
  includeSchema = false
): string {
  const lines = [
    "You are the Planner Agent for GitWeaver Orchestrator.",
    "Produce an execution-ready DAG that passes strict schema validation without human cleanup.",
    "",
    "NON-NEGOTIABLE OUTPUT CONTRACT:",
    "- Return exactly one JSON object with top-level keys: nodes, edges.",
    "- Return JSON only. No markdown, no explanation, no code fences, no surrounding prose.",
    "- Every node must include all required TaskContract fields.",
    "- writeScope.allow must contain explicit repo-relative paths or globs and must never be empty.",
    "- Never use full-repo wildcards as the only scope (for example: '*', '**', './', '.').",
    "- Keep dependencies explicit, acyclic, and consistent with edges.",
    "",
    "PLANNING QUALITY BAR:",
    "- Decompose objective into the smallest safe set of independently verifiable tasks.",
    "- Prefer 2-6 tasks unless objective complexity requires more.",
    "- Assign tight write scopes; each task should only touch files it must change.",
    "- Keep commandPolicy.allow minimal and task-specific.",
    "- Default commandPolicy.network to 'deny' unless network is truly required.",
    "- Fill expected.files/expected.exports/expected.tests with concrete assertions when knowable; otherwise use null.",
    "- Fill artifactIO.consumes/produces only when a task truly depends on generated artifacts; otherwise use null.",
    "",
    "PROVIDER ASSIGNMENT GUIDANCE:",
    "- Use codex for repair-heavy or architecture-sensitive tasks.",
    "- Use claude for most implementation, refactor, test, docs, and dependency tasks.",
    "- Use gemini when broad synthesis across many files is a strong requirement.",
    "",
    `OBJECTIVE: ${objective}`
  ];
  if (includeSchema) {
    lines.push(
      "",
      "AUTHORITATIVE JSON SCHEMA (do not add extra fields):",
      JSON.stringify(PLANNER_SCHEMA, null, 2)
    );
  }
  if (repoContext) {
    lines.push("", "REPOSITORY CONTEXT:");
    lines.push(repoContext);
  }
  if (pendingTasks && pendingTasks.length > 0) {
    lines.push("", "PREVIOUSLY PLANNED & PENDING TASKS (review, keep, modify, or drop):");
    lines.push(JSON.stringify(pendingTasks, null, 2));
  }
  return lines.join("\n");
}

function plannerProviderOrder(_objective: string, options: PlannerOptions = {}): ProviderId[] {
  if (options.plannerProvider) {
    return [options.plannerProvider];
  }
  // Temporary: route all planning through Gemini Flash
  return ["gemini", "claude"];
}

export function extractJsonPayload(raw: string): unknown {
  const unwrapEventPayload = (value: unknown): unknown => {
    if (value && typeof value === "object" && (value as { type?: unknown }).type === "item.completed") {
      const item = (value as { item?: unknown }).item;
      if (item && typeof item === "object" && (item as { type?: unknown }).type === "agent_message") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") {
          try {
            return JSON.parse(text);
          } catch {
            return value;
          }
        }
      }
    }
    return value;
  };

  // 1. Try to find JSON inside markdown code blocks
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches = [...raw.matchAll(markdownRegex)];
  for (const match of matches) {
    try {
      const inner = JSON.parse((match[1] ?? "").trim());
      if (inner && typeof inner === "object" && typeof (inner as any).response === "string") {
        return extractJsonPayload((inner as any).response);
      }
      return unwrapEventPayload(inner);
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
      return unwrapEventPayload(parsed);
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
      return unwrapEventPayload(parsed);
    } catch {
      continue;
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof (parsed as any).response === "string") {
      return extractJsonPayload((parsed as any).response);
    }
    return unwrapEventPayload(parsed);
  } catch {
    console.error("DEBUG: Failed to parse planner output as JSON. Length:", raw.length);
    if (raw.length > 0) {
      console.error("DEBUG: Start of output:", raw.slice(0, 500));
      console.error("DEBUG: End of output:", raw.slice(-500));
    }
    throw new Error("Planner returned non-JSON output");
  }
}

export async function generateDagWithCodex(
  objective: string,
  cwd: string,
  pendingTasks?: TaskContract[],
  options: PlannerOptions = {}
): Promise<PlannerResult> {
  let repoContext = "";
  try {
    const pkgJson = readFileSync(join(cwd, "package.json"), "utf8");
    repoContext += `package.json:\n${pkgJson}\n`;
  } catch {}

  let lastError: Error | undefined;
  let lastReasonCode: string = REASON_CODES.PLAN_PROVIDER_FAILED;
  let raw = "";
  const providers = plannerProviderOrder(objective, options);

  for (let attempt = 1; attempt <= providers.length; attempt += 1) {
    const provider = providers[attempt - 1]!;
    const adapter = getProviderAdapter(provider);
    process.stderr.write(`Planning attempt ${attempt}/${providers.length} with ${provider}...\n`);

    let result: Awaited<ReturnType<typeof adapter.execute>>;
    try {
      result = await adapter.execute({
        prompt: plannerPrompt(objective, repoContext, pendingTasks, provider !== "codex"),
        cwd,
        timeoutMs: 180_000,
        executionMode: "host",
        promptViaStdin: true,
        ...(provider === "codex" ? { outputSchemaPath: _CODEX_SCHEMA_PATH } : {})
      });
    } catch (execError) {
      const msg = (execError as Error).message ?? String(execError);
      process.stderr.write(`Attempt ${attempt} threw: ${msg}\n`);
      lastError = execError as Error;
      lastReasonCode = REASON_CODES.PLAN_PROVIDER_FAILED;
      continue;
    }

    raw = result.stdout;

    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).slice(0, 500);
      process.stderr.write(`Attempt ${attempt} failed with exit code ${result.exitCode}.\n`);
      process.stderr.write(`Provider output: ${detail}\n`);
      lastError = new Error(`Planner provider ${provider} failed (attempt ${attempt}): ${result.stderr || result.stdout}`);
      lastReasonCode = REASON_CODES.PLAN_PROVIDER_FAILED;
      continue;
    }

    try {
      const parsed = extractJsonPayload(raw);
      const dag = validateDag(parsed);
      process.stderr.write(`Plan generated successfully on attempt ${attempt} with ${provider}.\n`);
      return { dag, rawResponse: raw, retries: attempt - 1, plannerProvider: provider };
    } catch (error) {
      process.stderr.write(`Attempt ${attempt} failed schema validation: ${(error as Error).message}\n`);
      lastError = error as Error;
      lastReasonCode = REASON_CODES.PLAN_SCHEMA_INVALID;
    }
  }

  const failure = new Error(
    `Planner failed after trying providers (${providers.join(", ")}): ${lastError?.message ?? REASON_CODES.PLAN_PROVIDER_FAILED}`
  );
  (failure as Error & { reasonCode?: string }).reasonCode = lastReasonCode;
  throw failure;
}
