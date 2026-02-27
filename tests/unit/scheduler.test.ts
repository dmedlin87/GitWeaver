import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler, type ScheduledTask } from "../../src/scheduler/scheduler.js";
import type { ProviderId } from "../../src/core/types.js";

function makeTask(taskId: string, provider: ProviderId): ScheduledTask {
  return {
    taskId,
    title: `Task ${taskId}`,
    provider,
    type: "code",
    dependencies: [],
    writeScope: {
      allow: ["src/**/*.ts"],
      deny: [],
      ownership: "exclusive"
    },
    commandPolicy: {
      allow: [],
      deny: [],
      network: "deny"
    },
    expected: {},
    verify: {
      outputVerificationRequired: false
    },
    artifactIO: {},
    contractHash: `hash-${taskId}`
  };
}

describe("Scheduler", () => {
  beforeEach(() => {
    let tick = 0;
    vi.spyOn(Date, "now").mockImplementation(() => 1_700_000_000_000 + tick++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates enqueues by taskId", () => {
    const scheduler = new Scheduler({ codex: 1, claude: 1, gemini: 1 });
    const first = makeTask("task-1", "codex");
    const duplicate = { ...first, title: "changed title" };

    scheduler.enqueue(first);
    scheduler.enqueue(duplicate, 10);

    expect(scheduler.pending()).toBe(1);
    expect(scheduler.tryDispatch()).toMatchObject({ taskId: "task-1", title: "Task task-1" });
  });

  it("returns null when queue is empty", () => {
    const scheduler = new Scheduler({ codex: 1, claude: 1, gemini: 1 });

    expect(scheduler.tryDispatch()).toBeNull();
  });

  it("dispatches when provider tokens are available and consumes one token", () => {
    const scheduler = new Scheduler({ codex: 1, claude: 1, gemini: 1 });
    const task = makeTask("task-1", "codex");
    scheduler.enqueue(task);

    expect(scheduler.tryDispatch()).toMatchObject({ taskId: "task-1", provider: "codex" });
    expect(scheduler.bucketSnapshot().codex.available).toBe(0);
    expect(scheduler.tryDispatch()).toBeNull();
  });

  it("requeues unavailable-provider tasks and dispatches a later eligible task", () => {
    const scheduler = new Scheduler({ codex: 0, claude: 1, gemini: 1 });
    scheduler.enqueue(makeTask("codex-task", "codex"));
    scheduler.enqueue(makeTask("claude-task", "claude"));

    expect(scheduler.tryDispatch()).toMatchObject({ taskId: "claude-task", provider: "claude" });
    expect(scheduler.pending()).toBe(1);
    expect(scheduler.tryDispatch()).toBeNull();
    expect(scheduler.pending()).toBe(1);
    expect(scheduler.bucketSnapshot().codex.available).toBe(0);
  });

  it("returns null after scanning when all queued providers are unavailable", () => {
    const scheduler = new Scheduler({ codex: 0, claude: 0, gemini: 0 });
    scheduler.enqueue(makeTask("codex-task", "codex"));
    scheduler.enqueue(makeTask("claude-task", "claude"));

    expect(scheduler.tryDispatch()).toBeNull();
    expect(scheduler.pending()).toBe(2);
  });

  it("releases tokens on completion without exceeding capacity", () => {
    const scheduler = new Scheduler({ codex: 1, claude: 1, gemini: 1 });
    const task = makeTask("task-1", "codex");
    scheduler.enqueue(task);
    const dispatched = scheduler.tryDispatch();
    expect(dispatched).not.toBeNull();
    expect(scheduler.bucketSnapshot().codex.available).toBe(0);

    scheduler.complete(task);
    scheduler.complete(task);

    expect(scheduler.bucketSnapshot().codex.available).toBe(1);
  });
});
