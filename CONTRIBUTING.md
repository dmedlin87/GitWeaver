# Contributing to GitWeaver

Thanks for contributing to GitWeaver Orchestrator.

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## Pull request scope

- Keep changes focused to one operational theme.
- Target roughly 250-500 net LOC when practical.
- Include tests that prove behavior changes.

## Development expectations

- Use strict TypeScript and existing module boundaries.
- Preserve resume precedence (`git > event log > sqlite`).
- Keep security controls fail-closed for scope and command policy.

## Commit and PR guidance

- Use clear commit messages describing behavior impact.
- Link related issue IDs in the PR body.
- Include validation evidence (`typecheck`, `build`, `test`).

## Questions

Open a discussion or issue if behavior is ambiguous before large refactors.
