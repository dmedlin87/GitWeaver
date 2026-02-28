import { describe, expect, it } from "vitest";
import {
  assertRunTransition,
  assertTaskTransition,
  mapRunAbort,
  type RunState,
  type TaskState
} from "../../src/core/state-machine.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";

describe("assertRunTransition", () => {
  it("allows valid transitions", () => {
    expect(() => assertRunTransition("INGEST", "BASELINE_OK")).not.toThrow();
    expect(() => assertRunTransition("BASELINE_OK", "PLAN_FROZEN")).not.toThrow();
    expect(() => assertRunTransition("PLAN_FROZEN", "DISPATCHING")).not.toThrow();
    expect(() => assertRunTransition("DISPATCHING", "INTEGRATING")).not.toThrow();
    expect(() => assertRunTransition("INTEGRATING", "VERIFYING")).not.toThrow();
    expect(() => assertRunTransition("VERIFYING", "COMPLETED")).not.toThrow();
    expect(() => assertRunTransition("VERIFYING", "REPAIRING")).not.toThrow();
    expect(() => assertRunTransition("REPAIRING", "INTEGRATING")).not.toThrow();
    expect(() => assertRunTransition("REPLANNING", "PLAN_FROZEN")).not.toThrow();
  });

  it("throws on invalid run transitions", () => {
    expect(() => assertRunTransition("INGEST", "DISPATCHING")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("COMPLETED", "INGEST")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("DISPATCHING", "REPLANNING")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("ABORTED_POLICY", "INGEST")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("ABORTED_BASELINE", "INGEST")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("ABORTED_BUDGET", "INGEST")).toThrow("Invalid run transition");
    expect(() => assertRunTransition("ABORTED_MANUAL", "INGEST")).toThrow("Invalid run transition");
  });

  it("allows abort transitions from appropriate states", () => {
    expect(() => assertRunTransition("INGEST", "ABORTED_BASELINE")).not.toThrow();
    expect(() => assertRunTransition("INGEST", "ABORTED_POLICY")).not.toThrow();
    expect(() => assertRunTransition("DISPATCHING", "ABORTED_BUDGET")).not.toThrow();
    expect(() => assertRunTransition("DISPATCHING", "ABORTED_POLICY")).not.toThrow();
    expect(() => assertRunTransition("DISPATCHING", "ABORTED_MANUAL")).not.toThrow();
  });

  it("includes state names in error message", () => {
    expect(() => assertRunTransition("COMPLETED" as RunState, "INGEST" as RunState))
      .toThrow(/COMPLETED.*INGEST/);
  });
});

describe("assertTaskTransition", () => {
  it("allows valid task transitions", () => {
    expect(() => assertTaskTransition("PENDING", "READY")).not.toThrow();
    expect(() => assertTaskTransition("READY", "LEASE_ACQUIRED")).not.toThrow();
    expect(() => assertTaskTransition("LEASE_ACQUIRED", "RUNNING")).not.toThrow();
    expect(() => assertTaskTransition("RUNNING", "COMMIT_PRODUCED")).not.toThrow();
    expect(() => assertTaskTransition("COMMIT_PRODUCED", "SCOPE_PASSED")).not.toThrow();
    expect(() => assertTaskTransition("SCOPE_PASSED", "MERGE_QUEUED")).not.toThrow();
    expect(() => assertTaskTransition("MERGE_QUEUED", "MERGED")).not.toThrow();
    expect(() => assertTaskTransition("MERGED", "VERIFIED")).not.toThrow();
  });

  it("throws on invalid task transitions", () => {
    expect(() => assertTaskTransition("PENDING", "RUNNING")).toThrow("Invalid task transition");
    expect(() => assertTaskTransition("VERIFIED", "READY")).toThrow("Invalid task transition");
    expect(() => assertTaskTransition("ESCALATED", "READY")).toThrow("Invalid task transition");
    expect(() => assertTaskTransition("RUNNING", "PENDING")).toThrow("Invalid task transition");
  });

  it("allows escalation from multiple states", () => {
    const escalatableStates: TaskState[] = ["PENDING", "READY", "LEASE_ACQUIRED", "RUNNING", "EXEC_FAILED", "SCOPE_FAILED", "VERIFY_FAILED", "STALE", "MERGE_QUEUED"];
    for (const state of escalatableStates) {
      expect(() => assertTaskTransition(state, "ESCALATED")).not.toThrow();
    }
  });

  it("allows retry (EXEC_FAILED -> READY)", () => {
    expect(() => assertTaskTransition("EXEC_FAILED", "READY")).not.toThrow();
    expect(() => assertTaskTransition("SCOPE_FAILED", "READY")).not.toThrow();
    expect(() => assertTaskTransition("VERIFY_FAILED", "READY")).not.toThrow();
    expect(() => assertTaskTransition("STALE", "READY")).not.toThrow();
  });

  it("allows staleness transitions", () => {
    expect(() => assertTaskTransition("LEASE_ACQUIRED", "STALE")).not.toThrow();
    expect(() => assertTaskTransition("RUNNING", "STALE")).not.toThrow();
    expect(() => assertTaskTransition("COMMIT_PRODUCED", "STALE")).not.toThrow();
    expect(() => assertTaskTransition("MERGED", "STALE")).not.toThrow();
  });

  it("includes state names in error message for task transitions", () => {
    expect(() => assertTaskTransition("VERIFIED" as TaskState, "READY" as TaskState))
      .toThrow(/VERIFIED.*READY/);
  });
});

describe("mapRunAbort", () => {
  it("maps baseline failures to ABORTED_BASELINE", () => {
    expect(mapRunAbort(REASON_CODES.BASELINE_GATE_FAILED)).toBe("ABORTED_BASELINE");
    expect(mapRunAbort(REASON_CODES.BASELINE_DIRTY_REPO)).toBe("ABORTED_BASELINE");
    expect(mapRunAbort(REASON_CODES.REPO_NOT_GIT)).toBe("ABORTED_BASELINE");
  });

  it("maps budget exhaustion to ABORTED_BUDGET", () => {
    expect(mapRunAbort(REASON_CODES.ABORTED_BUDGET)).toBe("ABORTED_BUDGET");
  });

  it("maps everything else to ABORTED_POLICY", () => {
    expect(mapRunAbort(REASON_CODES.SCOPE_DENY)).toBe("ABORTED_POLICY");
    expect(mapRunAbort(REASON_CODES.PROMPT_DRIFT)).toBe("ABORTED_POLICY");
    expect(mapRunAbort(REASON_CODES.PROVIDER_MISSING)).toBe("ABORTED_POLICY");
    expect(mapRunAbort(REASON_CODES.AUTH_MISSING)).toBe("ABORTED_POLICY");
  });
});
