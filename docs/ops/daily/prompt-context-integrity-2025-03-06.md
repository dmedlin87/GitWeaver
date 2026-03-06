## 2025-03-06 Prompt Drift and Context Integrity Audit

**Checks Performed:**
1. Verified immutable sections remain hash-stable across retries (tests in `tests/unit/prompt-integrity.test.ts` pass, logic in `assertPromptDrift` and `buildPromptEnvelope` reviewed).
2. Verified only mutable retry fields (`failureEvidence` and `boundedHints`) can change. Fixed mock in test files to include `mutableSections`.
3. Verified ContextPack selection is deterministic (ordering, byte budget, hash repeatability). `buildContextPack` overrides `contextPackHash` to undefined before hashing to avoid circular dependencies.

**Determinism Failures Found:**
1. Tests that use `vi.mock` for `buildPromptEnvelope` (like in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts`) failed with `TypeError: Cannot read properties of undefined (reading 'failureEvidence')` because `mutableSections` was missing in the mocked returned object.

**Fixes Applied:**
1. Modified mocked `buildPromptEnvelope` function in `tests/unit/orchestrator-policy.test.ts` to include `mutableSections`.
2. Modified mocked `buildPromptEnvelope` function in `tests/integration/watchdog-hang-recovery.test.ts` to include `mutableSections`.

All tests pass and the builds succeed without altering the core hashing constraints.
