export interface CompletionMarker {
  status: "success" | "fail" | "replan";
  files_changed: string[];
  summary: string;
  research?: string;
}

const MARKER_PREFIX = "__ORCH_DONE__:";

export function parseCompletionMarker(output: string): CompletionMarker | null {
  // ⚡ Bolt: Use indexOf instead of split to avoid redundant array allocations and O(N) memory overhead
  // 💡 What: Find markers with indexOf and slice strings lazily instead of splitting the entire execution output.
  // 🎯 Why: output.split() creates an array of all lines in memory. For large execution logs (e.g. 100k+ lines), this creates massive CPU/memory bottlenecks.
  let searchIdx = 0;
  while (true) {
    const idx = output.indexOf(MARKER_PREFIX, searchIdx);
    if (idx < 0) {
      break;
    }

    let lineEnd = output.indexOf("\n", idx);
    if (lineEnd < 0) {
      lineEnd = output.length;
    }

    const payload = output.substring(idx + MARKER_PREFIX.length, lineEnd).trim();
    try {
      const parsed = JSON.parse(payload) as CompletionMarker;
      if (parsed.status === "success" || parsed.status === "fail" || parsed.status === "replan") {
        return parsed;
      }
    } catch {
      return null;
    }
    searchIdx = lineEnd;
  }
  return null;
}