import type { ProviderHealthSnapshot, ProviderId, RoutingDecision, TaskType } from "../core/types.js";

const FALLBACK_ORDER: Record<ProviderId, ProviderId[]> = {
  codex: ["claude", "gemini"],
  claude: ["codex", "gemini"],
  gemini: ["claude", "codex"]
};

function preferredProvider(type: TaskType): { provider: ProviderId; reason: string } {
  if (["code", "refactor", "test", "deps"].includes(type)) {
    return { provider: "claude", reason: "task type prefers Claude for TypeScript-heavy implementation" };
  }
  if (["ui", "multimodal", "docs"].includes(type)) {
    return { provider: "gemini", reason: "task type prefers Gemini for UI/multimodal artifacts" };
  }
  return { provider: "codex", reason: "task type prefers Codex for planning/audit/repair coordination" };
}

function providerHealthy(health: ProviderHealthSnapshot | undefined): boolean {
  if (!health) {
    return true;
  }
  return health.score >= 50;
}

export function routeTask(
  type: TaskType,
  healthByProvider: Partial<Record<ProviderId, ProviderHealthSnapshot>>
): RoutingDecision {
  const preferred = preferredProvider(type);
  const primaryHealth = healthByProvider[preferred.provider];
  if (providerHealthy(primaryHealth)) {
    return {
      provider: preferred.provider,
      routingReason: preferred.reason
    };
  }

  for (const fallback of FALLBACK_ORDER[preferred.provider]) {
    if (providerHealthy(healthByProvider[fallback])) {
      return {
        provider: fallback,
        fallbackProvider: preferred.provider,
        routingReason: preferred.reason,
        fallbackReason: `${preferred.provider} degraded with score ${primaryHealth?.score ?? "unknown"}`
      };
    }
  }

  return {
    provider: preferred.provider,
    routingReason: preferred.reason,
    fallbackReason: "No healthy fallback provider available"
  };
}