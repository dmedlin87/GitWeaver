import type { RuntimeConfig } from "../core/config.js";

export interface CommandPolicy {
  allow: string[];
  deny: string[];
  network?: "deny" | "allow";
}

export interface PolicyValidation {
  allowed: boolean;
  reason?: string;
}

export function validateCommand(
  command: string,
  policy: CommandPolicy,
  config?: RuntimeConfig,
): PolicyValidation {
  if (!command) {
    return { allowed: true };
  }

  // 1. Check against the global denylist from config
  if (config?.defaultCommandDeny) {
    for (const denied of config.defaultCommandDeny) {
      if (command.includes(denied)) {
        return {
          allowed: false,
          reason: `Gate command rejected: matches denylist pattern '${denied}'`,
        };
      }
    }
  }

  // 2. Check against the task-specific denylist
  for (const denied of policy.deny) {
    if (command.includes(denied)) {
      return {
        allowed: false,
        reason: `Gate command rejected: matches task denylist pattern '${denied}'`,
      };
    }
  }

  // 3. Check for dangerous shell metacharacters.
  // We are very strict here because gateCommand is executed in a shell.
  // We disallow most chaining and redirection characters.
  const dangerous = [";", "&", "|", ">", "<", "`", "$", "\n", "\r"];
  for (const char of dangerous) {
    if (command.includes(char)) {
      return {
        allowed: false,
        reason: `Gate command rejected: contains dangerous shell character '${char}'`,
      };
    }
  }

  // 4. Enforce explicit allowlisting (deny by default when no allowlist is configured)
  if (policy.allow.length === 0) {
    return {
      allowed: false,
      reason:
        "Gate command rejected: no allowed commands configured in task command policy",
    };
  }

  // 5. Ensure it starts with an allowed base command
  const hasAllowedBase = policy.allow.some(
    (allowed) => command === allowed || command.startsWith(allowed + " "),
  );
  if (!hasAllowedBase) {
    return {
      allowed: false,
      reason: "Gate command rejected: not authorized by task command policy",
    };
  }

  return { allowed: true };
}
