# Provider CLI Comparison

Use this page as the fast path for provider-specific behavior that affects orchestration prompts, command wiring, and output parsing.

For full command catalogs, see:
- [Codex CLI Reference](./Codex-CLI-Reference.md)
- [Claude Code CLI Reference](./Claude-Code-CLI-Reference.md)
- [Gemini CLI Reference](./Gemini-CLI-Reference.md)

## GitWeaver Integration Contract (Source of Truth)

These details are derived from the current implementation:
- `src/providers/adapters/codex.ts`
- `src/providers/adapters/claude.ts`
- `src/providers/adapters/gemini.ts`
- `src/providers/registry.ts`
- `src/providers/preflight.ts`

If this page and code diverge, treat code as canonical.

## Execution Differences

| Area | Codex | Claude | Gemini |
|---|---|---|---|
| Binary | `codex` | `claude` | `gemini` |
| Primary execute shape | `codex exec --json --cd <cwd> "<prompt>"` | `claude --print --output-format json "<prompt>"` | `gemini --prompt orchestrator_input --output-format json --approval-mode auto_edit` |
| Prompt transport | CLI positional argument | CLI positional argument | `stdin` (prompt text piped by orchestrator) |
| Structured output expectation | JSON (`--json`) | JSON (`--output-format json`) | JSON (`--output-format json`) |
| Host execution path | PTY (`PtyManager`) | PTY (`PtyManager`) | Direct process (`runCommand`) |
| Container execution path | `runInContainer` | `runInContainer` | `runInContainer` |

## Preflight / Auth Differences

| Area | Codex | Claude | Gemini |
|---|---|---|---|
| Version check | `codex --version` | `claude --version` | `gemini --version` |
| Auth check | `codex login status` | `claude auth status` | `gemini --prompt "Reply with OK." --output-format json --approval-mode default` |
| Auth fix command | `codex login` | `claude auth login` | `gemini` (interactive login flow) |
| npm package | `@openai/codex` | `@anthropic-ai/claude-code` | `@google/gemini-cli` |

## Prompting Guidance for Cross-Provider Reliability

- Keep task objectives provider-agnostic and explicit (scope, acceptance criteria, and verification command set).
- Avoid assuming shared slash-command semantics between providers; orchestration calls non-interactive CLI forms.
- Require structured output-compatible instructions (clear deliverables, deterministic verification steps).
- When behavior seems provider-specific, check this page first, then the provider-specific reference doc.
