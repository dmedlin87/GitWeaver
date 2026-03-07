# Daily Architecture Drift Report - 2026-03-07

## Invariants Checked
1. **Clean working tree at run start:** Enforced in `checkBaseline` via `isRepoClean`.
2. **Integration is commit-based only:** Enforced in `integrateCommit` using `git cherry-pick`.
3. **Scope checks are canonical-path fail-closed:** Enforced in `evaluateScope` via `canonicalize` logic.
4. **Exit code is never sufficient for success:** Enforced by parsing completion markers, verifying generated commits, testing output, and requiring a mandatory `runGate` execution.
5. **Post-merge gate is mandatory after every integration:** Enforced in `executeTask` where `runGate` is executed inside the merge queue logic.
6. **Repair attempts are bounded and scope-narrowed:** Enforced via `RepairBudget` limits and error extracting restricted to valid paths.
7. **Git history + event log are the system of record; SQLite is derived state:** Enforced via `reconcileResume`.
8. **Any lock lease timeout requires fencing-token revalidation before merge:** Enforced in `orchestrator.ts` and `merge-queue.ts` via synchronous `validateFencing` checking.

## Gaps Found
- The codebase enforces the architectural invariants as outlined in the PRD correctly.
- Discovered some test suites (`tests/integration/watchdog-hang-recovery.test.ts` and `tests/unit/orchestrator-policy.test.ts`) were failing due to missing `mutableSections` object in mocked `buildPromptEnvelope` function responses.
- The v2 PRD states: "When mocking `buildPromptEnvelope` (e.g., via `vi.mock` in Vitest), the mocked return object must explicitly include the `mutableSections` property (even if empty) to accurately simulate the runtime structure and prevent subsequent TypeError's when downstream code accesses fields like `failureEvidence`."

## Fixes Applied
1. Updated mocked `buildPromptEnvelope` in `tests/integration/watchdog-hang-recovery.test.ts` and `tests/unit/orchestrator-policy.test.ts` to include `mutableSections: {}`.

## Remaining Risks
- Relying on exit code alone or completion markers from agents is not 100% foolproof against hallucinated success markers, although `runGate` limits the blast radius.
- The `node-pty` environment can drop output under heavy load. The `watchdog` fallback needs reliable process tree kills to be robust across OS bounds.
