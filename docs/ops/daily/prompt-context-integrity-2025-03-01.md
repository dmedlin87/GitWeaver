# Prompt and Context Integrity Audit

**Date:** 2025-03-01

## Checks Performed
1. Verified `stableStringify` handles `undefined` values safely and deterministically.
2. Verified `assertPromptDrift` checks non-hash immutable configuration fields (`taskId`, `runId`, `provider`, `baselineCommit`) alongside existing hash checks.
3. Verified `contextPackHash` calculation avoids circularly hashing its own empty placeholder string.

## Determinism Failures Found
1. **`stableStringify` returned undefined**: Passing `undefined` to `stableStringify` returned `undefined` instead of a string, violating the strict `string` return type signature and opening up potential edge cases for non-deterministic hash inputs when properties evaluate to undefined.
2. **Missing top-level config drift checks**: `assertPromptDrift` did not explicitly check fields that must remain immutable across retries (`taskId`, `runId`, `provider`, `baselineCommit`). If these had drifted between retries, it would not have been caught.
3. **Circular `contextPackHash` hashing**: The `contextPackHash` field was hashed while its value was set to an empty string (`""`) internally. While deterministic, hashing empty placeholder values internally is an antipattern for a strict integrity-focused hash.

## Fixes Applied
1. **Hardened `stableStringify`**: Updated `src/core/hash.ts` to strictly throw an error if the input value or the resulting `JSON.stringify` output is strictly `undefined`. Modified tests in `tests/unit/hash.test.ts` to verify the error is thrown.
2. **Expanded `assertPromptDrift`**: Updated `src/planning/prompt-envelope.ts` to explicitly check `taskId`, `runId`, `provider`, and `baselineCommit` for changes, throwing a drift error if any mutation occurs.
3. **Fixed `contextPackHash` calculation**: Modified `src/planning/context-pack.ts` to explicitly omit the `contextPackHash` key from the object passed into `stableStringify` during its own hash calculation.
4. **Expanded Integrity Tests**: Added multiple test cases in `tests/unit/prompt-integrity.test.ts` to explicitly verify the new drift detection behaviors for `taskId`, `runId`, `provider`, and `baselineCommit`.