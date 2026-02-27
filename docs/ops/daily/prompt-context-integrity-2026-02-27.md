# Daily Prompt Drift and Context Integrity Audit - 2026-02-27

## Checks performed
- **Task Contract Normalization:** Verified that set-like arrays in `TaskContract` (`dependencies`, `writeScope`, `commandPolicy`, `artifactIO`) are sorted before hashing.
- **Context Pack Determinism:** Confirmed that `buildContextPack` produces identical hashes regardless of file discovery order.
- **Prompt Envelope Stability:** Validated that `assertPromptDrift` correctly identifies immutable section changes while allowing mutable updates.

## Determinism failures found
- **Task Hashing Instability:** Initial tests revealed that `freezeTask` (and by extension `freezePlan`) produced different `contractHash` values for tasks with identical but reordered arrays (e.g., `dependencies: ['a', 'b']` vs `dependencies: ['b', 'a']`). This would cause false positive drift detections if the planner output order varied.

## Fixes applied
- **Implemented `sortTaskArrays`:** Added a normalization step in `src/planning/plan-freeze.ts` to deep-sort all relevant arrays in the `TaskContract`.
- **Updated `freezeTask`:** Modified `freezeTask` to apply `sortTaskArrays` before hashing and to return the normalized task structure.
- **Added Regression Tests:** Created `tests/unit/determinism.test.ts` to enforce strict determinism for task hashing.
