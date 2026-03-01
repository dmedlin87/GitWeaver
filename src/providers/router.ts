import type { ProviderHealthSnapshot, ProviderId, RoutingDecision, TaskType } from "../core/types.js";

const FALLBACK_ORDER: Record<ProviderId, ProviderId[]> = {
  gemini: ["claude", "codex"],
  claude: ["gemini", "codex"],
  codex: ["gemini", "claude"]
};

function preferredProvider(type: TaskType): { provider: ProviderId; reason: string } {
  // Overriding to Gemini for now due to environment issues with Claude/Codex
  return { provider: "gemini", reason: "task type prefers Gemini for high reliability in current environment" };
}

function providerHealthy(health: ProviderHealthSnapshot | undefined): boolean {
  if (!health) {
    return true;
  }
  if (health.score < 50) {
    return false;
  }
  if (!health.cooldownUntil) {
    return true;
  }
  const cooldownUntilMs = Date.parse(health.cooldownUntil);
  if (Number.isNaN(cooldownUntilMs)) {
    return true;
  }
  return Date.now() >= cooldownUntilMs;
}

export function rerouteOnDegradation(
  task: { type: TaskType; provider: ProviderId },
  healthByProvider: Partial<Record<ProviderId, ProviderHealthSnapshot>>
): RoutingDecision | null {
  if (providerHealthy(healthByProvider[task.provider])) {
    return null;
  }
  return routeTask(task.type, healthByProvider);
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
