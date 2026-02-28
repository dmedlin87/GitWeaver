import { describe, expect, it } from "vitest";
import { Metrics } from "../../src/observability/metrics.js";

describe("Metrics", () => {
  it("inc increments counter from 0", () => {
    const m = new Metrics();
    m.inc("tasks.completed");
    const snap = m.snapshot();
    expect((snap.counters as Record<string, number>)["tasks.completed"]).toBe(1);
  });

  it("inc accumulates multiple calls", () => {
    const m = new Metrics();
    m.inc("tasks.completed");
    m.inc("tasks.completed", 3);
    const snap = m.snapshot();
    expect((snap.counters as Record<string, number>)["tasks.completed"]).toBe(4);
  });

  it("inc with default value=1 when not specified", () => {
    const m = new Metrics();
    m.inc("x");
    expect((m.snapshot().counters as Record<string, number>)["x"]).toBe(1);
  });

  it("endTimer does nothing when no timer started", () => {
    const m = new Metrics();
    // Should not throw
    expect(() => m.endTimer("nonexistent")).not.toThrow();
    const snap = m.snapshot();
    expect(Object.keys(snap.histograms as object)).toHaveLength(0);
  });

  it("startTimer and endTimer record elapsed time in histogram", () => {
    const m = new Metrics();
    m.startTimer("task.duration", { provider: "codex" });
    m.endTimer("task.duration");

    const snap = m.snapshot();
    const histograms = snap.histograms as Record<string, number[]>;
    const keys = Object.keys(histograms);
    expect(keys.length).toBeGreaterThan(0);
    const key = keys[0]!;
    expect(key).toContain("task.duration");
    expect(histograms[key]!.length).toBe(1);
    expect(histograms[key]![0]).toBeGreaterThanOrEqual(0);
  });

  it("histogram key includes label JSON", () => {
    const m = new Metrics();
    m.startTimer("op", { phase: "A" });
    m.endTimer("op");

    const snap = m.snapshot();
    const histograms = snap.histograms as Record<string, number[]>;
    const key = Object.keys(histograms)[0]!;
    expect(key).toContain("phase");
  });

  it("histogram accumulates multiple timing samples", () => {
    const m = new Metrics();
    m.startTimer("op");
    m.endTimer("op");
    m.startTimer("op");
    m.endTimer("op");

    const snap = m.snapshot();
    const histograms = snap.histograms as Record<string, number[]>;
    const key = Object.keys(histograms)[0]!;
    expect(histograms[key]!.length).toBe(2);
  });

  it("endTimer removes the timer after recording", () => {
    const m = new Metrics();
    m.startTimer("op");
    m.endTimer("op");
    // A second endTimer should not add to the histogram
    m.endTimer("op");
    const snap = m.snapshot();
    const histograms = snap.histograms as Record<string, number[]>;
    const key = Object.keys(histograms)[0]!;
    // Only 1 sample because second endTimer had no timer to stop
    expect(histograms[key]!.length).toBe(1);
  });

  it("snapshot includes both counters and histograms", () => {
    const m = new Metrics();
    m.inc("x");
    m.startTimer("y");
    m.endTimer("y");

    const snap = m.snapshot();
    expect(snap.counters).toBeDefined();
    expect(snap.histograms).toBeDefined();
  });

  it("snapshot returns empty objects initially", () => {
    const m = new Metrics();
    const snap = m.snapshot();
    expect(Object.keys(snap.counters as object)).toHaveLength(0);
    expect(Object.keys(snap.histograms as object)).toHaveLength(0);
  });

  it("histogram name uses empty labels when none provided", () => {
    const m = new Metrics();
    m.startTimer("plain");
    m.endTimer("plain");

    const snap = m.snapshot();
    const histograms = snap.histograms as Record<string, number[]>;
    const key = Object.keys(histograms)[0]!;
    expect(key).toContain("plain:");
    expect(key).toContain("{}");
  });
});
