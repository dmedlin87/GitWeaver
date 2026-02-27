import { describe, expect, it } from "vitest";
import { assertRunTransition, assertTaskTransition, type RunState, type TaskState } from "../../src/core/state-machine.js";

describe("state-machine", () => {
  describe("assertRunTransition", () => {
    it("allows valid run transitions", () => {
      const validTransitions: [RunState, RunState][] = [
        ["INGEST", "BASELINE_OK"],
        ["BASELINE_OK", "PLAN_FROZEN"],
        ["PLAN_FROZEN", "DISPATCHING"],
        ["DISPATCHING", "INTEGRATING"],
        ["INTEGRATING", "VERIFYING"],
        ["VERIFYING", "COMPLETED"],
        ["REPAIRING", "INTEGRATING"],
        ["DISPATCHING", "ABORTED_BUDGET"],
        ["INGEST", "ABORTED_POLICY"],
        ["INGEST", "ABORTED_BASELINE"],
      ];

      validTransitions.forEach(([from, to]) => {
        expect(() => assertRunTransition(from, to)).not.toThrow();
      });
    });

    it("throws on invalid run transitions", () => {
      const invalidTransitions: [RunState, RunState][] = [
        ["INGEST", "DISPATCHING"],
        ["COMPLETED", "INGEST"],
        ["ABORTED_POLICY", "INGEST"],
        ["VERIFYING", "INGEST"],
        ["REPAIRING", "COMPLETED"], // Not directly allowed based on code inspection
      ];

      invalidTransitions.forEach(([from, to]) => {
        expect(() => assertRunTransition(from, to)).toThrow(`Invalid run transition ${from} -> ${to}`);
      });
    });
  });

  describe("assertTaskTransition", () => {
    it("allows valid task transitions", () => {
      const validTransitions: [TaskState, TaskState][] = [
        ["PENDING", "READY"],
        ["READY", "LEASE_ACQUIRED"],
        ["LEASE_ACQUIRED", "RUNNING"],
        ["RUNNING", "COMMIT_PRODUCED"],
        ["COMMIT_PRODUCED", "SCOPE_PASSED"],
        ["SCOPE_PASSED", "MERGE_QUEUED"],
        ["MERGE_QUEUED", "MERGED"],
        ["MERGED", "VERIFIED"],
        ["RUNNING", "EXEC_FAILED"],
        ["LEASE_ACQUIRED", "STALE"],
        ["PENDING", "ESCALATED"],
      ];

      validTransitions.forEach(([from, to]) => {
        expect(() => assertTaskTransition(from, to)).not.toThrow();
      });
    });

    it("throws on invalid task transitions", () => {
      const invalidTransitions: [TaskState, TaskState][] = [
        ["PENDING", "RUNNING"],
        ["VERIFIED", "PENDING"],
        ["ESCALATED", "PENDING"],
        ["MERGED", "PENDING"],
        ["SCOPE_FAILED", "MERGED"],
      ];

      invalidTransitions.forEach(([from, to]) => {
        expect(() => assertTaskTransition(from, to)).toThrow(`Invalid task transition ${from} -> ${to}`);
      });
    });
  });
});
