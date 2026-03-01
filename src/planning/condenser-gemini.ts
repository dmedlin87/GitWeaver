import { GeminiAdapter } from "../providers/adapters/gemini.js";
import type { TaskRecord } from "../core/types.js";

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
    "- Focus on the 'Story So Far'."
  ].join("\n");
}

export async function condenseHistory(
  objective: string,
  newTasks: TaskRecord[],
  cwd: string,
  previousNarrative?: string
): Promise<string> {
  const adapter = new GeminiAdapter();
  
  const result = await adapter.execute({
    prompt: condenserPrompt(objective, newTasks, previousNarrative),
    cwd,
    timeoutMs: 60_000,
    executionMode: "host" // Condenser is low-risk, host mode is fine
  });

  if (result.exitCode !== 0) {
    throw new Error(`Condenser failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}
