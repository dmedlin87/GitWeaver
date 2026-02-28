# Daily Prompt Drift and Context Integrity Audit - 2026-02-28

## Checks Performed
- Verified immutable sections in `PromptEnvelope` remain hash-stable across retries using `stableStringify` for consistent object key ordering.
- Verified only mutable retry fields (`failureEvidence`, `boundedHints`) can change without altering the core `immutableSectionsHash`.
- Verified `ContextPack` selection is deterministic: ordered by tier ("must" > "should" > "optional") and then by path (`localeCompare`) for tie-breaking. Byte budget enforcement occurs after deterministic ordering.
- Verified Plan Freeze deterministically calculates `dagHash` and `taskContractHashes` by sorting nodes by `taskId` and edges deterministically. Set-like arrays (like `writeScope.allow`, `dependencies`) are explicitly sorted before computing the `contractHash`.
- Added new explicit tests in `tests/unit/prompt-integrity.test.ts` to assert that differently ordered keys produce identical `immutableSectionsHash` and modifying mutable fields does not alter the immutable integrity hashes.

## Determinism Failures Found
- No determinism failures found. The implemented functions accurately leverage `stableStringify` for deep ordering and robust array sorting strategies where applicable.

## Fixes Applied
- Added new unit test assertions in `tests/unit/prompt-integrity.test.ts` to validate hash generation determinism and ensure immutable fields remain strictly separate from mutable sections. Tests were verified to pass via `pnpm test`.
