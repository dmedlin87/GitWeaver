import { extname, basename } from "node:path";
import type { DagSpec, TaskContract } from "../core/types.js";
import { sha256, stableStringify } from "../core/hash.js";

export interface AuditFinding {
  taskId: string;
  level: "warn" | "error";
  message: string;
}

export interface PlanAuditResult {
  dag: DagSpec;
  findings: AuditFinding[];
}

const HOT_RESOURCE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "index.ts",
  "index.js",
  "tsconfig.json",
  "pnpm-workspace.yaml",
  "package.json"
]);

const SHARED_APPEND_EXT = new Set([".json", ".yaml", ".yml"]);

function isHotResource(path: string): boolean {
  const file = basename(path);
  if (HOT_RESOURCE_NAMES.has(file)) {
    return true;
  }
  if (file.includes("schema") || file.includes("registry") || file.includes("exports")) {
    return true;
  }
  return false;
}

function upgradeOwnership(task: TaskContract, findings: AuditFinding[]): TaskContract {
  const allowPaths = task.writeScope.allow;
  let ownership = task.writeScope.ownership;

  const touchesHot = allowPaths.some((path) => isHotResource(path));
  if (touchesHot && ownership === "shared-append") {
    ownership = "shared-serial";
    findings.push({
      taskId: task.taskId,
      level: "warn",
      message: "shared-append demoted to shared-serial for hot resource overlap"
    });
  }

  if (ownership === "shared-append") {
    const invalid = allowPaths.find((path) => !SHARED_APPEND_EXT.has(extname(path).toLowerCase()));
    if (invalid) {
      ownership = "shared-serial";
      findings.push({
        taskId: task.taskId,
        level: "warn",
        message: `shared-append restricted to JSON/YAML; demoted due to ${invalid}`
      });
    }
  }

  const nextTask = {
    ...task,
    writeScope: {
      ...task.writeScope,
      ownership
    }
  };

  nextTask.contractHash = sha256(
    stableStringify({
      ...nextTask,
      contractHash: undefined
    })
  );

  return nextTask;
}

export function auditPlan(spec: DagSpec): PlanAuditResult {
  const findings: AuditFinding[] = [];
  const nodes = spec.nodes.map((task) => upgradeOwnership(task, findings));
  const dag = {
    ...spec,
    nodes,
    dagHash: sha256(stableStringify({ nodes, edges: spec.edges }))
  };
  return { dag, findings };
}