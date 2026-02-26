import { sha256, stableStringify } from "../core/hash.js";
import type { DagSpec, TaskContract } from "../core/types.js";

export interface FrozenPlan {
  dag: DagSpec;
  taskContractHashes: Record<string, string>;
  immutablePlanHash: string;
}

function freezeTask(task: TaskContract): TaskContract {
  const stableTask = {
    ...task,
    contractHash: task.contractHash || ""
  };
  const hash = sha256(stableStringify({ ...stableTask, contractHash: undefined }));
  return {
    ...task,
    contractHash: hash
  };
}

export function freezePlan(dag: DagSpec): FrozenPlan {
  // Sort nodes and edges for deterministic hashing
  const frozenNodes = dag.nodes
    .map((node) => freezeTask(node))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));

  const sortedEdges = [...dag.edges].sort((a, b) => {
    const fromDiff = a.from.localeCompare(b.from);
    if (fromDiff !== 0) {
      return fromDiff;
    }
    return a.to.localeCompare(b.to);
  });

  const frozenDag: DagSpec = {
    ...dag,
    nodes: frozenNodes,
    edges: sortedEdges,
    dagHash: sha256(stableStringify({ nodes: frozenNodes, edges: sortedEdges }))
  };

  const taskContractHashes = frozenNodes.reduce<Record<string, string>>((acc, node) => {
    acc[node.taskId] = node.contractHash;
    return acc;
  }, {});

  return {
    dag: frozenDag,
    taskContractHashes,
    immutablePlanHash: sha256(stableStringify({ dag: frozenDag, taskContractHashes }))
  };
}