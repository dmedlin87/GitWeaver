import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/observability/logger.js";

describe("Logger", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("info routes to console.log", () => {
    const logger = new Logger();
    logger.info("hello");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload.level).toBe("info");
    expect(payload.message).toBe("hello");
  });

  it("warn routes to console.warn", () => {
    const logger = new Logger();
    logger.warn("be careful");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(payload.level).toBe("warn");
    expect(payload.message).toBe("be careful");
  });

  it("error routes to console.error", () => {
    const logger = new Logger();
    logger.error("something failed");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(payload.level).toBe("error");
    expect(payload.message).toBe("something failed");
  });

  it("debug does NOT log when debugEnabled=false (default)", () => {
    const logger = new Logger(false);
    logger.debug("debug msg");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("debug logs to console.log when debugEnabled=true", () => {
    const logger = new Logger(true);
    logger.debug("debug detail");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload.level).toBe("debug");
    expect(payload.message).toBe("debug detail");
  });

  it("includes context in payload when provided", () => {
    const logger = new Logger();
    logger.info("with ctx", { runId: "abc", taskId: "t1" });
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload.context).toEqual({ runId: "abc", taskId: "t1" });
  });

  it("omits context key when no context provided", () => {
    const logger = new Logger();
    logger.info("no ctx");
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload.context).toBeUndefined();
  });

  it("includes ts field in output", () => {
    const logger = new Logger();
    logger.info("ts check");
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(typeof payload.ts).toBe("string");
    expect(() => new Date(payload.ts)).not.toThrow();
  });
});
