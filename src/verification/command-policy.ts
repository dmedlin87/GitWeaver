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

<<<<<<< ours
  const allowed = policy.allow.some((pattern) => command.startsWith(pattern));
  if (!allowed) {
    return {
      allowed: false,
      reason: `Command does not start with any allowed prefix`
=======
  // 4. Enforce explicit allowlisting (deny by default when no allowlist is configured)
  if (policy.allow.length === 0) {
    return {
      allowed: false,
      reason: "Gate command rejected: no allowed commands configured in task command policy"
    };
  }

<<<<<<< ours
=======
  // 4. Enforce explicit allowlisting (deny by default when no allowlist is configured)
  if (policy.allow.length === 0) {
    return {
      allowed: false,
      reason: "Gate command rejected: no allowed commands configured in task command policy"
    };
  }

>>>>>>> theirs
  const hasAllowedBase = policy.allow.some(
    (allowed) => command === allowed || command.startsWith(allowed + " ")
  );
  if (!hasAllowedBase) {
    return {
      allowed: false,
      reason: "Gate command rejected: not authorized by task command policy"
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
    };
  }

  return { allowed: true };
}
