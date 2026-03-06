# Security and Provider Operations Guard Report - 2026-03-06

## Policy Checks
- **Command/Network Behavior**: Verified and hardened `networkAllowed` policies in execution environments (`AdvisoryExecutor`, `HostExecutor`, and `ContainerExecutor`). The policy now explicitly falls back to `false` when `taskAllowsNetwork` is undefined, adhering to the strict deny-by-default standard without hardcoding permissive values. The signature of the method was modified to accept `taskAllowsNetwork?: boolean`.

## Redaction Checks
- **Log/Artifact Redaction**: Audited the `redactSensitive` utility in `src/observability/redaction.ts`. The regex pattern used to catch OpenAI/Anthropic keys was updated from `/sk-[A-Za-z0-9_-]{20,}/g` to `/sk[-_][A-Za-z0-9_-]{20,}/g` to successfully match and redact keys starting with either hyphens or underscores (e.g., `sk_...`), preventing sensitive data leakage.

## Provider Reliability Findings
- **Preflight Failure Messages**: Discovered that provider preflight failure reports for `MISSING` and `UNKNOWN` auth statuses were at risk of prepending redundant `Command execution failed: ` prefixes, which diminishes readability and determinism in logs.

## Fixes Applied
1. **Deny-by-default Networking**: Changed `networkAllowed(taskAllowsNetwork?: boolean)` in all executors to return `taskAllowsNetwork ?? false`. Added coverage for `undefined` inputs.
2. **Deterministic Preflight Error Prefixes**: In `src/providers/preflight.ts`, updated prefix conditional logic to use `toLowerCase().startsWith("command execution failed:")` to gracefully avoid string duplication regardless of casing. Added unit tests for case-insensitive verification.
3. **Comprehensive Key Redaction**: Modified default key patterns in `redaction.ts` to include underscore matches alongside hyphens for provider keys (`sk[-_]`). Added dedicated tests confirming underscore support.