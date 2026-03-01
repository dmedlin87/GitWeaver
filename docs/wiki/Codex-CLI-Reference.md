# Codex CLI Reference

This document provides a comprehensive reference for the Codex CLI, documenting its core features, slash commands, and operational workflows.

## Core Features

*   **Interactive Sessions:** A terminal-based composer for real-time interaction with Codex models.
*   **Plan Mode:** An environment for architecting solutions and proposing execution plans before code modification.
*   **Context Management:** Tools like `/compact` to summarize conversations and optimize token usage within the context window.
*   **Git Native Integration:** Built-in commands for diffing (`/diff`) and automated working tree reviews (`/review`).
*   **Multi-Agent Support:** Capability to spawn and manage multiple sub-agent threads for parallel tasks.
*   **Sandbox Controls:** Configurable directory access and execution permissions for secure operations.
*   **Model Context Protocol (MCP):** Support for external tools and servers to extend agent capabilities.
*   **Persistent Instructions (`AGENTS.md`):** A repository-level configuration file for storing long-term project rules and personas.

---

## Slash Commands

Slash commands are used within the interactive composer to manage the session and control agent behavior.

| Command | Description |
| :--- | :--- |
| `/model` | Switch active model (e.g., `gpt-4.1-mini`) or adjust reasoning effort. |
| `/plan` | Toggle Plan Mode or initiate a specific planning task. |
| `/permissions` | Set tool approval policies (e.g., `Auto`, `Read Only`). |
| `/status` | View active model, approval policy, writable roots, and token usage. |
| `/diff` | Display the current Git diff (staged, unstaged, and untracked). |
| `/review` | Request a review of the working tree for logic changes or missing tests. |
| `/mention` | Add a specific file or directory to the conversation context. |
| `/compact` | Summarize history to free up tokens in the context window. |
| `/personality` | Change communication style (`friendly`, `pragmatic`, `none`). |
| `/new` | Reset chat context and start a fresh conversation. |
| `/fork` | Clone the current thread to explore alternative implementation paths. |
| `/resume` | Open a picker to continue a previous conversation. |
| `/agent` | Switch between active sub-agent threads. |
| `/mcp` | List available Model Context Protocol tools and servers. |
| `/init` | Generate an `AGENTS.md` scaffold for project-level instructions. |
| `/ps` | View background terminals and their recent output. |
| `/statusline` | Interactively configure and reorder items in the TUI footer. |
| `/experimental` | Toggle experimental features (e.g., Multi-agents). |
| `/debug-config` | Print diagnostic info about configuration layers and policies. |
| `/feedback` | Send logs and diagnostics to the maintainers. |
| `/logout` | Sign out and clear local credentials. |
| `/quit` / `/exit` | Exit the CLI session. |

---

## Operational Workflows

### Plan Mode Workflow
Use `/plan` to enter a read-only environment where Codex analyzes requirements and proposes a step-by-step strategy. Once the plan is approved, the agent transitions to implementation.

### Context Optimization
When a conversation becomes long, use `/compact` to have the model summarize key decisions and state, allowing you to continue working without hitting token limits.

### Repository Instructions (`AGENTS.md`)
Run `/init` in your project root to create `AGENTS.md`. This file is automatically read by Codex and should contain:
*   Coding standards (e.g., "Always use functional components").
*   Project architecture details.
*   Specific library preferences or constraints.

### TUI Customization
Use `/statusline` to customize the information displayed at the bottom of your terminal. You can toggle and reorder items such as:
*   Current Model & Reasoning level.
*   Token usage and rate limits.
*   Git branch.
*   Session ID and Project Root.
