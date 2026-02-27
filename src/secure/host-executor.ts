import type { SecureExecutor } from "./secure-executor.js";

const ALLOWLIST = ["PATH", "SystemRoot", "ComSpec", "HOME", "USERPROFILE", "TMP", "TEMP", "CI", "NODE_ENV"];
const DENYLIST = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN"
];

export class HostExecutor implements SecureExecutor {
  public prepareEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ALLOWLIST) {
      if (baseEnv[key]) {
        env[key] = baseEnv[key];
      }
    }
    for (const [key, value] of Object.entries(baseEnv)) {
      if (key.startsWith("ORCH_") && value !== undefined) {
        env[key] = value;
      }
    }
    for (const key of DENYLIST) {
      delete env[key];
    }
    return env;
  }

  public networkAllowed(_taskAllowsNetwork: boolean): boolean {
    // Host mode cannot reliably enforce network deny, so we allow execution.
    return true;
  }

  public modeName(): string {
    return "host";
  }
}
