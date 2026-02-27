const DEFAULT_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,
  /(?:api|auth|access|refresh|secret)[-_ ]?token["'=:\s]+[A-Za-z0-9._-]{8,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /ghp_[A-Za-z0-9]{36}/g
];

export function redactSensitive(input: string, extraPatterns: RegExp[] = []): string {
  let output = input;
  for (const pattern of [...DEFAULT_PATTERNS, ...extraPatterns]) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}