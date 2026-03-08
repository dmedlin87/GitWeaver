# Architecture Drift Report

## Invariants checked
1. Clean working tree at run start.
2. Integration is commit-based only (`cherry-pick`/merge queue), never raw patch apply.
3. Scope checks are canonical-path fail-closed.
4. Exit code is never sufficient for success.
5. Post-merge gate is mandatory after every integration.
6. Repair attempts are bounded and scope-narrowed.
7. Git history + event log are the system of record; SQLite is derived state.
8. Any lock lease timeout requires fencing-token revalidation before merge.

## Gaps found
- None found so far. The tests currently fail due to missing `mutableSections` property on prompt envelopes when using mocked implementations, but that is a test mock issue rather than an architectural drift.

## Fixes applied
- Fixed the mocked `buildPromptEnvelope` function in tests to return `mutableSections` to avoid `TypeError: Cannot read properties of undefined (reading 'failureEvidence')` when simulating the prompt drift check logic.

## Remaining risks
- None.
