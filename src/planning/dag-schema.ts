import { z } from "zod";
import { sha256, stableStringify } from "../core/hash.js";
import type { DagSpec, TaskContract } from "../core/types.js";

const exportSchema = z.object({
  file: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["function", "class", "type", "interface", "const"])
});

const writeScopeSchema = z.object({
  allow: z.array(z.string().min(1)).min(1),
  deny: z.array(z.string()).default([]),
  ownership: z.enum(["exclusive", "shared-serial", "shared-append"]),
  sharedKey: z.string().optional()
});

const taskContractSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  provider: z.enum(["codex", "claude", "gemini"]),
  type: z.enum(["code", "refactor", "test", "docs", "deps", "repair"]),
  dependencies: z.array(z.string()).default([]),
  writeScope: writeScopeSchema,
  commandPolicy: z.object({
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
    network: z.enum(["deny", "allow"]).default("deny")
  }),
  expected: z.object({
    files: z.array(z.string()).optional(),
    exports: z.array(exportSchema).optional(),
    tests: z.array(z.object({ file: z.string(), contains: z.string().optional() })).optional()
  }),
  verify: z.object({
    gateCommand: z.string().optional(),
    gateTimeoutSec: z.number().int().positive().optional(),
    outputVerificationRequired: z.boolean().default(true)
  }),
  artifactIO: z.object({
    consumes: z.array(z.string()).optional(),
    produces: z.array(z.string()).optional()
  }),
  contractHash: z.string().optional()
});

export const dagSchema = z.object({
  nodes: z.array(taskContractSchema).min(1),
  edges: z.array(z.object({ from: z.string(), to: z.string() })).default([])
});

export type DagInput = z.input<typeof dagSchema>;

function ensureAcyclic(spec: DagSpec): void {
  const dependencies = new Map<string, string[]>();
  for (const node of spec.nodes) {
    dependencies.set(node.taskId, [...node.dependencies]);
  }
  for (const edge of spec.edges) {
    dependencies.set(edge.to, [...(dependencies.get(edge.to) ?? []), edge.from]);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  const walk = (node: string): void => {
    if (stack.has(node)) {
      throw new Error(`Cycle detected at node ${node}`);
    }
    if (visited.has(node)) {
      return;
    }
    stack.add(node);
    for (const dep of dependencies.get(node) ?? []) {
      walk(dep);
    }
    stack.delete(node);
    visited.add(node);
  };

  for (const node of spec.nodes) {
    walk(node.taskId);
  }
}

function hashTask(task: Omit<TaskContract, "contractHash">): string {
  return sha256(stableStringify(task));
}

export function validateDag(input: unknown): DagSpec {
  const parsed = dagSchema.parse(input);
  const nodes: TaskContract[] = parsed.nodes.map((node) => {
    const withoutHash = {
      taskId: node.taskId,
      title: node.title,
      provider: node.provider,
      type: node.type,
      dependencies: node.dependencies,
      writeScope: node.writeScope,
      commandPolicy: node.commandPolicy,
      expected: node.expected,
      verify: node.verify,
      artifactIO: node.artifactIO
    };

    return {
      ...withoutHash,
      contractHash: node.contractHash ?? hashTask(withoutHash)
    };
  });

  const spec: DagSpec = {
    nodes,
    edges: parsed.edges
  };

  ensureAcyclic(spec);
  return {
    ...spec,
    dagHash: sha256(stableStringify(spec))
  };
}