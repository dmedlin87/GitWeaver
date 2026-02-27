import { cpSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
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
    const target = join(home, basename(source));
    cpSync(source, target, { recursive: true, errorOnExist: false, force: true });
  }

  return home;
}

const SAFE_ENV_VARS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM"];

export function buildSandboxEnv(baseEnv: NodeJS.ProcessEnv, sandboxHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of SAFE_ENV_VARS) {
    if (baseEnv[key] !== undefined) {
      env[key] = baseEnv[key];
    }
  }

  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith("ORCH_") && value !== undefined) {
      env[key] = value;
    }
  }

  env.HOME = sandboxHome;
  env.USERPROFILE = sandboxHome;
  env.TMP = tmpdir();
  env.TEMP = tmpdir();

  return env;
}