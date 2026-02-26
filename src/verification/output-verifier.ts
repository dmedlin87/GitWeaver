import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Project } from "ts-morph";
import type { TaskContract } from "../core/types.js";

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

function checkExpectedFiles(repoPath: string, task: TaskContract, errors: string[]): void {
  for (const file of task.expected.files ?? []) {
    const absolute = join(repoPath, file);
    if (!existsSync(absolute)) {
      errors.push(`Expected file missing: ${file}`);
    }
  }
}

function checkExpectedTests(repoPath: string, task: TaskContract, errors: string[]): void {
  for (const test of task.expected.tests ?? []) {
    const absolute = join(repoPath, test.file);
    if (!existsSync(absolute)) {
      errors.push(`Expected test file missing: ${test.file}`);
      continue;
    }
    if (test.contains) {
      const content = readFileSync(absolute, "utf8");
      if (!content.includes(test.contains)) {
        errors.push(`Expected snippet not found in test file ${test.file}`);
      }
    }
  }
}

function checkExpectedExports(repoPath: string, task: TaskContract, errors: string[]): void {
  if (!task.expected.exports || task.expected.exports.length === 0) {
    return;
  }

  const project = new Project({
    tsConfigFilePath: existsSync(join(repoPath, "tsconfig.json")) ? join(repoPath, "tsconfig.json") : undefined,
    skipAddingFilesFromTsConfig: false
  });

  for (const expected of task.expected.exports) {
    const source = project.getSourceFile(join(repoPath, expected.file)) ?? project.addSourceFileAtPathIfExists(join(repoPath, expected.file));
    if (!source) {
      errors.push(`Expected export file missing: ${expected.file}`);
      continue;
    }
    const symbol = source.getExportSymbols().find((candidate) => candidate.getName() === expected.name);
    if (!symbol) {
      errors.push(`Expected export not found: ${expected.file}#${expected.name}`);
      continue;
    }

    const declarations = symbol.getDeclarations();
    if (declarations.length === 0) {
      errors.push(`Export has no declarations: ${expected.file}#${expected.name}`);
      continue;
    }

    const declaration = declarations[0];
    if (!declaration) {
      errors.push(`Export declaration missing: ${expected.file}#${expected.name}`);
      continue;
    }
    const kindName = declaration.getKindName().toLowerCase();
    if (!kindName.includes(expected.kind)) {
      errors.push(`Export kind mismatch for ${expected.file}#${expected.name}; expected ${expected.kind}, got ${kindName}`);
    }
  }
}

export function verifyTaskOutput(repoPath: string, task: TaskContract): VerifyResult {
  const errors: string[] = [];
  checkExpectedFiles(repoPath, task, errors);
  checkExpectedTests(repoPath, task, errors);
  checkExpectedExports(repoPath, task, errors);

  return {
    ok: errors.length === 0,
    errors
  };
}
