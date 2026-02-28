import { describe, expect, it } from "vitest";
import { buildRepairTask } from "../../src/repair/repair-planner.js";
import { makeTaskContract } from "../helpers/runtime-context-fixture.js";

describe("buildRepairTask", () => {
  const base = makeTaskContract({
    taskId: "task-1",
    title: "Build feature X",
    provider: "claude",
    type: "code",
    writeScope: {
      allow: ["src/**", "tests/**"],
      deny: ["dist/**"],
      ownership: "exclusive"
    }
  });

  it("creates a repair task with correct taskId suffix", () => {
    const repair = buildRepairTask({
      failedTask: base,
      changedFiles: ["src/foo.ts"],
      errorFiles: ["src/bar.ts"]
    });
    expect(repair.taskId).toBe("task-1-repair");
  });

  it("sets type to repair", () => {
    const repair = buildRepairTask({ failedTask: base, changedFiles: [], errorFiles: [] });
    expect(repair.type).toBe("repair");
  });

  it("sets dependency on the failed task", () => {
    const repair = buildRepairTask({ failedTask: base, changedFiles: [], errorFiles: [] });
    expect(repair.dependencies).toContain("task-1");
  });

  it("narrows allow scope to union of changedFiles and errorFiles", () => {
    const repair = buildRepairTask({
      failedTask: base,
      changedFiles: ["src/a.ts"],
      errorFiles: ["src/b.ts"]
    });
    expect(repair.writeScope.allow).toContain("src/a.ts");
    expect(repair.writeScope.allow).toContain("src/b.ts");
  });

  it("deduplicates files in narrowed allow scope", () => {
    const repair = buildRepairTask({
      failedTask: base,
      changedFiles: ["src/a.ts", "src/b.ts"],
      errorFiles: ["src/a.ts"]
    });
    const count = repair.writeScope.allow.filter((f) => f === "src/a.ts").length;
    expect(count).toBe(1);
  });

  it("falls back to original allow scope when no changed/error files", () => {
    const repair = buildRepairTask({
      failedTask: base,
      changedFiles: [],
      errorFiles: []
    });
    expect(repair.writeScope.allow).toEqual(base.writeScope.allow);
  });

  it("preserves deny scope from original task", () => {
    const repair = buildRepairTask({ failedTask: base, changedFiles: [], errorFiles: [] });
    expect(repair.writeScope.deny).toEqual(base.writeScope.deny);
  });

  it("forces outputVerificationRequired to true", () => {
    const taskWithoutVerify = makeTaskContract({ verify: { outputVerificationRequired: false } });
    const repair = buildRepairTask({ failedTask: taskWithoutVerify, changedFiles: [], errorFiles: [] });
    expect(repair.verify.outputVerificationRequired).toBe(true);
  });

  it("inherits gateCommand from original task", () => {
    const taskWithGate = makeTaskContract({ verify: { gateCommand: "pnpm test", outputVerificationRequired: true } });
    const repair = buildRepairTask({ failedTask: taskWithGate, changedFiles: [], errorFiles: [] });
    expect(repair.verify.gateCommand).toBe("pnpm test");
  });

  it("generates a contractHash", () => {
    const repair = buildRepairTask({ failedTask: base, changedFiles: [], errorFiles: [] });
    expect(typeof repair.contractHash).toBe("string");
    expect(repair.contractHash.length).toBeGreaterThan(0);
  });

  it("produces a deterministic contractHash", () => {
    const input = { failedTask: base, changedFiles: ["src/x.ts"], errorFiles: [] };
    const r1 = buildRepairTask(input);
    const r2 = buildRepairTask(input);
    expect(r1.contractHash).toBe(r2.contractHash);
  });

  it("uses original title with Repair prefix", () => {
    const repair = buildRepairTask({ failedTask: base, changedFiles: [], errorFiles: [] });
    expect(repair.title).toContain("Repair");
    expect(repair.title).toContain(base.title);
  });
});
