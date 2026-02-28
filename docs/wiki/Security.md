# Security

GitWeaver enforces security at multiple levels: file scope policies, command allowlists, environment isolation, path escape prevention, and secret redaction.

## File Scope Policy

Every task declares a `writeScope` that limits which files it can modify.

### Scope Definition

```json
{
  "writeScope": {
    "allow": ["src/auth/**/*.ts"],
    "deny": ["src/auth/secrets.ts", "**/*.env"],
    "ownership": "exclusive",
    "sharedKey": null
  }
}
```

| Field | Description |
|-------|-------------|
| `allow` | Glob patterns. Changed files **must** match at least one. |
| `deny` | Glob patterns. Changed files **must not** match any. |
| `ownership` | Concurrency mode for the files. |
| `sharedKey` | Groups tasks with the same shared key for serial access. |

### Ownership Modes

| Mode | Description |
|------|-------------|
| `exclusive` | Only this task may write to these files. Enforced by write leases. |
| `shared-serial` | Multiple tasks may write, but merges are serialized to prevent conflicts. |
| `shared-append` | Files can only have content appended. Restricted to specific extensions (`.json`, `.yaml`, `.yml` by default). |

### How Scope Is Enforced

After a provider produces a commit:

1. **Diff analysis**: Extract the list of changed files from the commit
2. **Path canonicalization**: For each file path:
   - Resolve symlinks to their real targets
   - Normalize case (lowercase on Windows, preserve on Unix)
   - Convert to repo-relative paths
   - Reject paths that escape the repo root (via `../`)
3. **Deny check**: If any file matches a deny pattern &rarr; `SCOPE_FAILED`
4. **Allow check**: If any file does NOT match an allow pattern &rarr; `SCOPE_FAILED`
5. **Pass**: All files are within allowed scope

### Path Escape Prevention

The canonicalization step prevents several attack vectors:

| Vector | Mitigation |
|--------|-----------|
| Symlink escape | Symlink targets are resolved; must remain within repo |
| Relative traversal (`../`) | Rejected during canonicalization |
| Case manipulation | Normalized to prevent bypass on case-insensitive filesystems |
| Absolute paths | Converted to repo-relative |

## Command Policy

Each task declares which commands the provider is allowed to run.

### Policy Definition

```json
{
  "commandPolicy": {
    "allow": ["pnpm test", "pnpm build", "tsc"],
    "deny": ["rm -rf", "curl", "wget"],
    "network": "deny"
  }
}
```

### Evaluation Logic

1. If the allow list is empty &rarr; **reject all commands**
2. Check deny patterns (substring match) &rarr; **reject** if any match
3. Check allow patterns (prefix match) &rarr; **allow** if any match
4. Default &rarr; **reject**

### Default Deny List

These commands are denied by default for all tasks:

```
npm install
pnpm install
yarn install
git push
curl
wget
rm -rf
```

### Network Policy

| Setting | Effect |
|---------|--------|
| `deny` (default) | No outbound network access during task execution |
| `allow` | Outbound network permitted |

In container mode, `deny` maps to `--net=none`; in host mode, network policy is advisory.

## Environment Variable Filtering

Provider processes receive a sanitized environment. Only safe variables pass through.

### Allowed Variables

| Variable | Purpose |
|----------|---------|
| `PATH` | System path (required for binaries) |
| `LANG`, `LC_ALL`, `LC_CTYPE` | Locale settings |
| `TZ` | Timezone |
| `TERM`, `COLORTERM` | Terminal type |
| `ORCH_*` | Any orchestrator-prefixed variable |

### Blocked Variables

Everything else is stripped, including:

- `HOME`, `USERPROFILE` &mdash; replaced with a sandbox temp directory
- `AWS_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID` &mdash; cloud credentials
- `GITHUB_TOKEN`, `GH_TOKEN` &mdash; repository tokens
- `DATABASE_URL` &mdash; database connection strings
- `SSH_AUTH_SOCK` &mdash; SSH agent
- Any `.env`-style secrets

### Sandbox Home Directory

Each task gets a temporary home directory at:
```
<tmpdir>/orc-home/<runId>/<taskId>/
```

Provider config directories (`.codex`, `.claude`, `.gemini`) are copied into this sandbox home so providers can authenticate without exposing the user's actual home directory.

## Execution Isolation

### Host Mode

Providers run as child processes with:
- Filtered environment variables
- Working directory set to the isolated worktree
- PTY-based output capture
- Process termination with grace period (`terminateGraceSec`)

### Container Mode

Providers run inside Docker/Podman with:
- Network isolation (`--net=none` when network policy is `deny`)
- Read-only filesystem mounts (except the working directory)
- Filtered environment variables passed via `--env`
- Isolated process namespace

## Secret Redaction

All log output and error messages are scanned for secret patterns. Matches are replaced with `[REDACTED]`.

### Patterns Detected

| Pattern | Example |
|---------|---------|
| OpenAI API keys | `sk-abc123...` |
| Token assignments | `api_token=xyz...` |
| AWS Access Keys | `AKIA0123456789ABCDEF` |
| GitHub tokens | `ghp_abc123...` |

### Redaction Scope

- Event log output
- Error messages stored in SQLite
- Gate command results (stdout/stderr)
- CLI progress output

When `forensicRawLogs: true` is set in config, unredacted logs are preserved in a separate channel for debugging. This is disabled by default.

## Fencing Tokens

Write leases use monotonic fencing tokens to prevent stale writes. Before any merge operation:

1. The task's fencing token is validated against the current counter
2. If the token is stale (another task acquired the lease), the merge is rejected
3. This prevents "zombie" tasks from corrupting the repository after a timeout

See [[Scheduler and Concurrency]] for implementation details.
