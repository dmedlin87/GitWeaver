# Prompt Context Integrity Report - 2026-02-26

## Checks Performed
*   **ContextPack Determinism**: Verified that `buildContextPack` produces identical `contextPackHash` and file order regardless of input file list order.
*   **Plan Freeze Determinism**: Verified that `freezePlan` produces identical `dagHash` regardless of `nodes` and `edges` array order in `DagSpec`.
*   **Prompt Drift Assertion**: Verified that `assertPromptDrift` correctly detects changes in immutable sections and ignores changes in mutable sections.

## Determinism Failures Found
1.  **ContextPack Non-Determinism**: `buildContextPack` was sorting files only by tier (`must`, `should`, `optional`), but not by path within the same tier. This caused the output order (and thus hash) to depend on the input order of files in `TaskContract.writeScope.allow` or file system enumeration order.
2.  **Plan Freeze Non-Determinism**: `freezePlan` was hashing `dag.nodes` and `dag.edges` in their original order. If the planner produced nodes in a different order for the same logical DAG, the `dagHash` would differ.

## Fixes Applied
1.  **ContextPack Fix**: Updated `src/planning/context-pack.ts` to sort candidates by `tier` (primary) and `path` (secondary). This ensures a deterministic, canonical order for the context pack.
2.  **Plan Freeze Fix**: Updated `src/planning/plan-freeze.ts` to sort `nodes` by `taskId` and `edges` by `from`-`to` before hashing and freezing. This ensures that logically equivalent DAGs produce the same hash.
3.  **New Tests**: Added `tests/unit/prompt-integrity.test.ts` to enforce these constraints and prevent regression.
