# GitWeaver System Flowcharts

A comprehensive visual reference for the orchestrator's internal flow — provider routing, quota fallback, task execution pipeline, agent coordination, Claude sub-model selection, and reasoning level control.

---

## 1. System Architecture Overview

How all the major components relate to each other at rest.

```mermaid
graph TB
    subgraph UI["GitWeaver Chat (Browser)"]
        CHAT[Chat Thread]
        HIST[Run History]
        PSET[Provider Settings]
    end

    subgraph SERVER["Fastify Server :3847"]
        REST[REST Routes]
        WS[WebSocket Handler]
        BRIDGE[Orchestrator Bridge\nchild_process.spawn]
        HPOLL[Health Poller\nevery 5s]
    end

    subgraph ORCH["GitWeaver Orchestrator CLI"]
        PLAN[Planner\nDAG Generator]
        ROUTER[Router\nweighted priority]
        HEALTH[Health Manager\nscore + cooldown]
        SCHED[Scheduler\ntoken buckets + locks]
        EXEC[Executor\nPTY Manager]
        VERIFY[Verifier\nscope + output + gate]
        MERGE[Merge Queue\ncherry-pick]
        REPAIR[Repair Planner\nclassify + retry]
        DB[(SQLite\nstate.sqlite)]
        ELOG[(Event Log\nevents.ndjson)]
    end

    subgraph REPO["Target Git Repository"]
        MAIN[main branch]
        WT1[worktree: task-1]
        WT2[worktree: task-2]
        WTN[worktree: task-N]
    end

    subgraph PROVIDERS["Provider CLIs  —  subscription auth only"]
        CODEX["Codex CLI\nweight 1 ★★★"]
        CLAUDE["Claude Code CLI\nweight 2 ★★"]
        GEMINI["Gemini CLI\nweight 3 ★"]
    end

    CHAT -->|POST /api/runs| REST
    REST --> BRIDGE
    BRIDGE -->|spawn| ORCH
    ORCH -->|stderr progress| BRIDGE
    BRIDGE -->|WebSocket push| WS
    WS --> CHAT
    HPOLL -->|GET /api/providers/health| REST
    REST --> HPOLL
    HPOLL --> PSET

    PLAN --> ROUTER
    ROUTER --> HEALTH
    HEALTH --> SCHED
    SCHED --> EXEC
    EXEC -->|PTY| CODEX
    EXEC -->|PTY| CLAUDE
    EXEC -->|stdin| GEMINI
    EXEC --> VERIFY
    VERIFY --> MERGE
    VERIFY --> REPAIR
    REPAIR --> ROUTER
    MERGE --> MAIN
    EXEC --> WT1
    EXEC --> WT2
    EXEC --> WTN
    ORCH --> DB
    ORCH --> ELOG
```

---

## 2. Full Run Lifecycle

End-to-end flow from user prompt to completed or failed run.

```mermaid
flowchart TD
    A([User submits prompt]) --> B[Chat UI\nPOST /api/runs]
    B --> C[Bridge spawns:\norchestrator run]
    C --> D{Baseline gate\npnpm build / tsc}
    D -- FAIL + allowBaselineRepair=false --> ABORT([Run ABORTED\nBASELINE_FAILED])
    D -- PASS --> E[Planning phase\nDAG generation via Codex]
    E --> F[Plan Audit\nscope + complexity + budget]
    F --> G[Task queue populated\nN tasks, dependency edges set]

    G --> H[Scheduler loop\nmax concurrent = cap]

    H --> I{Task available\nand deps met?}
    I -- No tasks ready --> WAIT[Wait for in-flight\ntasks to complete]
    WAIT --> I
    I -- Task ready --> J[Route task\nweighted priority + health]

    J --> K[Acquire token bucket\nfor chosen provider]
    K --> L[Create git worktree\nfrom HEAD]
    L --> M[Spawn provider CLI\nvia PTY with prompt + context]

    M --> N{Provider\nreturns output}
    N -- quota / 429 hit --> QF[Quota Fallback\nreroute to next provider]
    QF --> J
    N -- timeout / hang --> WD[Watchdog kills PTY\nEXEC_FAILED]
    WD --> RP
    N -- success --> O[Scope policy check\nallowlist / blocklist paths]

    O -- scope violation --> RP
    O -- pass --> P[Output verifier\nexpected files + exports + smoke test]
    P -- fail --> RP
    P -- pass --> Q[Merge Queue\ncherry-pick to main]

    Q --> R{Post-merge gate\npnpm build + test}
    R -- fail --> REVERT[Revert commit\ngit revert]
    REVERT --> RP
    R -- pass --> S[Task MERGED\nrecord artifact signatures]

    RP[Repair Planner\nclassify failure] --> RP2{Budget\nremaining?}
    RP2 -- yes --> J
    RP2 -- no --> FAIL_T([Task FAILED\nMAX_REPAIR_EXCEEDED])

    S --> H
    FAIL_T --> H

    H -- all tasks settled --> FINAL{Any task\nFAILED?}
    FINAL -- yes --> RUNFAIL([Run FAILED])
    FINAL -- no --> COMPLETE([Run COMPLETED])
```

---

## 3. Provider Routing — Weighted Fallback System

The core routing logic. Every task goes through this on initial assignment and again if a provider degrades mid-run.

**Weight table (lower = more generous quota, prefer first):**
| Provider | Weight | Fallback order when unavailable |
|----------|--------|--------------------------------|
| Codex CLI | 1 | Claude → Gemini |
| Claude Code | 2 | Codex → Gemini |
| Gemini CLI | 3 | Codex → Claude |

> **Known gap in current code:** `FALLBACK_ORDER.gemini` is currently `["claude", "codex"]` — one character swap needed to `["codex", "claude"]` to match the weight system. All other orders are already correct.

```mermaid
flowchart TD
    START([Route task]) --> PRI[Read providerPriority config\ne.g. codex → claude → gemini]
    PRI --> CHECK1{Codex\nhealthy?}

    CHECK1 -- score ≥ 50\nNOT in cooldown --> USE_CODEX([Assign to Codex ★★★])

    CHECK1 -- score < 50\nOR in cooldown --> LOG1[Log: Codex degraded\nfallback triggered]
    LOG1 --> CHECK2{Claude\nhealthy?}

    CHECK2 -- healthy --> USE_CLAUDE([Assign to Claude ★★])

    CHECK2 -- degraded --> LOG2[Log: Claude degraded\nfallback triggered]
    LOG2 --> CHECK3{Gemini\nhealthy?}

    CHECK3 -- healthy --> USE_GEMINI([Assign to Gemini ★])

    CHECK3 -- all degraded --> FORCE[Force assign to\nhighest-score provider\nwith warning logged]
    FORCE --> USE_BEST([Assign best available])
```

---

## 4. Quota Hit Detection & Recovery Timeline

What happens the moment a provider returns a quota error, and how it recovers.

```mermaid
sequenceDiagram
    participant SCHED as Scheduler
    participant PTY as PTY Manager
    participant CLI as Provider CLI
    participant HEALTH as Health Manager
    participant ROUTER as Router

    SCHED->>PTY: spawn provider with prompt
    PTY->>CLI: execute
    CLI-->>PTY: stderr: "429 Too Many Requests"\nor "quota exceeded"
    PTY-->>SCHED: exitCode=1, output contains quota error

    SCHED->>HEALTH: onFailure("codex", "429 Too Many Requests")
    Note over HEALTH: classifyProviderError → "rate_limit"<br/>score penalty: -30<br/>backoff multiplier: 3x<br/>cooldownUntil = now + backoffSec
    HEALTH-->>SCHED: snapshot { score: 70→40, cooldownUntil: "T+15s" }

    Note over SCHED: score 40 < 50 threshold → provider unhealthy

    SCHED->>ROUTER: rerouteOnDegradation(task, healthSnapshot)
    ROUTER->>ROUTER: walk fallback order by weight\n[claude, gemini]
    ROUTER->>HEALTH: is claude healthy?
    HEALTH-->>ROUTER: score=100, no cooldown → YES
    ROUTER-->>SCHED: RoutingDecision { provider: "claude", fallbackReason: "codex degraded score=40" }

    SCHED->>PTY: re-spawn task on Claude
    PTY->>CLI: execute on claude
    CLI-->>PTY: success
    PTY-->>SCHED: exitCode=0

    SCHED->>HEALTH: onSuccess("claude")
    Note over HEALTH: claude score stays at 100

    Note over HEALTH: Meanwhile, codex cooldown expires at T+15s
    SCHED->>HEALTH: canDispatch("codex")?
    HEALTH-->>SCHED: cooldown expired → true

    Note over SCHED: Next task can use Codex again.\nScore recovers +recoverPerSuccess per success.
```

---

## 5. Claude Sub-Model Selection

Claude Code CLI supports three models. GitWeaver can select based on task complexity, conserving Opus quota for tasks that need it and using Haiku to extend overall capacity.

**Model tiers:**
| Model | Best for | Quota cost | Flag |
|-------|---------|-----------|------|
| Opus 4.6 | Complex architecture, multi-file redesign, planning | Highest | `--model claude-opus-4-6` |
| Sonnet 4.6 | Standard code, refactor, tests, bug fixes | Medium | `--model claude-sonnet-4-6` (default) |
| Haiku 4.5 | Boilerplate, fixtures, simple docs, formatting | Lowest | `--model claude-haiku-4-5` |

> Haiku use case for subscription users: when running a large batch of tasks, routing simple/repetitive tasks to Haiku conserves your Sonnet/Opus quota for the tasks where quality actually matters. Haiku is also the fastest — good for repair attempts on trivial failures.

```mermaid
flowchart TD
    TASK([Task assigned to Claude]) --> CLASSIFY{Task type\nand complexity}

    CLASSIFY -- type: architecture\nOR complexity: high\nOR deps: many cross-file --> OPUS[claude-opus-4-6\nDeep reasoning\nHighest quota cost]

    CLASSIFY -- type: code / refactor / test / deps\nOR complexity: medium --> SONNET[claude-sonnet-4-6\nDefault\nMedium quota cost]

    CLASSIFY -- type: docs / boilerplate / fixture\nOR complexity: low\nOR repair: trivial-error --> HAIKU[claude-haiku-4-5\nFast + lightweight\nLowest quota cost]

    OPUS --> INVOKE[Invoke:\nclaude --model X --print\n--output-format json prompt]
    SONNET --> INVOKE
    HAIKU --> INVOKE

    INVOKE --> CHECK{Claude quota\nhit on this model?}
    CHECK -- yes, Opus quota hit --> FALLBACK1[Retry with Sonnet\nsame prompt]
    CHECK -- yes, Sonnet quota hit --> FALLBACK2[Retry with Haiku\nor fallback to Codex]
    CHECK -- no --> RESULT([Return output])
    FALLBACK1 --> INVOKE
    FALLBACK2 --> INVOKE
```

---

## 6. Task Execution Pipeline (Detailed)

Inside a single task — from assignment to merged commit.

```mermaid
flowchart TD
    A([Task ASSIGNED\nprovider + model chosen]) --> B[Assemble ContextPack\nmust / should / optional tiers]
    B --> C[Hash prompt envelope\nimmutable TaskContract]
    C --> D[git worktree create\nfrom baseline HEAD]
    D --> E[Filter sandbox env\nremove secrets, limit network]
    E --> F[Spawn provider CLI\nvia PTY in worktree dir]

    F --> G{Heartbeat\nwatchdog active}
    G -- no output for heartbeatTimeout --> H[Kill PTY\nWATCHDOG_TIMEOUT]
    H --> FAIL_EXEC([EXEC_FAILED])
    G -- output flowing --> I[Stream output\nparse progress markers]

    I --> J{Exit code\nfrom CLI}
    J -- non-zero --> FAIL_EXEC
    J -- zero --> K[Check for completion\nmarker in output]

    K -- marker absent --> FAIL_EXEC
    K -- marker present --> L{Scope policy check\ncanonical path allowlist}

    L -- path outside scope --> FAIL_SCOPE([SCOPE_VIOLATION])
    L -- pass --> M{Output verifier\nexpected files exist?\nexports present?\nsmoke test passes?}

    M -- fail --> FAIL_VERIFY([OUTPUT_VERIFY_FAILED])
    M -- pass --> N[git commit in worktree\nwith task metadata footer]

    N --> O[Acquire merge lock\nfencing token]
    O --> P{Pre-merge staleness\ncheck — did main move?}

    P -- staleness detected --> STALE[Replan affected tasks\nSTALENESS_TRIGGERED]
    P -- clean --> Q[cherry-pick commit\nto main branch]

    Q --> R{Post-merge gate\nbaselineGateCommand}
    R -- fail --> REVERT_CM[git revert\nlog GATE_FAILED]
    REVERT_CM --> FAIL_GATE([GATE_FAILED])
    R -- pass --> S[Record artifact signatures\nrelease merge lock]

    S --> DONE([Task COMMITTED → MERGED])
```

---

## 7. Agent Coordination Model

**Critical concept:** providers never talk to each other. There is no agent-to-agent communication channel. Coordination is entirely through the orchestrator and git. Think of it as isolated offices sharing a single codebase through code review.

```mermaid
sequenceDiagram
    participant USER as User
    participant ORCH as Orchestrator
    participant GIT as Git (main)
    participant WT_A as Worktree: Task A\n(Codex)
    participant WT_B as Worktree: Task B\n(Claude)
    participant WT_C as Worktree: Task C\n(Claude)

    USER->>ORCH: "add auth module + tests + docs"
    ORCH->>ORCH: Plan DAG\nA=auth code → B=tests (dep: A) → C=docs (dep: A)

    Note over ORCH,GIT: Tasks B and C cannot start until A merges

    ORCH->>WT_A: spawn Codex\n"implement auth module"
    WT_A-->>GIT: Task A commits → cherry-picked to main
    ORCH->>GIT: merge A ✓

    par Tasks B and C start concurrently after A merges
        ORCH->>WT_B: spawn Claude Sonnet\n"write tests for auth module"\n[reads A's committed files from main]
    and
        ORCH->>WT_C: spawn Claude Haiku\n"write docs for auth module"\n[reads A's committed files from main]
    end

    WT_B-->>GIT: Task B commits → cherry-picked
    WT_C-->>GIT: Task C commits → cherry-picked

    GIT-->>ORCH: all tasks merged
    ORCH-->>USER: Run COMPLETED\n3 tasks merged
```

Key rules:
- Providers operate in **complete isolation** in separate git worktrees
- Task B sees Task A's output **only after** A has been cherry-picked to main and B's worktree context is assembled
- The **DAG dependency edges** are the only coordination mechanism — not message passing
- The orchestrator is the **sole mediator** between all agents

---

## 8. Resume & Recovery Flow

What happens when a run crashes mid-execution and is resumed.

```mermaid
flowchart TD
    CRASH([Process crash / kill]) --> RESUME([User: orchestrator resume runId])
    RESUME --> RECON[Reconcile state\npriority: git > event log > SQLite]

    RECON --> GIT_CHECK{Scan git log\nfor task metadata footers}
    GIT_CHECK --> EVLOG_CHECK{Scan event log\nfor TASK_COMMITTED events}
    EVLOG_CHECK --> DB_CHECK{Read SQLite\ntask states}

    DB_CHECK --> MERGE_TRUTH[Build merged truth\nresolution priority:\ngit=1 eventlog=2 sqlite=3]

    MERGE_TRUTH --> AMBIG{Any tasks in\nambiguous state?}
    AMBIG -- yes: DB=MERGED but git commit missing --> REQUEUE[Requeue task\nPARTIAL_WRITE_ROLLBACK]
    AMBIG -- yes: DB=PENDING but git has commit --> SKIP[Mark MERGED\nDB_LAG]
    AMBIG -- no --> CONTINUE

    REQUEUE --> CONTINUE
    SKIP --> CONTINUE

    CONTINUE[Resume scheduler\nwith reconciled task states] --> SCHED([Orchestrator loop\ncontinues from checkpoint])
```

---

## 9. Quota Fallback Weight Reference Card

Quick visual reference for the full fallback matrix at a glance.

```mermaid
flowchart LR
    subgraph TIER1["Weight 1 — Most generous quota"]
        CODEX["★★★ Codex CLI\nFirst choice always"]
    end
    subgraph TIER2["Weight 2 — Second choice"]
        CLAUDE["★★ Claude Code\nSonnet 4.6 default\nOpus for complex\nHaiku for simple"]
    end
    subgraph TIER3["Weight 3 — Last resort"]
        GEMINI["★ Gemini CLI\nFallback when both\nothers are on cooldown"]
    end

    CODEX -- "quota hit" --> CLAUDE
    CLAUDE -- "quota hit" --> GEMINI
    GEMINI -- "quota hit" --> CODEX
    CLAUDE -- "quota hit\n(Codex available)" --> CODEX
    GEMINI -- "quota hit\n(Codex available)" --> CODEX

    style CODEX fill:#16a34a,color:#fff
    style CLAUDE fill:#2563eb,color:#fff
    style GEMINI fill:#9333ea,color:#fff
```

---

## 10. Reasoning Level & Model Selection (Desired — Not Yet Implemented)

Each provider exposes controls for how hard it thinks. Using lower reasoning on simple tasks saves quota for complex ones. **None of this exists in the codebase today** — `ProviderExecutionRequest` has no `reasoningLevel` or `model` field, and `TaskContract` has no `complexity` field. This is the next meaningful feature gap after the one-line fallback fix.

### Per-Provider Reasoning Controls

| Provider | Control | Values | CLI flag (approximate) |
|----------|---------|--------|----------------------|
| **Codex** | Reasoning effort | `low` · `medium` · `high` · `extra-high` | `--reason <level>` |
| **Claude Code** | Model tier | `haiku-4-5` · `sonnet-4-6` · `opus-4-6` | `--model <model>` |
| **Gemini** | Model tier | `flash` · `pro` | `--model <model>` |

### Task Complexity → Provider Settings Mapping

```mermaid
flowchart TD
    TASK([Task ready to execute]) --> CPLX{Task complexity\nset during planning}

    CPLX -- low\nboilerplate / docs / fixtures\nsimple rename / formatting --> LOW_MAP

    CPLX -- medium\nstandard code / test / refactor\ntypical bug fix --> MED_MAP

    CPLX -- high\narchitecture / large refactor\ncross-module redesign\nplanning / audit --> HIGH_MAP

    subgraph LOW_MAP["Low Complexity Settings"]
        LC1["Codex → --reason low\nfastest, least quota"]
        LC2["Claude → haiku-4-5\nlowest quota cost"]
        LC3["Gemini → flash\nlowest quota cost"]
    end

    subgraph MED_MAP["Medium Complexity Settings"]
        MC1["Codex → --reason medium\nbalanced default"]
        MC2["Claude → sonnet-4-6\ndefault model"]
        MC3["Gemini → pro\nstandard model"]
    end

    subgraph HIGH_MAP["High Complexity Settings"]
        HC1["Codex → --reason high\nor extra-high for deepest work"]
        HC2["Claude → opus-4-6\nbest reasoning"]
        HC3["Gemini → pro\nbest available"]
    end

    LOW_MAP --> EXEC([Execute with mapped settings])
    MED_MAP --> EXEC
    HIGH_MAP --> EXEC
```

### What Needs to Be Added to the Codebase

```mermaid
flowchart LR
    subgraph TYPES["src/core/types.ts"]
        TC["TaskContract\n+ complexity: low|medium|high"]
        PER["ProviderExecutionRequest\n+ reasoningLevel: low|medium|high|extra-high\n+ model: string"]
    end

    subgraph SCHEMA["src/planning/dag-schema.ts"]
        DS["taskContractSchema\n+ complexity field"]
    end

    subgraph ROUTER["src/providers/router.ts"]
        RM["routeTask()\n+ map complexity → reasoningLevel + model\nper provider"]
    end

    subgraph ADAPTERS["src/providers/adapters/"]
        CA["codex.ts\n+ append --reason level to args"]
        CL["claude.ts\n+ append --model model to args"]
        GE["gemini.ts\n+ append --model model to args"]
    end

    subgraph CONFIG["src/core/config.ts"]
        CF["RuntimeConfig\n+ complexityModelMap per provider"]
    end

    TC --> ROUTER
    PER --> CA
    PER --> CL
    PER --> GE
    DS --> TC
    RM --> PER
    CF --> RM
```

### Quota Cost Comparison (Illustrative)

```mermaid
flowchart LR
    subgraph CODEX_COST["Codex Quota Cost per task"]
        CL1["extra-high ████████████ 100%"]
        CL2["high     ████████░░░░  65%"]
        CL3["medium   █████░░░░░░░  40%"]
        CL4["low      ███░░░░░░░░░  20%"]
    end

    subgraph CLAUDE_COST["Claude Quota Cost per task"]
        CC1["opus-4-6   ████████████ 100%"]
        CC2["sonnet-4-6 ██████░░░░░░  50%"]
        CC3["haiku-4-5  ███░░░░░░░░░  15%"]
    end
```

---

## 11. Known Gaps — Implementation Backlog

### Gap 1 — One-Line Fix (router.ts)

```
src/providers/router.ts, line 6

Current (wrong):
  gemini: ["claude", "codex"]

Correct (matches weight system — Codex=1 beats Claude=2):
  gemini: ["codex", "claude"]
```

When Gemini hits quota, it should prefer Codex (weight 1) over Claude (weight 2). All other fallback orders are already correct. This is a one-line change.

---

### Gap 2 — Reasoning Level & Model Selection (multi-file feature)

**Scope:** `types.ts`, `dag-schema.ts`, `router.ts`, `config.ts`, `codex.ts`, `claude.ts`, `gemini.ts`

**What's missing:**
- `TaskContract` has no `complexity` field — the planner never declares how hard a task is
- `ProviderExecutionRequest` has no `reasoningLevel` or `model` field — adapters can't vary their CLI args
- Adapters use hardcoded arg arrays — no reasoning/model flags are ever passed
- No config section for mapping complexity tiers to per-provider models

**Impact without it:** Every task runs at default reasoning/model regardless of complexity. Simple boilerplate tasks consume the same quota as architectural redesigns.

**Impact with it:** Simple tasks use Codex low / Claude Haiku / Gemini Flash → dramatically extends effective daily usage across all three $20 subscriptions.
