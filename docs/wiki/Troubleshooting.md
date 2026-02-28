# Troubleshooting

Common issues and how to resolve them.

## Provider Issues

### Provider Not Found

**Error:**
```
Provider binary 'claude' not found
```

**Cause:** The provider CLI is not installed or not on `PATH`.

**Fix:**
```bash
# Automatic install
orchestrator providers install --providers claude --yes

# Manual install
npm install -g @anthropic-ai/claude-code
```

### Authentication Missing

**Error:**
```
claude: installed=true auth=MISSING
  - Authentication required. Run: claude auth login
```

**Fix:**
```bash
# Automatic fix
orchestrator providers auth --provider claude --fix

# Manual fix
claude auth login
```

### Provider Degraded / Unhealthy

**Error:**
```
claude: health=DEGRADED (score: 40, cooldown: 25s remaining)
```

**Cause:** Multiple consecutive failures have degraded the provider's health score below the dispatch threshold (50).

**What happens:** The provider enters a cooldown period with exponential backoff. After cooldown, it becomes eligible for dispatch again. Each success recovers 10 health points.

**Options:**
- Wait for the cooldown to expire and let recovery happen naturally
- Check if the provider's API is experiencing an outage
- Verify authentication is still valid: `orchestrator providers auth --provider claude`

### Provider Timeout

**Error:**
```
EXEC_FAILED: Provider execution timed out
```

**Cause:** The provider took too long to respond. The heartbeat timeout (`heartbeatTimeoutSec`, default: 60s) was exceeded.

**Fix:** Increase the heartbeat timeout in your config:

```json
{
  "heartbeatTimeoutSec": 120
}
```

## Baseline Issues

### Baseline Gate Failed

**Error:**
```
ABORTED_BASELINE: Baseline gate failed
```

**Cause:** The project doesn't build cleanly before orchestration starts.

**Fix:**
1. Run the baseline command manually and fix any errors:
   ```bash
   pnpm -s tsc -p .
   ```
2. Or skip the baseline gate (not recommended for production):
   ```bash
   orchestrator run "..." --allow-baseline-repair
   ```

### Dirty Working Tree

**Error:**
```
ABORTED_BASELINE: BASELINE_DIRTY_REPO
```

**Cause:** The git working tree has uncommitted changes.

**Fix:**
```bash
# Commit or stash your changes
git add -A && git commit -m "WIP"
# or
git stash
```

### Not a Git Repository

**Error:**
```
ABORTED_BASELINE: REPO_NOT_GIT
```

**Cause:** The target directory is not a git repository.

**Fix:**
```bash
cd /path/to/your/project
git init
git add -A && git commit -m "Initial commit"
```

## Resume Issues

### Baseline Drift

**Error:**
```
RESUME_DRIFT_REQUIRES_ACCEPT: Baseline has drifted since run started
```

**Cause:** New commits were pushed to the branch after the run started.

**Fix:**
```bash
orchestrator resume <runId> --accept-drift
```

This revalidates all previously merged tasks against the new baseline.

### Ambiguous State

**Error:**
```
RESUME_AMBIGUOUS_STATE: Event log claims MERGED but commit not found in git
```

**Cause:** The event log recorded a merge, but the commit is not in git history. This can happen if a merge was interrupted or if history was rewritten.

**What happens:** The task is escalated (not retried) because the state is uncertain.

**Options:**
- Check git reflog for the missing commit
- Start a new run if the ambiguity cannot be resolved

### Missing Commit

**Warning:**
```
RESUME_MISSING_COMMIT: Database says MERGED but git has no matching commit
```

**Cause:** SQLite recorded a merge that didn't complete. The task is automatically requeued.

**Action required:** None &mdash; the task will be re-executed.

## Scope Issues

### Scope Violation

**Error:**
```
SCOPE_FAILED: SCOPE_DENY - File 'package.json' matches deny pattern
```

**Cause:** The provider modified a file that's in the task's deny list.

**Debug:**
```bash
orchestrator inspect <runId> --task <taskId> --json
```

Look at the scope validation event for the list of violating files.

**What happens:** The task is classified as `SCOPE_FAIL` and a repair task with narrowed scope is enqueued (if budget allows).

### Path Escape Detected

**Error:**
```
SCOPE_FAILED: Path escapes repository root
```

**Cause:** A changed file resolves to a path outside the repository (e.g., via symlink or `../` traversal).

**What happens:** The task fails immediately. This is a security boundary and cannot be overridden.

## SQLite Issues

### Database Locked

**Error:**
```
SQLITE_BUSY_EXHAUSTED: database is locked after 2 retries (5000ms timeout)
```

**Cause:** Another process or a concurrent write held the SQLite lock longer than the configured timeout.

**Fix:**
1. Increase the timeout:
   ```json
   {
     "sqliteBusyTimeoutMs": 10000,
     "sqliteBusyRetryMax": 3
   }
   ```
2. Reduce concurrency: `--concurrency 2`
3. Ensure only one orchestration run targets the same repository at a time

### Corrupt Database

If the SQLite database is corrupt:

```bash
# The event log and git history are authoritative
# Delete the database and resume
rm .orchestrator/state.sqlite
orchestrator resume <runId>
```

The resume algorithm will reconstruct state from git history and the event log.

## Merge Conflicts

**Error:**
```
VERIFY_FAILED: MERGE_CONFLICT
```

**Cause:** Two tasks modified overlapping files and the cherry-pick produced a conflict.

**What happens:**
1. The task is classified as `MERGE_CONFLICT`
2. A repair task is built with scope limited to the conflicting files
3. The repair task is dispatched to resolve the conflict

**Prevention:**
- The plan audit phase detects "hot resources" and upgrades ownership to `shared-serial`
- Use `exclusive` ownership for files that should only be modified by one task

## Test Failures After Merge

**Error:**
```
VERIFY_FAILED: VERIFY_FAIL_TEST
```

**Cause:** The post-merge gate (test command) failed after integrating a task's changes.

**What happens:**
1. The failure is classified as `VERIFY_FAIL_TEST`
2. Error output is parsed to extract failing test files
3. A repair task is built targeting the changed + error files
4. The repair task attempts to fix the test failures

**Debug:**
```bash
orchestrator inspect <runId> --task <taskId> --json
```

Check the `gate_results` for the full test output (stdout/stderr).

## Budget Exhaustion

**Error:**
```
ABORTED_BUDGET: Repair budget exhausted for VERIFY_FAIL_COMPILE
```

**Cause:** The task failed and was repaired the maximum number of times (default: 2) for the same failure class.

**Options:**
1. Increase the repair budget:
   ```json
   { "maxRepairAttemptsPerClass": 3 }
   ```
2. Investigate the root cause using `orchestrator inspect`
3. Fix the issue manually and start a new run

## General Debugging Steps

1. **Check status**: `orchestrator status <runId> --json`
2. **Inspect events**: `orchestrator inspect <runId> --json`
3. **Check providers**: `orchestrator providers check --json`
4. **Check locks**: `orchestrator locks <runId> --json`
5. **Read event log**: `cat .orchestrator/runs/<runId>/events.ndjson | jq .`
6. **Check manifest**: `cat .orchestrator/runs/<runId>/manifest.json | jq .`
7. **Check plan**: `cat .orchestrator/runs/<runId>/plan.frozen.json | jq .`
