import { describe, expect, it } from "vitest";
import { classifyProviderError, ProviderHealthManager } from "../../src/providers/health-manager.js";

describe("classifyProviderError", () => {
  it("classifies 429 status text as rate_limit", () => {
    expect(classifyProviderError("429 Too Many Requests")).toBe("rate_limit");
    expect(classifyProviderError("rate limit exceeded")).toBe("rate_limit");
    expect(classifyProviderError("quota exceeded for this project")).toBe("rate_limit");
  });

  it("classifies timeout messages as timeout", () => {
    expect(classifyProviderError("request timed out after 30s")).toBe("timeout");
    expect(classifyProviderError("deadline exceeded")).toBe("timeout");
    expect(classifyProviderError("Operation timeout")).toBe("timeout");
  });

  it("classifies everything else as other", () => {
    expect(classifyProviderError("internal server error")).toBe("other");
    expect(classifyProviderError("auth token invalid")).toBe("other");
    expect(classifyProviderError("unexpected EOF")).toBe("other");
  });
});

describe("ProviderHealthManager", () => {
  it("enters cooldown after failures and blocks dispatch", () => {
    const manager = new ProviderHealthManager({
      buckets: { codex: 1, claude: 2, gemini: 2 },
      baseBackoffSec: 2,
      maxBackoffSec: 30,
      recoverPerSuccess: 10
    });

    const snapshot = manager.onFailure("claude", "429");
    expect(snapshot.consecutiveFailures).toBe(1);
    expect(manager.canDispatch("claude")).toBe(false);
  });

  it("recovers score and clears cooldown on success", () => {
    const manager = new ProviderHealthManager({
      buckets: { codex: 1, claude: 2, gemini: 2 },
      baseBackoffSec: 2,
      maxBackoffSec: 30,
      recoverPerSuccess: 15
    });

    manager.onFailure("gemini", "timeout");
    const recovered = manager.onSuccess("gemini");
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.backoffSec).toBe(0);
    expect(recovered.cooldownUntil).toBeUndefined();
    expect(manager.canDispatch("gemini")).toBe(true);
  });

  it("applies larger backoff for rate-limit errors than generic failures", () => {
    const makeManager = () =>
      new ProviderHealthManager({ buckets: { codex: 1, claude: 2, gemini: 2 }, baseBackoffSec: 5, maxBackoffSec: 300, recoverPerSuccess: 10 });

    const mRateLimit = makeManager();
    const snapRateLimit = mRateLimit.onFailure("claude", "429 Too Many Requests");

    const mOther = makeManager();
    const snapOther = mOther.onFailure("claude", "internal server error");

    expect(snapRateLimit.backoffSec).toBeGreaterThan(snapOther.backoffSec!);
  });

  it("applies medium backoff for timeout errors — between rate_limit and other", () => {
    const makeManager = () =>
      new ProviderHealthManager({ buckets: { codex: 1, claude: 2, gemini: 2 }, baseBackoffSec: 5, maxBackoffSec: 300, recoverPerSuccess: 10 });

    const mTimeout = makeManager();
    const snapTimeout = mTimeout.onFailure("claude", "request timed out");

    const mRateLimit = makeManager();
    const snapRateLimit = mRateLimit.onFailure("claude", "429 Too Many Requests");

    const mOther = makeManager();
    const snapOther = mOther.onFailure("claude", "internal server error");

    expect(snapTimeout.backoffSec).toBeGreaterThan(snapOther.backoffSec!);
    expect(snapRateLimit.backoffSec).toBeGreaterThan(snapTimeout.backoffSec!);
  });

  it("applies larger score penalty for rate-limit errors than generic failures", () => {
    const makeManager = () =>
      new ProviderHealthManager({ buckets: { codex: 1, claude: 2, gemini: 2 }, baseBackoffSec: 5, maxBackoffSec: 300, recoverPerSuccess: 10 });

    const mRateLimit = makeManager();
    mRateLimit.onFailure("claude", "rate limit exceeded");

    const mOther = makeManager();
    mOther.onFailure("claude", "internal server error");

    expect(mRateLimit.snapshot("claude").score).toBeLessThan(mOther.snapshot("claude").score);
  });

  it("escalates backoff exponentially with consecutive failures", () => {
    const manager = new ProviderHealthManager({
      buckets: { codex: 1, claude: 2, gemini: 2 },
      baseBackoffSec: 4,
      maxBackoffSec: 300,
      recoverPerSuccess: 10
    });

    const snap1 = manager.onFailure("codex", "internal error");
    const snap2 = manager.onFailure("codex", "internal error");
    const snap3 = manager.onFailure("codex", "internal error");

    expect(snap2.backoffSec!).toBeGreaterThan(snap1.backoffSec!);
    expect(snap3.backoffSec!).toBeGreaterThan(snap2.backoffSec!);
  });

  it("caps backoff at maxBackoffSec", () => {
    const manager = new ProviderHealthManager({
      buckets: { codex: 1, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 10,
      recoverPerSuccess: 10
    });

    for (let i = 0; i < 8; i++) {
      manager.onFailure("claude", "429 Too Many Requests");
    }
    expect(manager.snapshot("claude").backoffSec).toBe(10);
  });
});
