# Security and Provider Guard Report - 2026-02-27

## Policy Checks
- **Command Policy**: Verified deny-by-default behavior remains intact via `tests/unit/secure-executor.test.ts`.
- **Environment Policy**: hardened `AdvisoryExecutor` to strip `GITHUB_TOKEN`, `GH_TOKEN`, and `NPM_TOKEN` from child process environments.

## Redaction Checks
- **Sensitive Data**: Added `ghp_[a-zA-Z0-9]{36}` pattern to `src/observability/redaction.ts`.
- **Verification**: Validated with new test case in `tests/unit/redaction.test.ts` ensuring GitHub Personal Access Tokens are redacted.

## Provider Reliability Findings
- **Issue**: Auth checks for providers (e.g., Gemini) were returning generic "UNKNOWN" or "MISSING" statuses without actionable details.
- **Improvement**: Refactored `checkAuth` in `src/providers/preflight.ts` to bubble up specific error messages (e.g., stderr output, exit codes) into the `issues` list.

## Fixes Applied
1.  **Environment Hardening**: Added `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN` to `DENYLIST` in `src/secure/advisory-executor.ts`.
2.  **Redaction**: Added GitHub PAT regex to `src/observability/redaction.ts`.
3.  **Diagnostics**: Updated `src/providers/preflight.ts` to include detailed error messages in provider status reports.
4.  **Testing**: Added unit tests for all the above changes.
