import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderId } from "../core/types.js";
import { PROVIDER_SPECS } from "../providers/registry.js";

function providerConfigPaths(provider: ProviderId): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) {
    return [];
  }

  const paths = PROVIDER_SPECS[provider]?.configPaths || [];
  return paths.map(p => join(home, p));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function createSandboxHome(runId: string, taskId: string, provider: ProviderId): Promise<string> {
  const home = join(tmpdir(), "orc-home", runId, taskId);
  await fs.mkdir(home, { recursive: true });

  const tasks: Promise<void>[] = [];
  for (const source of providerConfigPaths(provider)) {
    tasks.push(
      (async () => {
        if (!(await fileExists(source))) {
          return;
        }
        const target = join(home, basename(source));
        await fs.cp(source, target, { recursive: true, errorOnExist: false, force: true });
      })()
    );
  }

  await Promise.all(tasks);

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
