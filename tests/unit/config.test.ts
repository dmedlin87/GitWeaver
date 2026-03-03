import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../../src/core/config.js";

describe("loadConfig", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("returns defaults when config path is not provided", () => {
    const loaded = loadConfig(undefined);
    expect(loaded).toBe(DEFAULT_CONFIG);
    expect(loaded.providerExecutionTimeoutSec).toBe(600);
  });

  it("deep merges nested objects while preserving unspecified defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitweaver-config-"));
    tempDirs.push(dir);
    const path = join(dir, "config.json");

    writeFileSync(
      path,
      JSON.stringify({
        providerBuckets: {
          codex: 3
        },
        smokeGateByType: {
          docs: "pnpm -s lint"
        },
        defaultNetworkPolicy: "allow",
        providerExecutionTimeoutSec: 450
      }),
      "utf8"
    );

    const loaded = loadConfig(path);
    expect(loaded.providerBuckets).toEqual({
      codex: 3,
      claude: DEFAULT_CONFIG.providerBuckets.claude,
      gemini: DEFAULT_CONFIG.providerBuckets.gemini
    });
    expect(loaded.smokeGateByType).toEqual({
      ...DEFAULT_CONFIG.smokeGateByType,
      docs: "pnpm -s lint"
    });
    expect(loaded.defaultNetworkPolicy).toBe("allow");
    expect(loaded.providerExecutionTimeoutSec).toBe(450);
  });

  it("throws when config file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitweaver-config-"));
    tempDirs.push(dir);
    const missingPath = join(dir, "missing.json");

    expect(() => loadConfig(missingPath)).toThrow();
  });

  it("throws when config file contains invalid json", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitweaver-config-"));
    tempDirs.push(dir);
    const path = join(dir, "broken.json");
    writeFileSync(path, "{invalid-json", "utf8");

    expect(() => loadConfig(path)).toThrow();
  });
});
