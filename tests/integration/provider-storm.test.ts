import { describe, expect, it } from "vitest";
import { ProviderHealthManager } from "../../src/providers/health-manager.js";
import { rerouteOnDegradation, routeExecutionFallback } from "../../src/providers/router.js";
import { Scheduler, type ScheduledTask } from "../../src/scheduler/scheduler.js";
import type { ProviderId } from "../../src/core/types.js";

function makeTask(taskId: string, provider: ProviderId, type: ScheduledTask["type"] = "code"): ScheduledTask {
  return {
    taskId,
    title: `Task ${taskId}`,
    provider,
    type,
    dependencies: [],
    writeScope: { allow: ["src/**/*.ts"], deny: [], ownership: "exclusive" },
    commandPolicy: { allow: [], deny: [], network: "deny" },
    expected: {},
    verify: { outputVerificationRequired: false },
    artifactIO: {},
    contractHash: `hash-${taskId}`
  };
}

describe("provider storm resilience", () => {
  it("reroutes tasks to fallback provider during a 429 storm on primary", () => {
    const health = new ProviderHealthManager({
      buckets: { codex: 2, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 120,
      recoverPerSuccess: 10
    });
    const scheduler = new Scheduler({ codex: 2, claude: 2, gemini: 2 });

    // Simulate a 429 storm: three consecutive rate-limit failures on claude
    health.onFailure("claude", "429 Too Many Requests");
    health.onFailure("claude", "429 Too Many Requests");
    health.onFailure("claude", "429 Too Many Requests");

    expect(health.canDispatch("claude")).toBe(false);

    // Enqueue two code tasks assigned to claude (planned before the storm)
    scheduler.enqueue(makeTask("task-1", "claude"));
    scheduler.enqueue(makeTask("task-2", "claude"));

    const dispatched: ScheduledTask[] = [];
    let task: ScheduledTask | null;
    while (
      (task = scheduler.tryDispatch(
        (t) => health.canDispatch(t.provider),
        (t) => {
          const decision = rerouteOnDegradation(t, health.snapshotAll());
          if (!decision || decision.provider === t.provider) return null;
          return { ...t, provider: decision.provider };
        }
      )) !== null
    ) {
      dispatched.push(task);
      scheduler.complete(task);
    }

    expect(dispatched).toHaveLength(2);
    // Both tasks should have been rerouted away from claude
    for (const d of dispatched) {
      expect(d.provider).not.toBe("claude");
      expect(d.reroutedFrom).toBe("claude");
    }
  });

  it("dispatches normally after provider recovers from storm", () => {
    const health = new ProviderHealthManager({
      buckets: { codex: 2, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 120,
      recoverPerSuccess: 40
    });
    const scheduler = new Scheduler({ codex: 2, claude: 2, gemini: 2 });

    health.onFailure("claude", "429");
    expect(health.canDispatch("claude")).toBe(false);

    // Recovery: enough successes to restore score and clear cooldown
    health.onSuccess("claude");

    expect(health.canDispatch("claude")).toBe(true);

    scheduler.enqueue(makeTask("task-1", "claude"));
    const task = scheduler.tryDispatch(
      (t) => health.canDispatch(t.provider),
      (t) => {
        const decision = rerouteOnDegradation(t, health.snapshotAll());
        if (!decision || decision.provider === t.provider) return null;
        return { ...t, provider: decision.provider };
      }
    );

    expect(task).not.toBeNull();
    expect(task!.provider).toBe("claude");
    expect(task!.reroutedFrom).toBeUndefined();
  });

  it("returns null when all providers are in cooldown (no healthy fallback)", () => {
    const health = new ProviderHealthManager({
      buckets: { codex: 2, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 120,
      recoverPerSuccess: 10
    });
    const scheduler = new Scheduler({ codex: 2, claude: 2, gemini: 2 });

    // Kill all three providers
    health.onFailure("claude", "429");
    health.onFailure("codex", "429");
    health.onFailure("gemini", "429");

    scheduler.enqueue(makeTask("task-1", "claude"));

    const task = scheduler.tryDispatch(
      (t) => health.canDispatch(t.provider),
      (t) => {
        const decision = rerouteOnDegradation(t, health.snapshotAll());
        if (!decision || decision.provider === t.provider) return null;
        return { ...t, provider: decision.provider };
      }
    );

    expect(task).toBeNull();
    expect(scheduler.pending()).toBe(1); // task stays queued
  });

  it("rate-limit backoff is larger than timeout backoff on first failure", () => {
    const makeManager = () =>
      new ProviderHealthManager({ buckets: { codex: 1, claude: 2, gemini: 2 }, baseBackoffSec: 5, maxBackoffSec: 300, recoverPerSuccess: 10 });

    const m1 = makeManager();
    const snapRateLimit = m1.onFailure("claude", "rate limit exceeded: 429");

    const m2 = makeManager();
    const snapTimeout = m2.onFailure("claude", "request timed out after 60s");

    const m3 = makeManager();
    const snapOther = m3.onFailure("claude", "unexpected EOF from provider");

    expect(snapRateLimit.backoffSec!).toBeGreaterThan(snapTimeout.backoffSec!);
    expect(snapTimeout.backoffSec!).toBeGreaterThan(snapOther.backoffSec!);
  });

  it("rerouted task uses fallback provider token bucket, not original", () => {
    const health = new ProviderHealthManager({
      buckets: { codex: 1, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 120,
      recoverPerSuccess: 10
    });
    const scheduler = new Scheduler({ codex: 1, claude: 0, gemini: 0 });

    health.onFailure("claude", "429");

    scheduler.enqueue(makeTask("task-1", "claude"));

    const task = scheduler.tryDispatch(
      (t) => health.canDispatch(t.provider),
      (t) => {
        const decision = rerouteOnDegradation(t, health.snapshotAll());
        if (!decision || decision.provider === t.provider) return null;
        return { ...t, provider: decision.provider };
      }
    );

    expect(task).not.toBeNull();
    expect(task!.provider).toBe("codex");

    // codex bucket should now be consumed
    expect(scheduler.bucketSnapshot().codex.available).toBe(0);

    scheduler.complete(task!);
    expect(scheduler.bucketSnapshot().codex.available).toBe(1);
  });

  it("routes execution fallback from gemini to claude after tool-not-found failure", () => {
    const health = new ProviderHealthManager({
      buckets: { codex: 2, claude: 2, gemini: 2 },
      baseBackoffSec: 5,
      maxBackoffSec: 120,
      recoverPerSuccess: 10
    });

    health.onFailure("gemini", "tool not found: rg");

    const decision = routeExecutionFallback("gemini", health.snapshotAll(), "provider-specific execution failure signature");
    expect(decision).not.toBeNull();
    expect(decision!.provider).toBe("claude");
    expect(decision!.fallbackProvider).toBe("gemini");
  });
});
