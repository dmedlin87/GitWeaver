# Daily Prompt Drift and Context Integrity Audit

**Date:** 2026-03-07

## Checks Performed
- Verified immutable sections remain hash-stable across retries.
- Verified only mutable retry fields (`failureEvidence` and `boundedHints`) can change.
- Verified ContextPack selection is deterministic (ordering, byte budget, hash repeatability).
- Added/expanded tests for drift detection and deterministic context hashing by running test suite `tests/unit/prompt-integrity.test.ts`.
- Validated system via `pnpm test` and `pnpm build`.

## Determinism Failures Found
- Discovered test mocks for `buildPromptEnvelope` in `tests/integration/watchdog-hang-recovery.test.ts` and `tests/unit/orchestrator-policy.test.ts` were missing the required `mutableSections` property, causing `TypeError: Cannot read properties of undefined (reading 'failureEvidence')` during property access in downstream logic, creating ambiguity in what constitutes stable mock state.

## Fixes Applied
- Updated test mocks for `buildPromptEnvelope` across integration and unit tests to explicitly return `mutableSections: {}` to ensure tests accurately mirror the runtime prompt envelope schema and enforce immutability correctly.
