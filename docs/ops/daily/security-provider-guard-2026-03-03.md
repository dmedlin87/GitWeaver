# Daily Security and Provider Guard Report: 2026-03-03

## Policy checks
- Verified `DENYLIST` environment variable filtering in `HostExecutor`, `AdvisoryExecutor`, and `PtyManager`. Sensitive data like `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SESSION_TOKEN`, `GITHUB_TOKEN`, and `NPM_TOKEN` are properly scrubbed from child process environments.
- Enforced strict "deny" default for the `networkPolicy` option in `GeminiAdapter`, `ClaudeAdapter`, and `CodexAdapter`. If not specified, containers are run without network access by default.

## Redaction checks
- Validated `redactSensitive` logic in `src/observability/redaction.ts`. `sk-` (OpenAI/Anthropic), `AKIA` (AWS), `ghp_` (GitHub), and `npm_` tokens are correctly masked.

## Provider reliability findings
- Identified a duplicate error prefix issue where `"Command execution failed:"` was repeatedly prepended to missing or unknown authentication check errors in `preflight.ts`.
- Preflight error messages for `UNKNOWN` and `MISSING` auth statuses needed to be cleanly constructed without duplicated log prefixes.

## Fixes applied
- Updated `gemini`, `claude`, and `codex` provider adapters to default to `networkPolicy ?? "deny"` when calling `runInContainer`.
- Modified `src/providers/preflight.ts` logic to only add `"Command execution failed: "` prefix to the auth check output if it does not already start with that prefix, preventing nested errors like `"Command execution failed: Command execution failed: ..."`.
- Updated unit tests (`tests/unit/preflight.test.ts`, `tests/unit/gemini-adapter-container.test.ts`, `tests/unit/claude-adapter.test.ts`, and `tests/unit/codex-adapter.test.ts`) to ensure regression prevention.
