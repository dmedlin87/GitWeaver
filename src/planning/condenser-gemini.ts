import { getProviderAdapter } from "../providers/adapters/index.js";
import type { TaskRecord } from "../core/types.js";

const MAX_NARRATIVE_CHARS = 4_000;

function condenserPrompt(objective: string, tasks: TaskRecord[], previousNarrative?: string): string {
  const taskLines = tasks.map(t => `- ${t.taskId}: ${t.summary || "No summary"}`).join("\n");

  return [
    "You are a 'Condenser Agent' for an autonomous coding orchestrator.",
    "Your goal is to rewrite the project history into a single, cohesive narrative paragraph.",
    "",
    `Global Objective: ${objective}`,
    "",
    previousNarrative ? `Previous Narrative:\n${previousNarrative}\n` : "",
    "New Tasks to integrate:",
    taskLines,
    "",
    "Rules:",
    "- Output ONLY the new narrative paragraph.",
    "- Be concise but preserve key architectural decisions.",
    "- Use the past tense (e.g., 'Authentication was implemented and stabilized...').",
    "- Do not use bullet points or lists.",
    "- Focus on the 'Story So Far'.",
    `- Keep the output under ${MAX_NARRATIVE_CHARS} characters.`
  ].join("\n");
}

export async function condenseHistory(
  objective: string,
  newTasks: TaskRecord[],
  cwd: string,
  previousNarrative?: string
): Promise<string> {
  // Use the provider registry so health checks and rate-limit tracking apply.
  // Narrative condensation is non-critical; fall back to the previous narrative
  // (or empty string) on any failure rather than surfacing a hard error.
  let result: Awaited<ReturnType<ReturnType<typeof getProviderAdapter>["execute"]>>;
  try {
    const adapter = getProviderAdapter("gemini");
    result = await adapter.execute({
      prompt: condenserPrompt(objective, newTasks, previousNarrative),
      cwd,
      timeoutMs: 60_000,
      executionMode: "host"
    });
  } catch (err) {
    process.stderr.write(`Condenser skipped (provider error): ${(err as Error).message}\n`);
    return previousNarrative ?? "";
  }

  if (result.exitCode !== 0) {
    process.stderr.write(`Condenser skipped (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 200)}\n`);
    return previousNarrative ?? "";
  }

  const narrative = result.stdout.trim();

  if (narrative.length === 0) {
    process.stderr.write("Condenser returned empty output; retaining previous narrative.\n");
    return previousNarrative ?? "";
  }

  if (narrative.length > MAX_NARRATIVE_CHARS) {
    // Truncate rather than discard — a long narrative is still better than nothing.
    process.stderr.write(`Condenser output truncated from ${narrative.length} to ${MAX_NARRATIVE_CHARS} chars.\n`);
    return narrative.slice(0, MAX_NARRATIVE_CHARS);
  }

  return narrative;
}
