# Workflow Lifecycle

This page describes the complete end-to-end orchestration pipeline, from prompt to merged changes.

## High-Level Flow

```
User Prompt
    |
    v
 INGEST -----------> Validate repo, capture baseline
    |
    v
 BASELINE GATE ----> Run gate command (e.g., tsc)
    |
    v
 PREFLIGHT A ------> Check provider availability & auth
    |
    v
 PLAN GENERATION --> Codex generates task DAG
    |
    v
 PLAN AUDIT -------> Detect hot resources, adjust ownership
    |
    v
 PLAN FREEZE ------> Hash and lock the plan
    |
    v
 PREFLIGHT B ------> Recheck providers for routed plan
    |
    v
 DISPATCHING ------> Acquire leases, dispatch to providers
    |                    |
    |               +---------+
    |               | EXECUTE |  (per task, in isolated worktrees)
    |               +---------+
    |                    |
    v                    v
 SCOPE CHECK ------> Validate changed files against policy
    |
    v
 MERGE QUEUE ------> Serialize merges with fencing tokens
    |
    v
 POST-MERGE GATE --> Run verification commands
    |
    v
 STALENESS CHECK --> Detect baseline drift
    |
    v
 REPAIR (bounded) -> Classify failures, retry within budget
    |
    v
 COMPLETED --------> All tasks verified and merged
```

## Stage Details

### 1. Ingest

The orchestrator initializes a new run:

1. Generate a unique `runId` (UUID)
2. Resolve the repository path (default: current working directory)
3. Load configuration (defaults + config file + CLI flags)
4. Initialize SQLite database at `.orchestrator/state.sqlite`
5. Validate the repository is a git repo with a clean working tree
6. Capture the `baselineCommit` (current HEAD)
7. Create the run directory at `.orchestrator/runs/<runId>/`

### 2. Baseline Gate

A command (default: `pnpm -s tsc -p .`) is executed to confirm the project is in a good state before orchestration begins.

- **Pass**: Continue to planning
- **Fail + `--allow-baseline-repair`**: Log warning, continue anyway
- **Fail (default)**: Abort with `ABORTED_BASELINE`

### 3. Preflight A (Provider Checks)

For each configured provider:

1. Check if the CLI binary exists on `PATH`
2. Query the installed version
3. Check the latest available version on npm
4. Verify authentication status
5. Report health status

If a required provider is missing, behavior depends on `--install-missing`:
- `prompt`: Ask the user
- `auto`: Install automatically
- `never`: Abort

### 4. Plan Generation

The user prompt is sent to the planner (Codex by default) which returns a JSON DAG:

```typescript
interface DagSpec {
  tasks: TaskContract[];
}

interface TaskContract {
  taskId: string;
  title: string;
  objective: string;
  type: "code" | "refactor" | "test" | "docs" | "config" | "repair";
  provider: "codex" | "claude" | "gemini";
  dependencies: string[];
  writeScope: {
    allow: string[];
    deny: string[];
    ownership: "exclusive" | "shared-serial" | "shared-append";
    sharedKey?: string;
  };
  commandPolicy: {
    allow: string[];
    deny: string[];
    network: "deny" | "allow";
  };
  outputContract?: {
    exports?: string[];
    testFilePattern?: string;
  };
  outputVerificationRequired: boolean;
}
```

The DAG is validated against a Zod schema. If validation fails, the planner is retried up to 2 times.

### 5. Plan Audit

A deterministic audit identifies **hot resources** that require special handling:

- **Lockfiles**: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`
- **Barrel exports**: `index.ts`, `index.js`
- **Schema files**: `schema.prisma`, migration files
- **Config files**: `tsconfig.json`, `.eslintrc.*`

If multiple tasks write to the same hot resource, ownership is upgraded to `shared-serial` to prevent merge conflicts.

### 6. Plan Freeze

The audited plan is frozen:

1. Compute SHA-256 hashes for each task contract
2. Compute an overall DAG hash
3. Write `plan.frozen.json`
4. Transition run to `PLAN_FROZEN`

These hashes are used later to detect prompt drift and validate merge integrity.

### 7. Preflight B (Route Verification)

After the plan is frozen:

1. Identify which providers are needed by the routed plan
2. Verify those specific providers are healthy
3. Record provider versions in the run manifest

### 8. Dispatching

Tasks enter a priority queue and are dispatched based on:

1. **Dependencies**: All parent tasks must be `VERIFIED` first
2. **Priority**: Higher priority tasks dispatch first (with aging to prevent starvation)
3. **Provider tokens**: A token bucket limits concurrent executions per provider
4. **Write leases**: Fencing tokens must be acquired for all resources in the task's write scope

### 9. Execution

Each task executes in an isolated environment:

1. A git worktree is created from the baseline commit
2. The provider receives a **prompt envelope** containing:
   - Immutable sections (objective, constraints, scope rules)
   - Mutable hints (context from codebase, dependency info)
3. The provider runs in a sandbox with filtered environment variables
4. The provider produces a commit with orchestration metadata footers:
   ```
   ORCH_RUN_ID=<runId>
   ORCH_TASK_ID=<taskId>
   ORCH_PROVIDER=<provider>
   ```

### 10. Scope Validation

After a task produces a commit, the changed files are validated:

1. **Path canonicalization**: Resolve symlinks, normalize case, enforce repo boundary
2. **Deny check**: Reject if any file matches a deny pattern
3. **Allow check**: Reject if any file does NOT match an allow pattern
4. **Path escape prevention**: Reject `../` traversals and symlinks outside the repo

### 11. Merge Queue

Tasks that pass scope validation enter a serialized merge queue:

1. Validate the fencing token is still valid (prevents zombie merges)
2. Cherry-pick the task commit into the main branch
3. If merge conflict: classify as `MERGE_CONFLICT`, enqueue repair

### 12. Post-Merge Gate

After merging, verification gates run:

1. **Smoke gate**: A command per task type (e.g., `pnpm test --runInBand`)
2. **Baseline regression**: Re-run the baseline gate command
3. **Output contract**: If `outputVerificationRequired`, verify exports and test files exist

### 13. Staleness Detection

After each merge, check for baseline drift:

- If the baseline commit has changed (new commits pushed by others)
- If dependency hashes have changed
- Stale tasks are marked `STALE` and either re-planned or escalated

### 14. Repair (Bounded)

Failed tasks enter the repair system:

1. **Classify** the failure (compile error, test failure, scope violation, merge conflict)
2. **Check budget**: Max 2 attempts per failure class (configurable)
3. **Build repair task**: Narrowed write scope focused on error files
4. **Re-enqueue**: Repair task enters the scheduler as `PENDING`
5. **Budget exhausted**: If max attempts reached, abort with `ABORTED_BUDGET`

### 15. Completion

The run completes when all tasks reach `VERIFIED` state. The final run state is `COMPLETED`.

If any task cannot be resolved (budget exhausted, policy violation, manual abort), the run ends in one of:
- `ABORTED_BUDGET`
- `ABORTED_POLICY`
- `ABORTED_BASELINE`
- `ABORTED_MANUAL`
