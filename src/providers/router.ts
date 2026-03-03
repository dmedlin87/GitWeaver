import type {
  ProviderHealthSnapshot,
  ProviderId,
  RoutingDecision,
  TaskType,
} from "../core/types.js";

const FALLBACK_ORDER: Record<ProviderId, ProviderId[]> = {
  gemini: ["claude", "codex"],
  claude: ["codex", "gemini"],
  codex: ["claude", "gemini"],
};

function preferredProvider(type: TaskType): {
  provider: ProviderId;
  reason: string;
} {
  switch (type) {
    case "code":
    case "refactor":
    case "test":
    case "deps":
      return {
        provider: "claude",
        reason: "task type prefers Claude for idiomatic code execution",
      };
    case "ui":
    case "multimodal":
      return {
        provider: "gemini",
        reason: "task type prefers Gemini for deep context and multimodal work",
      };
    case "plan":
    case "audit":
    case "repair":
      return {
        provider: "codex",
        reason:
          "task type prefers Codex for architectural planning and deterministic verification",
      };
    case "docs":
      return {
        provider: "claude",
        reason: "task type prefers Claude for documentation synthesis",
      };
    default:
      return {
        provider: "claude",
        reason: "default provider preference is Claude",
      };
  }
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
  healthByProvider: Partial<Record<ProviderId, ProviderHealthSnapshot>>,
): RoutingDecision | null {
  if (providerHealthy(healthByProvider[task.provider])) {
    return null;
  }
  return routeTask(task.type, healthByProvider);
}

export function routeTask(
  type: TaskType,
  healthByProvider: Partial<Record<ProviderId, ProviderHealthSnapshot>>,
): RoutingDecision {
  const preferred = preferredProvider(type);
  const primaryHealth = healthByProvider[preferred.provider];
  if (providerHealthy(primaryHealth)) {
    return {
      provider: preferred.provider,
      routingReason: preferred.reason,
    };
  }

  for (const fallback of FALLBACK_ORDER[preferred.provider]) {
    if (providerHealthy(healthByProvider[fallback])) {
      return {
        provider: fallback,
        fallbackProvider: preferred.provider,
        routingReason: preferred.reason,
        fallbackReason: `${preferred.provider} degraded with score ${primaryHealth?.score ?? "unknown"}`,
      };
    }
  }

  return {
    provider: preferred.provider,
    routingReason: preferred.reason,
    fallbackReason: "No healthy fallback provider available",
  };
}

export function routeExecutionFallback(
  failedProvider: ProviderId,
  healthByProvider: Partial<Record<ProviderId, ProviderHealthSnapshot>>,
  reason: string,
): RoutingDecision | null {
  for (const candidate of FALLBACK_ORDER[failedProvider]) {
    if (providerHealthy(healthByProvider[candidate])) {
      return {
        provider: candidate,
        fallbackProvider: failedProvider,
        routingReason: "execution fallback after provider-specific failure",
        fallbackReason: reason
      };
    }
  }

  return null;
}
