# Daily Architecture Drift Report
**Date:** 2026-03-05

## Invariants checked
1. "Integration is commit-based only" - Code path verifies commits.
2. "Exit code is never sufficient for success" - Output markers are required.
3. "Post-merge gate is mandatory after every integration" - Code path exists for running verification gates.
4. "No task may enter MERGE_QUEUED without a valid active lease token" - Tested and enforced.
5. Prompt drift detection prevents silent scope creep in mutable/immutable sections.

## Gaps found
No major gaps were found; however, during testing, there was a test failure related to missing `mutableSections` when mocking the prompt envelope builder in test code.

## Fixes applied
- Fixed the mocked `buildPromptEnvelope` function in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts` to include an explicitly defined `mutableSections: {}` property. This complies with prompt envelope runtime drift structures without erroring when downstream code attempts to read properties from it (like `failureEvidence`).

## Remaining risks
- None currently observed.
