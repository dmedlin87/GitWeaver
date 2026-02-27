import type { ProviderHealthSnapshot, ProviderId } from "../core/types.js";

export interface ProviderHealthManagerOptions {
  buckets: Record<ProviderId, number>;
  baseBackoffSec: number;
  maxBackoffSec: number;
  recoverPerSuccess: number;
  initial?: Partial<Record<ProviderId, ProviderHealthSnapshot>>;
}

export class ProviderHealthManager {
  private readonly state: Record<ProviderId, ProviderHealthSnapshot>;
  private readonly baseBackoffSec: number;
  private readonly maxBackoffSec: number;
  private readonly recoverPerSuccess: number;

  public constructor(options: ProviderHealthManagerOptions) {
    this.baseBackoffSec = Math.max(1, options.baseBackoffSec);
    this.maxBackoffSec = Math.max(this.baseBackoffSec, options.maxBackoffSec);
    this.recoverPerSuccess = Math.max(1, options.recoverPerSuccess);
    this.state = {
      codex: this.mergeInitial("codex", options.buckets.codex, options.initial?.codex),
      claude: this.mergeInitial("claude", options.buckets.claude, options.initial?.claude),
      gemini: this.mergeInitial("gemini", options.buckets.gemini, options.initial?.gemini)
    };
  }

  public snapshot(provider: ProviderId): ProviderHealthSnapshot {
    return { ...this.state[provider] };
  }

  public snapshotAll(): Partial<Record<ProviderId, ProviderHealthSnapshot>> {
    return {
      codex: this.snapshot("codex"),
      claude: this.snapshot("claude"),
      gemini: this.snapshot("gemini")
    };
  }

  public canDispatch(provider: ProviderId, now = Date.now()): boolean {
    const state = this.state[provider];
    if (state.score < 50) {
      return false;
    }
    if (!state.cooldownUntil) {
      return true;
    }
    const cooldownUntilMs = Date.parse(state.cooldownUntil);
    return Number.isNaN(cooldownUntilMs) || now >= cooldownUntilMs;
  }

  public onSuccess(provider: ProviderId): ProviderHealthSnapshot {
    const current = this.state[provider];
    const next: ProviderHealthSnapshot = {
      ...current,
      score: Math.min(100, current.score + this.recoverPerSuccess),
      cooldownUntil: undefined,
      consecutiveFailures: 0,
      backoffSec: 0
    };
    this.state[provider] = next;
    return { ...next };
  }

  public onFailure(provider: ProviderId, errorText: string): ProviderHealthSnapshot {
    const current = this.state[provider];
    const consecutiveFailures = (current.consecutiveFailures ?? 0) + 1;
    const backoffSec = Math.min(this.maxBackoffSec, this.baseBackoffSec * 2 ** Math.max(0, consecutiveFailures - 1));
    const next: ProviderHealthSnapshot = {
      ...current,
      score: Math.max(0, current.score - 20),
      lastErrors: [...current.lastErrors, truncate(errorText)].slice(-5),
      cooldownUntil: new Date(Date.now() + backoffSec * 1000).toISOString(),
      consecutiveFailures,
      backoffSec
    };
    this.state[provider] = next;
    return { ...next };
  }

  private mergeInitial(provider: ProviderId, tokenBucket: number, initial?: ProviderHealthSnapshot): ProviderHealthSnapshot {
    if (!initial) {
      return {
        provider,
        score: 100,
        lastErrors: [],
        tokenBucket,
        consecutiveFailures: 0,
        backoffSec: 0
      };
    }

    return {
      provider,
      score: initial.score,
      lastErrors: [...initial.lastErrors],
      tokenBucket: initial.tokenBucket || tokenBucket,
      cooldownUntil: initial.cooldownUntil,
      consecutiveFailures: initial.consecutiveFailures ?? 0,
      backoffSec: initial.backoffSec ?? 0
    };
  }
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}
