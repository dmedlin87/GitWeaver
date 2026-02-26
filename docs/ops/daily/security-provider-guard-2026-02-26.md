# Security and Provider Reliability Guard Report - 2026-02-26

## Policy Checks

### Deny-by-Default Verification
- **AdvisoryExecutor**: Verified strict allowlist behavior for environment variables.
  - `ALLOWLIST` variables are preserved.
  - `ORCH_` prefixed variables are preserved.
  - `DENYLIST` variables are explicitly removed.
  - All other variables are removed.
- **Network Policy**: Verified `networkAllowed` respects the `taskAllowsNetwork` flag (deny by default if flag is false).

## Redaction Checks

### Secrets Redaction
- **Coverage**: Verified redaction for:
  - OpenAI-style keys (`sk-...`)
  - AWS Access Keys (`AKIA...`)
  - Generic tokens with keywords (`api_token`, `auth_token`, `secret`, etc.)
- **Tests**: Added `tests/unit/redaction.test.ts` to ensure patterns are effective and handle multiline input.

## Provider Reliability Findings

### Preflight Checks
- **Gap Identified**: When provider authentication check fails with an unknown error (e.g., timeout or crash), the preflight report showed `authStatus: "UNKNOWN"` but did not include an actionable issue message.
- **Fix Applied**: Updated `src/providers/preflight.ts` to add a specific issue message: "Authentication status unknown (check timed out or failed)." when `authStatus` is `UNKNOWN`.
- **Verification**: Added test case in `tests/unit/preflight.test.ts` covering this scenario.

## Fixes Applied
- **Code**: `src/providers/preflight.ts` updated to handle `UNKNOWN` auth status.
- **Tests**:
  - Created `tests/unit/secure-executor.test.ts`
  - Created `tests/unit/redaction.test.ts`
  - Updated `tests/unit/preflight.test.ts`
