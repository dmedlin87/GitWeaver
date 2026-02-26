import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RuntimeConfig {
  baselineGateCommand: string;
  concurrencyCap: number;
  providerBuckets: Record<"codex" | "claude" | "gemini", number>;
  leaseDurationSec: number;
  leaseRenewSec: number;
  heartbeatTimeoutSec: number;
  terminateGraceSec: number;
  maxRepairAttemptsPerClass: number;
  defaultCommandDeny: string[];
  defaultNetworkPolicy: "deny" | "allow";
  smokeGateByType: Partial<Record<string, string>>;
  sharedAppendExtensions: string[];
  forensicRawLogs: boolean;
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  baselineGateCommand: "pnpm -s tsc -p .",
  concurrencyCap: 4,
  providerBuckets: {
    codex: 1,
    claude: 2,
    gemini: 2
  },
  leaseDurationSec: 120,
  leaseRenewSec: 30,
  heartbeatTimeoutSec: 60,
  terminateGraceSec: 10,
  maxRepairAttemptsPerClass: 2,
  defaultCommandDeny: ["npm install", "pnpm install", "yarn install", "git push", "curl", "wget", "rm -rf"],
  defaultNetworkPolicy: "deny",
  smokeGateByType: {
    code: "pnpm -s test --runInBand",
    refactor: "pnpm -s test --runInBand"
  },
  sharedAppendExtensions: [".json", ".yaml", ".yml"],
  forensicRawLogs: false
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function deepMerge<T extends Record<string, unknown>>(base: T, incoming: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const current = out[key];
    if (isObject(current) && isObject(value)) {
      out[key] = deepMerge(current, value);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

export function loadConfig(configPath?: string): RuntimeConfig {
  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  const resolved = resolve(configPath);
  const parsed = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
  return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as RuntimeConfig;
}
