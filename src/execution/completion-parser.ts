export interface CompletionMarker {
  status: "success" | "fail" | "replan";
  files_changed: string[];
  summary: string;
  research?: string;
}

const MARKER_PREFIX = "__ORCH_DONE__:";

export function parseCompletionMarker(output: string): CompletionMarker | null {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(MARKER_PREFIX);
    if (idx < 0) {
      continue;
    }
    const payload = line.slice(idx + MARKER_PREFIX.length).trim();
    try {
      const parsed = JSON.parse(payload) as CompletionMarker;
      if (parsed.status === "success" || parsed.status === "fail" || parsed.status === "replan") {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}