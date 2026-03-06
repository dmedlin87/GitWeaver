# Daily Architecture Drift Guardian Report - 2026-03-06

## Invariants Checked
* **Lock Lease Fencing before `MERGE_QUEUED`**: Ensured tasks hold a valid, active fencing token exactly when they attempt to queue for integration. This is done via synchronous checks directly at `enqueue` within `MergeQueue.enqueue`.
* **Fail-Closed Canonical Scope Enforcement**: Scope checks correctly reject paths that navigate outside the allowed patterns, throwing a determinisitc failure code `SCOPE_DENY` instead of ignoring it.
* **Pre-merge Staleness Detection**: The codebase accurately triggers dependency verification prior to integration and flags base branch drift as an immediate error.
* **Prompt Drift Policy**: The system detects mismatches in `immutableSectionsHash` to prevent retry drift accurately.
* **State Machine Validity**: Confirmed that state transitions to `MERGE_QUEUED` and subsequent integration are properly vetted by the `assertTaskTransition` definitions.

## Gaps Found
* The unit test mocks for `buildPromptEnvelope` (in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts`) were not returning the required `mutableSections` property as defined in the v2 `PromptEnvelope` structure. This allowed tests to fail with a `TypeError` downstream instead of testing the intended orchestrator functionality, thus obscuring potential architecture violations in how retries are handled.

## Fixes Applied
* Added `mutableSections: {}` to the `buildPromptEnvelope` mock return object in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts` to reflect the accurate runtime v2 `PromptEnvelope` structure and to resolve `TypeError`s during testing.

## Remaining Risks
* **Network Policy Isolation**: Currently, network policy (`taskAllowsNetwork`) relies on the "best effort" enforcement through environment variables on host execution rather than true container-based OS isolation. We rely on advisory blocking (`DENYLIST` variables and setting policy flags for the process) which cannot guarantee full security on host execution modes without container isolation.