import { minimatch } from "minimatch";

export function extractFilesFromError(errorText: string, allowPatterns: string[]): string[] {
  // Allow backslashes in path match for Windows support
  const fileLike = errorText.match(/[\w./\-\\]+\.\w+/g) ?? [];
  const candidates = [...new Set(fileLike)];
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, "/");
    const matches = allowPatterns.some((pattern) =>
      minimatch(normalized, pattern, { dot: true, nocase: process.platform === "win32" })
    );
    if (matches) {
      result.push(normalized);
    }
  }
  return [...new Set(result)];
}
