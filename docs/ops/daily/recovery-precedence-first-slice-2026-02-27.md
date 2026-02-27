**[Slice Name]:** Resume Precedence Core
**[Rationale]:** Resume correctness is the highest-priority gap and this deterministic precedence resolver is the dependency-free core needed before adding crash/matrix coverage.
**[Execution Plan]:**
- Implement `resolveResumeEvidence(...)` in `src/persistence/resume-reconcile.ts` to apply `git -> event log -> sqlite` ordering with explicit winner/reason metadata.
- Add focused unit tests in `tests/persistence/resume-reconcile.spec.ts` covering precedence conflicts and deterministic ambiguity handling.
- Run `npm test -- tests/persistence/resume-reconcile.spec.ts` and record green evidence in this PR.
