import { Minimatch } from "minimatch";

export function extractFilesFromError(errorText: string, allowPatterns: string[]): string[] {
  // Allow backslashes in path match for Windows support
  const fileLike = errorText.match(/[\w./\-\\]+\.\w+/g) ?? [];
  const candidates = [...new Set(fileLike)];
  const result: string[] = [];

  // ⚡ Bolt: Pre-compile minimatch patterns to avoid redundant parsing in the loop
  // 💡 What: Instantiating Minimatch objects once per pattern instead of calling minimatch() for every file candidate.
  // 🎯 Why: minimatch() parses the pattern string every time it's called. This avoids O(N*M) redundant parsing cost.
  // 📊 Impact: Significantly faster file extraction for errors containing many file paths.
  const nocase = process.platform === "win32";
  const compiledAllow = allowPatterns.map((p) => new Minimatch(p, { dot: true, nocase }));

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, "/");
    const matches = compiledAllow.some((m) => m.match(normalized));
    if (matches) {
      result.push(normalized);
    }
  }
  return [...new Set(result)];
}
