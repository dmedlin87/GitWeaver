import type { SecureExecutor } from "./secure-executor.js";
import { SENSITIVE_ENV_DENYLIST } from "./env-denylist.js";

const ALLOWLIST = ["PATH", "SystemRoot", "ComSpec", "HOME", "USERPROFILE", "TMP", "TEMP", "CI", "NODE_ENV"];
const DENYLIST = SENSITIVE_ENV_DENYLIST;

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
    for (const key of DENYLIST) {
      delete env[key];
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