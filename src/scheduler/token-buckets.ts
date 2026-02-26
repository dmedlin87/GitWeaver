import type { ProviderId } from "../core/types.js";

interface BucketState {
  capacity: number;
  available: number;
}

export class ProviderTokenBuckets {
  private readonly buckets: Record<ProviderId, BucketState>;

  public constructor(capacity: Record<ProviderId, number>) {
    this.buckets = {
      codex: { capacity: capacity.codex, available: capacity.codex },
      claude: { capacity: capacity.claude, available: capacity.claude },
      gemini: { capacity: capacity.gemini, available: capacity.gemini }
    };
  }

  public tryAcquire(provider: ProviderId): boolean {
    const bucket = this.buckets[provider];
    if (bucket.available <= 0) {
      return false;
    }
    bucket.available -= 1;
    return true;
  }

  public release(provider: ProviderId): void {
    const bucket = this.buckets[provider];
    bucket.available = Math.min(bucket.capacity, bucket.available + 1);
  }

  public snapshot(): Record<ProviderId, { capacity: number; available: number }> {
    return {
      codex: { ...this.buckets.codex },
      claude: { ...this.buckets.claude },
      gemini: { ...this.buckets.gemini }
    };
  }
}