# Daily Security & Provider Operations Guard Report - 2026-03-01

## Policy checks
- **Status:** FAIL -> PASS
- **Findings:** `HostExecutor` was permissively defaulting to `return true` regardless of `taskAllowsNetwork`, circumventing strict deny-by-default network behavior.
- **Fixes applied:** Updated `HostExecutor.networkAllowed(taskAllowsNetwork: boolean)` to strictly return `taskAllowsNetwork`. Verified through integration testing in `tests/unit/host-executor.test.ts` and `tests/unit/secure-factory.test.ts`.

## Redaction checks
- **Status:** FAIL -> PASS
- **Findings:** The regex used for NPM tokens was set to `/npm_[a-zA-Z0-9]{36,40}/gi`, incorrectly missing 32-character tokens (the standard length).
- **Fixes applied:** Updated the NPM token regex in `src/observability/redaction.ts` to `/npm_[a-zA-Z0-9]{32,40}/gi` to guarantee standard token masking without partially leaking longer tokens. Tested logic via updated cases in `tests/unit/redaction.test.ts`.

## Provider reliability findings
- **Status:** FAIL -> PASS
- **Findings:** `checkSingleProvider` in `src/providers/preflight.ts` emitted non-deterministic outputs like "Authentication status unknown: check timed out or failed" or "Details: [error]". This deviated from the standard contract requiring failures to be context-rich and deterministic.
- **Fixes applied:** Enforced failure messages to use strictly format `Command execution failed: ${authResult.detail ?? "check timed out or failed"}`. Verified determinism in `tests/unit/preflight.test.ts`.

## Fixes applied
- `src/secure/host-executor.ts`
- `src/observability/redaction.ts`
- `src/providers/preflight.ts`
- Unit tests aligned in `tests/unit/redaction.test.ts`, `tests/unit/preflight.test.ts`, `tests/unit/host-executor.test.ts`, and `tests/unit/secure-factory.test.ts`.
