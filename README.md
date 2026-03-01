<!-- markdownlint-disable MD033 MD041 -->
<div align="center">
  <img src="assets/gitweaver-mascot-final.png" alt="GitWeaver Mascot" width="300" />
  
  <h1>🧙‍♂️ GitWeaver Orchestrator</h1>

  <p>
    <a href="https://github.com/dmedlin87/GitWeaver/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dmedlin87/GitWeaver/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="https://github.com/dmedlin87/GitWeaver/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://github.com/dmedlin87/GitWeaver/actions/workflows/codeql.yml/badge.svg" /></a>
  </p>
  
  <p><b><i>"Weaving code, logic, and LLMs into a seamless thread."</i></b></p>
  
  <p>
    <code>orchestrator</code> is a local Node.js + TypeScript CLI-of-CLIs runtime powering workflows for <b>Codex</b>, <b>Claude</b>, and <b>Gemini</b>.
  </p>
  
  <p>
    <a href="#-features"><b>Features</b></a> •
    <a href="#-setup--installation"><b>Setup</b></a> •
    <a href="#-commands"><b>Commands</b></a> •
    <a href="#-validation"><b>Validation</b></a>
  </p>
</div>

---

## 📖 The Lore (What is this?)

> *Every grand spell begins with a single incantation...*

**GitWeaver Orchestrator** is an AI-powered agentic framework designed to bring true autonomy and strict validation to your local development workflows. Unlike standard coding assistants that only generate snippets, GitWeaver **acts as a multi-model maestro**. It reads your repository, plans architectural changes, executes code modifications across files using specialized AI agents, and validates every weave against your existing test suites.

If it breaks the build, it repairs the baseline. The tapestry only moves forward when the spell is perfected.

---

## ✨ Features

> *A true weaver needs the right spells...*

- **Multi-Provider Mastery**: Seamlessly cast workflows using Codex, Claude, and Gemini in a single CLI space. Mix and match the best models for the job.
- **Git Native Magic**: Runs naturally require a pristine git repository baseline. Merge integrations are commit-based and guarded by semantic scope and strict verification gates.
- **Enchanted Logging**: Every event is tracked and safely preserved locally in `.orchestrator/runs/<run-id>/events.ndjson`, granting you perfect vision into the agent's mind.
- **Absolute Drift Control**: Embedded baseline repair and strict drift-acceptance workflows ensure your digital tapestry remains untangled.

---

## 📜 Setup & Installation

> *Summon your local environment in seconds.*

```bash
# Clone the grimoire
git clone https://github.com/dmedlin87/GitWeaver.git
cd GitWeaver

# Install dependencies and build the core
pnpm install
pnpm build
```

### Support Matrix

| Component | Supported |
| :--- | :--- |
| Node.js | `>= 24.0.0` |
| pnpm | `10.x` |
| OS | Windows, macOS, Linux |

**Cast an objective in dev mode:**

```bash
pnpm dev run "Implement a new authentication middleware for the API"
```

---

## ⚔️ Commands

> *Weave your magic with these primary CLI invocations:*

| Command | Description |
| :--- | :--- |
| `orchestrator run "<prompt>"` | Start a new workflow. Custom flags: `--concurrency N`, `--dry-run`, `--dry-run-report basic\|detailed`, `--execution-mode host\|container`, `--container-runtime docker\|podman`, `--container-image <image>`, `--config path`, `--repo path`, `--allow-baseline-repair`, `--accept-drift` |
| `orchestrator resume <run-id>` | Resume an existing run. Flag: `--accept-drift` |
| `orchestrator status <run-id>` | Check run status (`--json` supported) |
| `orchestrator inspect <run-id>` | Inspect run details (`--task <id>`, `--json`) |
| `orchestrator locks <run-id>` | Check current locks (`--json`) |
| `orchestrator providers check` | Check provider configurations (`--json`) |
| `orchestrator providers install` | Install providers e.g. `--providers codex,claude,gemini` (`--yes`, `--json`) |
| `orchestrator providers auth` | Authenticate via `--provider codex\|claude\|gemini` (`--fix`, `--json`) |

---

## 🪄 Provider Install Defaults

> *GitWeaver automatically conjures provider dependencies using standard NPM packages:*

- 🧙‍♂️ **Codex**: `npm install -g @openai/codex@latest`
- 🤖 **Claude**: `npm install -g @anthropic-ai/claude-code@latest`
- 🌌 **Gemini**: `npm install -g @google/gemini-cli@latest`

---

## 🛠️ Typical Use Cases

> *How other Archmages are using GitWeaver:*

1. **Massive Refactors**: "Convert all CommonJS imports in the `/legacy` folder to ES Modules and fix the resulting type errors."
2. **Feature Generation**: "Read `docs/new-api-spec.md` and implement the endpoints in `src/routes`, including Zod validation and Jest tests."
3. **Automated Documentation**: "Analyze the `src/core` directory and generate a comprehensive `ARCHITECTURE.md` file explaining the data flow."
4. **Test Driven Weaving**: "Write comprehensive unit tests for `payment-processor.ts` covering all edge cases."

---

## 🧪 Validation

> *Ensure your weaving is flawless before merging it into the grand tapestry.*

```bash
pnpm typecheck
pnpm build
pnpm test
```

<details>
<summary><b>🛡️ Continuous Integration</b></summary>
<br/>
CI runs the exact same validation pipeline via <code>.github/workflows/ci.yml</code> to ensure that no corrupted spells enter the main branch.
</details>

---

## 📚 Project Policies

- [Contributing](/CONTRIBUTING.md)
- [Code of Conduct](/CODE_OF_CONDUCT.md)
- [Security Policy](/SECURITY.md)
- [License](/LICENSE)
- [Release Checklist](/docs/release-checklist.md)
- [Changelog](/CHANGELOG.md)

## 🧭 Project Navigation

- [Roadmap](./ROADMAP.md)
- [Agent Guidance](./AGENTS.md)
- [Claude Handoff](./CLAUDE.md)
- [Provider CLI Comparison](./docs/wiki/Provider-CLI-Comparison.md)
- [Codex CLI Reference](./docs/wiki/Codex-CLI-Reference.md)
- [Claude Code CLI Reference](./docs/wiki/Claude-Code-CLI-Reference.md)
- [Gemini CLI Reference](./docs/wiki/Gemini-CLI-Reference.md)

---

<div align="center">
  <br/>
  <i>Built with magic and code.</i> 🌟
</div>
