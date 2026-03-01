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
  sharedKey: z.string().nullish()
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
    files: z.array(z.string()).nullish(),
    exports: z.array(exportSchema).nullish(),
    tests: z.array(z.object({ file: z.string(), contains: z.string().nullish() })).nullish()
  }),
  verify: z.object({
    gateCommand: z.string().nullish(),
    gateTimeoutSec: z.number().int().positive().nullish(),
    outputVerificationRequired: z.boolean().default(true)
  }),
  artifactIO: z.object({
    consumes: z.array(z.string()).nullish(),
    produces: z.array(z.string()).nullish()
  }),
  contractHash: z.string().optional()
});

const looseTaskSchema = z.object({
  id: z.string().optional(),
  taskId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  goal: z.string().optional(),
  provider: z.enum(["codex", "claude", "gemini"]).optional().default("claude"),
  type: z.enum(["code", "refactor", "test", "docs", "deps", "repair"]).optional().default("code"),
  dependencies: z.array(z.string()).default([]),
  write_scopes: z.array(z.string()).optional(),
  writeScope: writeScopeSchema.optional(),
  command_policy: z.union([z.string(), z.array(z.string())]).optional(),
  commandPolicy: z.any().optional()
});

export const dagSchema = z.union([
  z.object({
    nodes: z.array(taskContractSchema).min(1),
    edges: z.array(z.object({ from: z.string(), to: z.string() })).default([])
  }),
  z.object({
    tasks: z.array(looseTaskSchema).min(1)
  })
]);

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
  const rawParsed = dagSchema.parse(input);
  
  if ("tasks" in rawParsed) {
    // Normalize loose tasks format to strict nodes/edges
    const nodes: TaskContract[] = rawParsed.tasks.map(t => {
      const taskId = t.taskId || t.id || `task-${Math.random().toString(36).slice(2, 7)}`;
      const title = t.title || t.description || t.goal || taskId;
      const allow = t.writeScope?.allow || t.write_scopes || ["./"];
      
      const withoutHash = {
        taskId,
        title,
        provider: t.provider as any,
        type: t.type as any,
        dependencies: t.dependencies,
        writeScope: {
          allow,
          deny: t.writeScope?.deny || [],
          ownership: t.writeScope?.ownership || "exclusive",
          sharedKey: t.writeScope?.sharedKey || undefined
        },
        commandPolicy: {
          allow: Array.isArray(t.command_policy) ? t.command_policy : (typeof t.command_policy === "string" ? [t.command_policy] : []),
          deny: [],
          network: "deny" as const
        },
        expected: {},
        verify: { outputVerificationRequired: true },
        artifactIO: {}
      };
      return {
        ...withoutHash,
        contractHash: hashTask(withoutHash as any)
      };
    });
    const spec = { nodes, edges: [] };
    ensureAcyclic(spec);
    return { ...spec, dagHash: sha256(stableStringify(spec)) };
  }

  const parsed = rawParsed as { nodes: any[], edges: any[] };
  const nodes: TaskContract[] = parsed.nodes.map((node) => {
    const withoutHash = {
      taskId: node.taskId,
      title: node.title,
      provider: node.provider,
      type: node.type,
      dependencies: node.dependencies,
      writeScope: {
        ...node.writeScope,
        sharedKey: node.writeScope.sharedKey ?? undefined
      },
      commandPolicy: node.commandPolicy,
      expected: {
        files: node.expected.files ?? undefined,
        exports: node.expected.exports ?? undefined,
        tests: node.expected.tests?.map((test: { file: string; contains?: string | null }) => ({
          file: test.file,
          contains: test.contains ?? undefined
        })) ?? undefined
      },
      verify: {
        gateCommand: node.verify.gateCommand ?? undefined,
        gateTimeoutSec: node.verify.gateTimeoutSec ?? undefined,
        outputVerificationRequired: node.verify.outputVerificationRequired
      },
      artifactIO: {
        consumes: node.artifactIO.consumes ?? undefined,
        produces: node.artifactIO.produces ?? undefined
      }
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
