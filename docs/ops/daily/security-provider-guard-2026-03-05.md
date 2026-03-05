# Daily Security and Provider Operations Guard Report
**Date:** 2026-03-05

## Policy checks
- Enforced strict deny-by-default network policy across all execution environments (`HostExecutor`, `AdvisoryExecutor`, `ContainerExecutor`). The `networkAllowed` method now explicitly returns `taskAllowsNetwork ?? false`, preventing any permissive fallback.

## Redaction checks
- Tested and verified sensitive data redaction in `src/observability/redaction.ts`.
- Addressed gap by updating the OpenAI/Anthropic key redaction regex to support both hyphens and underscores (`/sk[-_][A-Za-z0-9_-]{20,}/g`), preventing credential leakage of valid token formats.

## Provider reliability findings
- Discovered duplicate "Command execution failed:" prefixes in provider preflight check error logs when underlying provider adapter strings used different casing.

## Fixes applied
- Updated redaction regex (`DEFAULT_PATTERNS`) in `src/observability/redaction.ts` to strictly catch OpenAI/Anthropic keys starting with `sk_` or `sk-`.
- Refactored preflight error handling in `src/providers/preflight.ts` to perform a case-insensitive check (`toLowerCase().startsWith()`), guaranteeing deterministic and actionable issue messages.
- Strengthened `networkAllowed` interface implementation in `src/secure/host-executor.ts`, `src/secure/advisory-executor.ts`, and `src/secure/container-executor.ts`.
