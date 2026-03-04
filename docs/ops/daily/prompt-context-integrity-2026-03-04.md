# Prompt Drift and Context Integrity Audit

## Checks performed
- Verifying `immutableSections` hashing is deterministic.
- Verifying `assertPromptDrift` covers strict hash validation while ignoring `mutableSections`.
- Verifying `ContextPack` selection logic.
- Verifying `stableStringify` behaviors with object properties holding `undefined` (specifically `contextPackHash: undefined` pattern).

## Determinism failures found
- `buildPromptEnvelope` logic constructs deterministic hashes but lacked strong enforcement for `mutableSections` isolation in mock objects during test execution.
- `stableStringify` handles `undefined` values correctly for object properties but was missing explicit test coverage to prevent regression.

## Fixes applied
- Fixed vitest mocked `buildPromptEnvelope` in `tests/integration/watchdog-hang-recovery.test.ts` to explicitly include `mutableSections`.
- Fixed vitest mocked `buildPromptEnvelope` in `tests/unit/orchestrator-policy.test.ts` to explicitly include `mutableSections`.
- Expanded tests for `stableStringify` in `tests/unit/hash.test.ts` to cover objects containing `undefined` properties.
