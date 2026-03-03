import type { SecureExecutor } from "./secure-executor.js";

const ALLOWLIST = ["PATH", "SystemRoot", "ComSpec", "HOME", "USERPROFILE", "TMP", "TEMP", "CI", "NODE_ENV"];
const DENYLIST = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN"
];

export class AdvisoryExecutor implements SecureExecutor {
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
    const denyLower = new Set(DENYLIST.map((k) => k.toLowerCase()));
    for (const key of Object.keys(env)) {
      if (denyLower.has(key.toLowerCase())) {
        delete env[key];
      }
    }
    return env;
  }

  public networkAllowed(taskAllowsNetwork: boolean): boolean {
    return taskAllowsNetwork;
  }

  public modeName(): string {
    return "advisory";
  }
}