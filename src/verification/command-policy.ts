import type { RuntimeConfig } from "../core/config.js";
import type { TaskContract } from "../core/types.js";

/**
 * Validates a gate command against system and task-specific policies.
 * This is intended to prevent command injection from LLM-generated tasks.
 */
export function validateGateCommand(
  command: string,
  policy: TaskContract["commandPolicy"],
  config: RuntimeConfig
): void {
  if (!command) {
    return;
  }

  // 1. Check against the global denylist from config
  for (const denied of config.defaultCommandDeny) {
    if (command.includes(denied)) {
      throw new Error(`Gate command rejected: matches denylist pattern '${denied}'`);
    }
  }

  // 2. Check against the task-specific denylist
  for (const denied of policy.deny) {
    if (command.includes(denied)) {
      throw new Error(`Gate command rejected: matches task denylist pattern '${denied}'`);
    }
  }

  // 3. Check for dangerous shell metacharacters.
  // We are very strict here because gateCommand is executed in a shell.
  // We disallow most chaining and redirection characters.
  const dangerous = [";", "&", "|", ">", "<", "`", "$", "\n", "\r"];
  for (const char of dangerous) {
    if (command.includes(char)) {
      throw new Error(`Gate command rejected: contains dangerous shell character '${char}'`);
    }
  }

  // 4. Ensure it starts with an allowed base command if the policy specifies any
  if (policy.allow.length > 0) {
    const hasAllowedBase = policy.allow.some(
      (allowed) => command === allowed || command.startsWith(allowed + " ")
    );
    if (!hasAllowedBase) {
      throw new Error("Gate command rejected: not authorized by task command policy");
    }
  }
}
