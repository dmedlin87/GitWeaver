import type { TaskState, RunState } from "./state-machine.js";
import type { ReasonCode } from "./reason-codes.js";

export type ProviderId = "codex" | "claude" | "gemini";

export type TaskType = "code" | "refactor" | "test" | "docs" | "deps" | "repair" | "ui" | "multimodal" | "plan" | "audit";

export interface TaskContract {
  taskId: string;
  title: string;
  provider: ProviderId;
  type: "code" | "refactor" | "test" | "docs" | "deps" | "repair";
  dependencies: string[];
  writeScope: {
    allow: string[];
    deny: string[];
    ownership: "exclusive" | "shared-serial" | "shared-append";
    sharedKey?: string;
  };
  commandPolicy: {
    allow: string[];
    deny: string[];
    network: "deny" | "allow";
  };
  expected: {
    files?: string[];
    exports?: { file: string; name: string; kind: "function" | "class" | "type" | "interface" | "const" }[];
    tests?: { file: string; contains?: string }[];
  };
  verify: {
    gateCommand?: string;
    gateTimeoutSec?: number;
    outputVerificationRequired: boolean;
  };
  artifactIO: {
    consumes?: string[];
    produces?: string[];
  };
  contractHash: string;
}

export interface PromptEnvelope {
  runId: string;
  taskId: string;
  attempt: number;
  provider: ProviderId;
  baselineCommit: string;
  taskContractHash: string;
  contextPackHash: string;
  immutableSectionsHash: string;
  mutableSections: {
    failureEvidence?: string[];
    boundedHints?: string[];
  };
}

export interface ContextPack {
  taskId: string;
  must: Array<{ path: string; sha256: string; reason: string; content?: string }>;
  should: Array<{ path: string; sha256: string; reason: string }>;
  optional: Array<{ path: string; sha256: string; reason: string }>;
  byteBudget: number;
  selectedTotalBytes: number;
  contextPackHash: string;
}

export interface LockLease {
  resourceKey: string;
  mode: "read" | "write";
  ownerTaskId: string;
  acquiredAt: string;
  expiresAt: string;
  fencingToken: number;
}

export interface DagSpec {
  nodes: TaskContract[];
  edges: Array<{ from: string; to: string }>;
  dagHash?: string;
}

export interface RoutingDecision {
  provider: ProviderId;
  fallbackProvider?: ProviderId;
  routingReason: string;
  fallbackReason?: string;
}

export interface ProviderHealthSnapshot {
  provider: ProviderId;
  score: number;
  lastErrors: string[];
  tokenBucket: number;
  cooldownUntil?: string;
  consecutiveFailures?: number;
  backoffSec?: number;
}

export interface ProviderSpec {
  id: ProviderId;
  npmPackage: string;
  binary: string;
  versionArgs: string[];
  authCheckCommand?: string[];
  authFixCommand: string;
  installFallbackByOs: Partial<Record<"win32" | "darwin" | "linux", string>>;
  windowsNotes?: string;
  configPaths?: string[];
}

export interface ProviderStatus {
  provider: ProviderId;
  installed: boolean;
  versionInstalled?: string;
  versionLatest?: string;
  authStatus: "OK" | "MISSING" | "UNKNOWN";
  healthStatus: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  issues: string[];
}

export interface InstallPlan {
  missing: ProviderId[];
  outdated: ProviderId[];
  commands: string[];
  requiresPrompt: boolean;
}

export interface InstallResult {
  success: ProviderId[];
  failed: ProviderId[];
  skipped: ProviderId[];
  reasonCodes: ReasonCode[];
}

export interface RunRecord {
  runId: string;
  objective: string;
  repoPath: string;
  baselineCommit: string;
  configHash: string;
  state: RunState;
  createdAt: string;
  updatedAt: string;
  reasonCode?: ReasonCode;
}

export interface TaskRecord {
  runId: string;
  taskId: string;
  provider: ProviderId;
  type: string;
  state: TaskState;
  attempts: number;
  contractHash: string;
  leaseToken?: number;
  commitHash?: string;
  reasonCode?: ReasonCode;
}

export interface EventRecord {
  seq: number;
  runId: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  payloadHash: string;
}
