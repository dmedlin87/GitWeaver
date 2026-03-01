import { describe, expect, it, vi } from "vitest";
import { evaluateScope } from "../../src/verification/scope-policy.js";
import fs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi
      .fn()
      .mockImplementation((path: import("node:fs").PathLike) => {
        if (path.toString().includes("broken-link")) return true;
        return actual.existsSync(path);
      }),
    realpathSync: vi
      .fn()
      .mockImplementation((path: import("node:fs").PathLike) => {
        if (path.toString().includes("broken-link"))
          throw new Error("Mocked realpathSync error");
        return actual.realpathSync(path);
      }),
  };
});

describe("evaluateScope", () => {
  it("allows files inside allowlist", () => {
    const result = evaluateScope(
      process.cwd(),
      ["src/a.ts"],
      ["src/**/*.ts"],
      [],
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks files outside allowlist", () => {
    const result = evaluateScope(
      process.cwd(),
      ["README.md"],
      ["src/**/*.ts"],
      [],
    );
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("not in allowlist");
  });

  it("blocks files that match the denylist", () => {
    const result = evaluateScope(
      process.cwd(),
      ["src/secret.ts"],
      ["src/**/*.ts"],
      ["**/*secret*"],
    );
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("denylist match");
  });

  it("blocks files that escape the repository root", () => {
    // Attempting a directory traversal
    const result = evaluateScope(
      process.cwd(),
      ["../outside-repo.ts"],
      ["**/*.ts"],
      [],
    );
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("escapes repository root");
  });

  it("handles fs normalization errors gracefully", () => {
    // Tests the catch block in canonicalize where realpathSync throws
    // The mocked fs.existsSync returns true and realpathSync throws for "broken-link.ts"
    const result = evaluateScope(
      process.cwd(),
      ["src/broken-link.ts"],
      ["src/**/*.ts"],
      [],
    );
    expect(result.allowed).toBe(true);
    // Since it falls back to normalize(normalized), it should successfully match the allowlist.
    expect(result.normalizedFiles[0]).toContain("broken-link.ts");
  });
});
