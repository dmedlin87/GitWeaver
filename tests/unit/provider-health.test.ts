import { describe, expect, it } from "vitest";
import { ProviderHealthManager } from "../../src/providers/health-manager.js";

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
    expect(snapshot.backoffSec).toBe(2);
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
});
