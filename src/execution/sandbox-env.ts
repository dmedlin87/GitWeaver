import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderId } from "../core/types.js";

function providerConfigPaths(provider: ProviderId): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) {
    return [];
  }

  if (provider === "codex") {
    return [join(home, ".codex")];
  }
  if (provider === "claude") {
    return [join(home, ".claude")];
  }
  return [join(home, ".gemini"), join(home, ".config", "gemini")];
}

export function createSandboxHome(runId: string, taskId: string, provider: ProviderId): string {
  const home = join(tmpdir(), "orc-home", runId, taskId);
  mkdirSync(home, { recursive: true });

  for (const source of providerConfigPaths(provider)) {
    if (!existsSync(source)) {
      continue;
    }
    const target = join(home, source.split(/[\\/]/).pop() ?? "provider-config");
    cpSync(source, target, { recursive: true, errorOnExist: false, force: true });
  }

  return home;
}

export function buildSandboxEnv(baseEnv: NodeJS.ProcessEnv, sandboxHome: string): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    HOME: sandboxHome,
    USERPROFILE: sandboxHome
  };
}