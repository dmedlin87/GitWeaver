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
  const frozenNodes = dag.nodes.map((node) => freezeTask(node));
  const frozenDag: DagSpec = {
    ...dag,
    nodes: frozenNodes,
    dagHash: sha256(stableStringify({ nodes: frozenNodes, edges: dag.edges }))
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