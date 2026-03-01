# Gemini CLI Reference

This document provides a comprehensive reference for the Gemini CLI (`@google/gemini-cli`), documenting its commands, options, and management subcommands.

## Core CLI Commands

| Command | Description | Example |
| :--- | :--- | :--- |
| `gemini` | Start interactive REPL | `gemini` |
| `gemini "query"` | Query non-interactively, then exit | `gemini "explain this project"` |
| `cat file \| gemini` | Process piped content | `cat logs.txt \| gemini` |
| `gemini -i "query"` | Execute and continue interactively | `gemini -i "What is the purpose...?"` |
| `gemini -r "latest"` | Continue most recent session | `gemini -r "latest"` |
| `gemini -r "id" "query"` | Resume specific session with a new prompt | `gemini -r "abc123" "Finish this PR"` |
| `gemini update` | Update CLI to the latest version | `gemini update` |

---

## CLI Options (Flags)

| Option | Alias | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--model` | `-m` | string | `auto` | Model to use (e.g., `pro`, `flash`, `flash-lite`) |
| `--prompt-interactive`| `-i` | string | - | Execute prompt and stay in interactive mode |
| `--resume` | `-r` | string | - | Resume session by ID or "latest" |
| `--sandbox` | `-s` | boolean| `false` | Run in a sandboxed environment |
| `--approval-mode` | - | string | `default` | Tool execution mode: `default`, `auto_edit`, `yolo` |
| `--output-format` | `-o` | string | `text` | Output format: `text`, `json`, `stream-json` |
| `--include-directories`| - | array | - | Additional directories to include in workspace |
| `--list-sessions` | - | boolean| - | List available sessions for the project |
| `--delete-session` | - | string | - | Delete a session by index number |
| `--debug` | `-d` | boolean| `false` | Enable verbose logging |
| `--version` | `-v` | - | - | Show CLI version |
| `--help` | `-h` | - | - | Show help information |

---

## Model Aliases

*   **`auto`**: Default. Resolves to the best available model (Pro or Preview).
*   **`pro`**: For complex reasoning and heavy tasks.
*   **`flash`**: Fast, balanced model for most tasks.
*   **`flash-lite`**: Fastest model for simple tasks.

---

## Subcommand Management

### Extensions (`gemini extensions ...`)

*   **`install <source>`**: Install from Git URL or local path.
*   **`uninstall <name>`**: Remove an extension.
*   **`list`**: Show all installed extensions.
*   **`update --all`**: Update all extensions.
*   **`enable/disable <name>`**: Toggle extension status.
*   **`new <path>`**: Create a new extension from a template.

### MCP Servers (`gemini mcp ...`)

*   **`add <name> <command>`**: Add a stdio-based MCP server.
*   **`add <name> <url> --transport http`**: Add an HTTP-based MCP server.
*   **`remove <name>`**: Remove a configured server.
*   **`list`**: List all configured MCP servers.

### Agent Skills
Agent Skills are specialized expertises that Gemini CLI can activate to handle specific tasks.

#### Skill Discovery
Gemini CLI discovers skills from three tiers, with higher-precedence locations overriding others:
1.  **Workspace Skills (Highest):** `.gemini/skills/` or `.agents/skills/`.
2.  **User Skills:** `~/.gemini/skills/` or `~/.agents/skills/`.
3.  **Extension Skills (Lowest):** Bundled with installed extensions.

*Note: Within a tier, `.agents/skills/` takes precedence over `.gemini/skills/`.*

#### Skill Activation
Activation occurs autonomously when the AI identifies a task matching a skill's description:
1.  **Identification:** Gemini calls the `activate_skill` tool.
2.  **Consent:** You are prompted to approve the skill's activation.
3.  **Injection:** The skill's instructions (`SKILL.md`) are added to the conversation.
4.  **Persistence:** The skill remains active and its guidance is prioritized for the rest of the session.

#### Progressive Disclosure
To save context tokens, Gemini CLI only loads skill metadata (name and description) initially. Full instructions and resources are disclosed only when the skill is explicitly activated.

#### Managing Skills
**Interactive Commands:**
*   `/skills list`: View discovered skills and status.
*   `/skills link <path>`: Symlink skills from a local directory.
*   `/skills enable/disable <name>`: Toggle skill availability (use `--scope workspace` for project-specific).
*   `/skills reload`: Refresh the skill list.

**Terminal Commands:**
*   `gemini skills list`
*   `gemini skills install <source>` (Git URL, path, or `.skill` file).
*   `gemini skills link /path/to/skills`
*   `gemini skills uninstall <name>`
*   `gemini skills enable/disable <name>`

---

## Configuration & Project Context

### Project Context (`GEMINI.md`)
Use a `GEMINI.md` file in your project root to provide persistent, project-specific instructions to the Gemini CLI. Instructions in this file take precedence over general system prompts.

### Ignore Files (`.geminiignore`)
Define exclusion patterns in a `.geminiignore` file to protect sensitive data or ignore irrelevant files during workspace analysis.

### Trusted Folders
For security, Gemini CLI uses "Trusted Folders" to manage tool execution permissions. You may be prompted to trust a folder before certain tools can be used.

---

## Core Workflows

### File Management
Gemini CLI can read, write, and search files within your workspace using tools like `read_file`, `write_file`, and `grep_search`.

### Execute Shell Commands
Gemini CLI can execute system commands via `run_shell_command`. It follows safety protocols and may require user confirmation for commands that modify the system state.

### Web Search and Fetch
Use `google_web_search` and `web_fetch` to interact with external web content for research and documentation analysis.

---

## Advanced Features

### Plan Mode
Plan Mode is an experimental, read-only environment designed for architecting solutions before any code is modified. It focuses on research, design, and strategic alignment.

#### Enabling and Entering Plan Mode
*   **Enable:** Set `"experimental": { "plan": true }` in your `settings.json`.
*   **Enter:**
    *   Type `/plan` in the CLI.
    *   Ask Gemini to "start a plan for [task]".
    *   Use `Shift+Tab` to cycle approval modes to "Plan".
    *   Launch with `gemini --approval-mode=plan`.

#### What Plan Mode Does
*   **Read-Only Safety:** Restricts tools to read-only operations (e.g., `read_file`, `grep_search`). Writing is limited to Markdown (`.md`) files in a `plans` directory.
*   **Adaptive Workflow:**
    1.  **Explore:** Maps modules and dependencies.
    2.  **Consult:** Presents trade-offs for complex tasks using `ask_user`.
    3.  **Draft:** Generates a structured plan (Objective, Steps, Verification).
*   **Automatic Model Routing:** Uses a high-reasoning **Pro model** for planning and switches to a high-speed **Flash model** for implementation.
*   **Custom Policies:** Tool restrictions can be customized via `.toml` policy files.

#### Review and Approval
When a plan is ready, Gemini calls `exit_plan_mode`. You can then:
*   **Approve:** Exit Plan Mode and start implementation.
*   **Iterate:** Provide feedback to refine the plan.
*   **Manual Refinement:** Press `Ctrl+X` to edit the plan in an external editor.

### Subagents
Gemini CLI can delegate specialized tasks to subagents like `codebase_investigator` for deep repository analysis or `cli_help` for CLI-specific questions.

### MCP Servers
Connect to Model Context Protocol (MCP) servers to extend the CLI's capabilities with external data sources and tools.

### Checkpointing & Rewind
Manage session snapshots and replay states to recover from errors or explore different implementation paths.

### Headless Mode
Headless mode is a programmatic interface for interacting with Gemini CLI without the interactive terminal UI. It is designed for automation, scripts, and CI/CD integrations.

#### How to Use
Headless mode is triggered automatically in non-TTY environments (scripts, pipelines) or when providing a query as a positional argument without the interactive flag.

#### Output Formats (`--output-format`)
*   **JSON (`json`):** Returns a single JSON object with `response`, `stats`, and optional `error` details.
*   **Streaming JSON (`jsonl`):** Returns newline-delimited JSON events (`init`, `message`, `tool_use`, `tool_result`, `result`). Useful for real-time tracking.

#### Exit Codes
*   **`0`**: Success.
*   **`1`**: General error or API failure.
*   **`42`**: Input error (invalid prompt/arguments).
*   **`53`**: Turn limit exceeded.

#### Common Use Cases
*   **CI/CD Pipelines:** Automate code reviews, documentation generation, or log analysis.
*   **Scripting:** Use as a backend component in Bash, Python, or Node.js.
*   **Tool Integration:** Pipe structured output into utilities like `jq`.

---

## Usage Guides & Tutorials

### Execute Shell Commands
Gemini CLI can execute system commands to automate development tasks.

#### Key Commands
*   **`!` (Direct Execution):** Prefix any command with `!` to run it directly in your system shell (e.g., `!ls -la`).
*   **Shell Mode:** Type `!` and press **Enter** to toggle a persistent shell mode. Exit with `Esc` or `exit`.
*   **`/shells`:** Dashboard to view active background processes, check logs, or kill tasks.
*   **`--sandbox`:** Start with `gemini --sandbox` to run all shell commands inside a Docker container.

#### Safety & Workflows
*   **Confirmation:** Commands require explicit approval (`Allow once`, `Allow always`, or `Deny`).
*   **Autonomous Loop:** Gemini can run a command, analyze the error, apply a fix, and re-verify the fix automatically.

---

### Memory Management
Control the persistent context and rules for your project.

#### Project-Wide Rules (`GEMINI.md`)
*   **Hierarchy:** Global (`~/.gemini/`), Project Root (`./`), and Subdirectory (`./src/`) rules are layered.
*   **Usage:** Enforce coding standards, personas, or technical constraints.
*   **Commands:** `/memory show` (view active context) and `/memory refresh` (reload files).

#### Persistent Facts (`save_memory`)
*   **Teaching:** Ask Gemini to "Remember that..." or "Save the fact that...".
*   **Retrieval:** Gemini automatically recalls these facts in future sessions.

---

### Agent Skills (Getting Started)
Skills are specialized experts defined by a directory containing a `SKILL.md` file.

#### Structure & Components
*   **Discovery Path:** `.gemini/skills/` (recommended) or `.agents/skills/`.
*   **`SKILL.md`**: Contains YAML frontmatter (`name`, `description`) and mandatory instructions.
*   **Bundled Resources:** Include scripts (JS, Python) in a `scripts/` folder for the agent to execute.

#### Creation Workflow
1.  Create folder structure in `.gemini/skills/`.
2.  Define the skill and its trigger in `SKILL.md`.
3.  Add logic/scripts to the skill directory.
4.  Verify with `/skills list`.

---

### File Management
Efficiently read, search, and modify files.

#### Context & Reading
*   **`@path/to/file`**: Force read a specific file or directory.
*   **Chaining**: Use multiple `@` references for dependencies (e.g., `@component.tsx @types.ts`).

#### Discovery & Modification
*   **Exploration:** Use natural language to find files (e.g., "Find the file that defines...").
*   **Tools:** Gemini uses `replace` for targeted edits and `write_file` for creating new files.
*   **Safety:** Review unified diffs before confirming changes with `y`.

#### Exclusion (`.geminiignore`)
Create a `.geminiignore` file to hide sensitive or large files from the AI, supplementing `.gitignore`.

---

### Automation & Headless Mode
Use Gemini CLI as a programmatic component in scripts and pipelines.

#### Core Concepts
*   **Headless Mode:** Run `gemini "prompt"` for single-turn execution with direct output to `stdout`.
*   **Piping:** Support for Unix-style pipes (e.g., `cat file | gemini "summarize"`).
*   **JSON Output:** Use `--output-format json` for integration with tools like `jq`.

#### Automation Examples
*   **Bulk Processing:** Loop through files and generate documentation summaries.
*   **Data Extraction:** Extract version and dependency info into a `.json` file.
*   **Smart Aliases:** Create a shell function to generate conventional commit messages from `git diff --staged`.

---

## Remote Subagents (Experimental)

Gemini CLI supports **Remote Subagents** using the **Agent-to-Agent (A2A)** protocol, enabling task delegation to remote services.

### Enabling Remote Subagents
To use this experimental feature, enable it in your `settings.json`:
```json
{
  "experimental": {
    "enableAgents": true
  }
}
```

### Defining Remote Subagents
Remote subagents are defined using Markdown files with YAML frontmatter, stored in:
*   **Project-level:** `.gemini/agents/*.md`
*   **User-level:** `~/.gemini/agents/*.md`

#### Configuration Example
Create a file (e.g., `.gemini/agents/my-remote-agent.md`):
```yaml
---
kind: remote
name: my-remote-agent
agent_card_url: https://example.com/agent-card
---
```

### Subagent Commands
Use these slash commands within the Gemini CLI to manage subagents:
*   `/agents list`: View all available local and remote subagents.
*   `/agents refresh`: Reload the registry after modifying definition files.
*   `/agents enable <name>`: Enable a specific subagent.
*   `/agents disable <name>`: Disable a specific subagent.
