import { describe, expect, it } from "vitest";
import { RepairBudget } from "../../src/repair/repair-budget.js";

describe("RepairBudget", () => {
  it("allows attempts when count is within budget", () => {
    const budget = new RepairBudget(3);
    expect(budget.allowed("EXEC_FAILED")).toBe(true);
  });

  it("increment returns the new attempt count", () => {
    const budget = new RepairBudget(3);
    expect(budget.increment("EXEC_FAILED")).toBe(1);
    expect(budget.increment("EXEC_FAILED")).toBe(2);
    expect(budget.increment("EXEC_FAILED")).toBe(3);
  });

  it("still allowed when count equals maxAttemptsPerClass", () => {
    const budget = new RepairBudget(2);
    budget.increment("EXEC_FAILED");
    budget.increment("EXEC_FAILED");
    // count === maxAttemptsPerClass (2), should still be allowed (<=)
    expect(budget.allowed("EXEC_FAILED")).toBe(true);
  });

  it("disallows after exceeding maxAttemptsPerClass", () => {
    const budget = new RepairBudget(2);
    budget.increment("EXEC_FAILED");
    budget.increment("EXEC_FAILED");
    budget.increment("EXEC_FAILED"); // count = 3 > 2
    expect(budget.allowed("EXEC_FAILED")).toBe(false);
  });

  it("tracks different failure classes independently", () => {
    const budget = new RepairBudget(1);
    budget.increment("EXEC_FAILED");
    budget.increment("EXEC_FAILED"); // now at 2, exceeds budget

    // Different class should still be allowed
    expect(budget.allowed("EXEC_FAILED")).toBe(false);
    expect(budget.allowed("SCOPE_FAILED")).toBe(true);
  });

  it("returns 0 attempts for unseen failure class in allowed check", () => {
    const budget = new RepairBudget(5);
    expect(budget.allowed("VERIFY_FAIL_COMPILE")).toBe(true);
  });

  it("snapshot returns current counts for all classes", () => {
    const budget = new RepairBudget(3);
    budget.increment("EXEC_FAILED");
    budget.increment("EXEC_FAILED");
    budget.increment("SCOPE_FAILED");

    const snap = budget.snapshot();
    expect(snap["EXEC_FAILED"]).toBe(2);
    expect(snap["SCOPE_FAILED"]).toBe(1);
  });

  it("snapshot returns empty object when no increments", () => {
    const budget = new RepairBudget(3);
    expect(budget.snapshot()).toEqual({});
  });
});
