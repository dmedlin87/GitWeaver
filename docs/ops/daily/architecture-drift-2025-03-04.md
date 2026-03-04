# Architecture Drift Report (2025-03-04)

## Invariants Checked
1. **Clean working tree at run start:** Verified in `Orchestrator.checkBaseline`, tested in `tests/unit/orchestrator-provenance.test.ts` and `tests/e2e/cli-extended.e2e.test.ts`.
2. **Integration is commit-based only:** Verified in `Orchestrator.integrateCommit`, cherry-picking correctly.
3. **Scope checks are canonical-path fail-closed:** Verified in `src/verification/scope-policy.ts`.
4. **Exit code is never sufficient for success:** Verified in `Orchestrator.executeTask` by requiring `NO_COMMIT_PRODUCED` fail if no commit output is produced.
5. **Post-merge gate is mandatory after every integration:** Verified in `Orchestrator.executeTask`.
6. **Repair attempts are bounded and scope-narrowed:** Verified in `RepairBudget` and `buildRepairTask`.
7. **Git history + event log are the system of record; SQLite is derived state:** Verified in `reconcileResume`.
8. **Any lock lease timeout requires fencing-token revalidation before merge:** Verified in `Orchestrator.executeTask` checking `lockManager.validateFencing` right before integration and queuing.
9. **MergeQueue validation is synchronous:** Validation failures before queueing must be evaluated and thrown synchronously to prevent promise chain race conditions.

## Gaps Found
- **MergeQueue async rejection masking synchronous issues:** The `MergeQueue.enqueue` method was using `return Promise.reject(...)` for synchronous validation failures before queuing. As noted in the memory rules, returning `Promise.reject` inside an async chain allows a microtask tick to occur, failing to protect against race conditions synchronously.
- **vi.mock missing properties:** Test mock implementations for `buildPromptEnvelope` did not match the latest object structure, missing `mutableSections`, leading to unhandled property reads (`undefined` exceptions).

## Fixes Applied
- **Fixed `MergeQueue.enqueue` validation behavior:** Updated to use `throw new Error(...)` instead of returning `Promise.reject(...)` for synchronous validation failures before queuing. This ensures that the caller catches validation errors before a promise chain is even established.
- **Updated test `vi.mock`s:** Added the missing `mutableSections` property to the `vi.mock` configuration for `buildPromptEnvelope` in `tests/unit/lock-manager.test.ts`, `tests/unit/orchestrator-policy.test.ts`, and `tests/integration/watchdog-hang-recovery.test.ts`.

## Remaining Risks
- The `MergeQueue` implementation now correctly validates synchronously before queuing, but there may be other areas where `async` boundaries inadvertently introduce microtask delays around safety checks.
- Code changes in other parts of the system could still cause test drift if `vi.mock` objects aren't continually updated to reflect exact contract structures.
