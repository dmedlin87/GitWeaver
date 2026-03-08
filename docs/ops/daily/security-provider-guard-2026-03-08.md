# Security and Provider Operations Guard Report
Date: 2026-03-08

## Policy checks
- Verified that `AdvisoryExecutor`, `HostExecutor`, and `ContainerExecutor` enforce deny-by-default behavior for `networkAllowed`. They now explicitly fallback to `false` when `taskAllowsNetwork` is undefined.

## Redaction checks
- Verified that `redactSensitive` in `src/observability/redaction.ts` successfully redacts OpenAI/Anthropic keys. Expanded the redaction regex to cover keys containing underscores as well as hyphens (e.g. `sk_...` vs `sk-...`).

## Provider reliability findings
- Discovered an issue in `src/providers/preflight.ts` where the error message prefix `'Command execution failed:'` was duplicated due to case-insensitive outputs from some CLI tools.
- Provider auth check methods return error details in different cases, leading to confusing double prefixes for auth issues.

## Fixes applied
- Updated `src/providers/preflight.ts` to use `.toLowerCase().startsWith('command execution failed:')` to accurately deduplicate the error prefix.
- Updated `AdvisoryExecutor`, `HostExecutor`, and `ContainerExecutor` to return `taskAllowsNetwork ?? false` in their `networkAllowed` methods, ensuring strict deny-by-default network policy.
- Updated the regex in `src/observability/redaction.ts` to `/sk[-_][A-Za-z0-9_-]{20,}/g` to effectively match `sk_` keys.
- Added comprehensive unit tests in `tests/unit/redaction.test.ts`, `tests/unit/preflight-extended.test.ts`, and the executor test files to verify these changes.
