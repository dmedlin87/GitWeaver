export interface CommandPolicy {
  allow: string[];
  deny: string[];
  network?: "deny" | "allow";
}

export interface PolicyValidation {
  allowed: boolean;
  reason?: string;
}

export function validateCommand(command: string, policy: CommandPolicy): PolicyValidation {
  if (policy.allow.length === 0) {
    return {
      allowed: false,
      reason: "Command policy allowlist is empty (deny-by-default)"
    };
  }

  for (const deny of policy.deny) {
    if (command.includes(deny)) {
      return {
        allowed: false,
        reason: `Command contains denied pattern: '${deny}'`
      };
    }
  }

  const allowed = policy.allow.some((pattern) => command.startsWith(pattern));
  if (!allowed) {
    return {
      allowed: false,
      reason: `Command does not start with any allowed prefix`
    };
  }

  return { allowed: true };
}
