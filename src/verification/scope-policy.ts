import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { minimatch } from "minimatch";

export interface ScopeEvaluation {
  allowed: boolean;
  violations: string[];
  normalizedFiles: string[];
}

function normalizeForComparison(path: string): string {
  const normalized = normalize(path).split("\\").join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function canonicalize(repoRoot: string, inputPath: string): string | null {
  const absolute = isAbsolute(inputPath) ? inputPath : join(repoRoot, inputPath);
  const normalized = normalize(absolute);

  let real: string;
  try {
    real = existsSync(normalized) ? realpathSync(normalized) : normalize(normalized);
  } catch {
    real = normalize(normalized);
  }

  const rel = relative(repoRoot, real);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return null;
  }

  if (existsSync(normalized)) {
    try {
      const stat = lstatSync(normalized);
      if (stat.isSymbolicLink()) {
        const linkReal = realpathSync(normalized);
        const linkRel = relative(repoRoot, linkReal);
        if (linkRel.startsWith("..") || linkRel.includes(`..${sep}`)) {
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  return normalizeForComparison(rel);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true, nocase: process.platform === "win32" }));
}

export function evaluateScope(
  repoRoot: string,
  changedFiles: string[],
  allowPatterns: string[],
  denyPatterns: string[]
): ScopeEvaluation {
  const violations: string[] = [];
  const normalizedFiles: string[] = [];

  for (const file of changedFiles) {
    const canonical = canonicalize(repoRoot, file);
    if (!canonical) {
      violations.push(`${file}: path escapes repository root or symlink target is external`);
      continue;
    }

    normalizedFiles.push(canonical);

    if (matchesAny(canonical, denyPatterns)) {
      violations.push(`${canonical}: denylist match`);
      continue;
    }

    if (!matchesAny(canonical, allowPatterns)) {
      violations.push(`${canonical}: not in allowlist`);
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    normalizedFiles
  };
}