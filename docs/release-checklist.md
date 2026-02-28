# Release Checklist

1. Confirm `pnpm typecheck`, `pnpm build`, and `pnpm test` are green.
2. Ensure `CHANGELOG.md` has release notes for the new version.
3. Confirm roadmap and docs deltas are updated.
4. Tag release (`vX.Y.Z`) from `master`.
5. Verify CI, CodeQL, and required checks pass on the tag.
6. Publish GitHub release notes.
7. Announce any breaking changes and migration steps.
