# Claude Code CLI Reference

This document provides a comprehensive reference for the Claude Code CLI, including its plugin system, event hooks, and operational technicalities.

## Core CLI Commands

Claude Code provides non-interactive commands for plugin lifecycle management and debugging.

| Command | Description |
| :--- | :--- |
| `claude plugin install <plugin>` | Install a plugin from the marketplace. Use `--scope` for user, project, or local. |
| `claude plugin uninstall <plugin>` | Remove an installed plugin (`remove`, `rm`). |
| `claude plugin enable <plugin>` | Enable a previously disabled plugin. |
| `claude plugin disable <plugin>` | Disable a plugin without uninstalling it. |
| `claude plugin update <plugin>` | Update a plugin to its latest version. |
| `claude --debug` | Show plugin loading details, manifest errors, and registration status. |
| `claude --plugin-dir <path>` | Load a local plugin directory for the current session only. |

---

## Plugin System

A plugin in Claude Code is a structured directory containing components that extend the agent's capabilities.

### Plugin Structure
*   **`skills/`**: Directories with `SKILL.md` files (accessible via `/` commands).
*   **`agents/`**: Markdown files defining specialized subagents.
*   **`hooks/`**: Event handlers configured via `hooks.json`.
*   **`.mcp.json`**: Model Context Protocol (MCP) server definitions.
*   **`.lsp.json`**: Language Server Protocol (LSP) configurations for code intelligence.
*   **`.claude-plugin/plugin.json`**: Optional manifest for metadata and custom paths.

### Installation Scopes
*   **User (`~/.claude/settings.json`)**: Available across all projects for the current user.
*   **Project (`.claude/settings.json`)**: Shared with a team via version control.
*   **Local (`.claude/settings.local.json`)**: Project-specific and ignored by Git.

---

## Event Hooks

Hooks allow plugins to automatically respond to specific orchestration events.

### Available Events
*   `PreToolUse` / `PostToolUse` / `PostToolUseFailure`
*   `SessionStart` / `SessionEnd`
*   `UserPromptSubmit` / `PermissionRequest`
*   `TaskCompleted` / `PreCompact`
*   `SubagentStart` / `SubagentStop`

### Hook Types
*   **`command`**: Executes a shell script or system command.
*   **`prompt`**: Evaluates an LLM prompt using `$ARGUMENTS` for context.
*   **`agent`**: Invokes an agentic verifier for complex, multi-step validations.

---

## Technical Reference

### Environment Variables
*   `${CLAUDE_PLUGIN_ROOT}`: Provides the absolute path to the plugin directory. Use this in all configurations to ensure portability.

### LSP Integration
Claude Code supports real-time diagnostics and navigation via LSP. The language server binaries (e.g., `pyright`, `gopls`) must be installed and available in the system `$PATH`.

### Pathing Rules
All custom paths defined in `plugin.json` must be relative to the plugin root and prefixed with `./`.

### Plugin Caching
Marketplace plugins are cached in `~/.claude/plugins/cache`. Developers can use symbolic links to include external dependencies within this cache during development.

### Versioning
Plugins follow Semantic Versioning (`MAJOR.MINOR.PATCH`), which Claude Code uses to manage updates and compatibility.
