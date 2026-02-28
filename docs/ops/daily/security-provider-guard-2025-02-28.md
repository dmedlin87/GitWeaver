# Security & Provider Guard Daily Report - 2025-02-28

## Policy checks
- Verified that `AdvisoryExecutor` correctly defaults to denying network access unless `taskAllowsNetwork` is explicitly set to true.
- Verified that `AdvisoryExecutor` drops keys found in the `DENYLIST` effectively.

## Redaction checks
- Found a gap: Generic `npm_` tokens were not explicitly caught in standard default patterns.
- Checked `src/observability/redaction.ts` and added `/npm_[a-zA-Z0-9]{32}/gi` to target NPM access tokens. Tested and verified that it correctly redacts tokens.

## Provider reliability findings
- Discovered that provider authentication logic (`checkAuth` and `checkGeminiAuth` in `src/providers/preflight.ts`) was failing quietly with only generic messages like `{ status: "UNKNOWN", detail: (err as Error).message }` during error throws.
- Discovered that if no authentication check command is provided by the provider spec, the system returned a non-specific generic message.

## Fixes applied
- Added explicit test case and `npm_` token pattern handling in `src/observability/redaction.ts` so `redactSensitive` properly redacts NPM tokens.
- Updated `src/providers/preflight.ts` to prepend `Command execution failed: ` to error messages returned from failed `runCommand` executions for preflight authentication checks, guaranteeing these failure strings are fully deterministic and actionable.
- Updated `src/providers/preflight.ts` to return `"No auth check command defined in provider spec"` rather than an ambiguous empty response when missing.
