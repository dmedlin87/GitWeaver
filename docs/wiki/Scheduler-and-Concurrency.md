# Scheduler and Concurrency

GitWeaver's scheduler manages concurrent task execution across multiple providers while ensuring safe concurrent access to shared resources through lock leasing and fencing tokens.

## Architecture Overview

```
                  +------------------+
                  |  Priority Queue  |
                  +--------+---------+
                           |
                    tryDispatch()
                           |
                  +--------v---------+
                  |  Token Buckets   |  (per-provider capacity limits)
                  +--------+---------+
                           |
                    tryAcquire(provider)
                           |
                  +--------v---------+
                  |   Lock Manager   |  (write leases + fencing tokens)
                  +--------+---------+
                           |
                   tryAcquireWrite(resources)
                           |
                  +--------v---------+
                  | Provider Adapter |
                  +------------------+
```

## Priority Queue

Tasks are dispatched in priority order. Higher priority values dispatch first.

### Enqueue

```
scheduler.enqueue(task, priority)
```

### Dispatch

```
scheduler.tryDispatch(canDispatch?)
```

The dispatch loop:
1. Dequeue the highest-priority task
2. If an optional `canDispatch` filter is provided, check it
3. If the provider's token bucket has capacity, acquire a token
4. Return the task for execution

### Priority Aging

To prevent starvation, tasks that wait too long in the queue have their priority automatically increased. This ensures that low-priority tasks eventually get dispatched even when high-priority tasks keep arriving.

## Token Buckets

Each provider has a fixed-capacity token bucket that limits how many tasks it can execute simultaneously.

### Default Capacities

| Provider | Default Capacity |
|----------|-----------------|
| Codex | 1 |
| Claude | 2 |
| Gemini | 2 |

Configure via `providerBuckets` in your config file:

```json
{
  "providerBuckets": {
    "codex": 2,
    "claude": 4,
    "gemini": 3
  }
}
```

### Lifecycle

1. **Acquire**: Before dispatching a task to a provider, a token is acquired
2. **Execute**: Task runs while holding the token
3. **Release**: On task completion (success or failure), the token is returned

If no tokens are available for a provider, the task is requeued and the scheduler waits.

### Global Concurrency Cap

The `concurrencyCap` (default: 4) limits total concurrent tasks across all providers. The sum of provider bucket capacities should not exceed this value.

## Lock Manager

The lock manager implements distributed write leasing with monotonic fencing tokens.

### Write Leases

Before a task can modify files, it must acquire write leases for all resources in its scope:

```
lockManager.tryAcquireWrite(resourceKeys, ownerTaskId)
```

Resource keys follow the pattern:
- `file:src/auth/login.ts` &mdash; specific file
- `class:auth` &mdash; logical resource class
- `artifact:bundle` &mdash; build artifact

### Lease Properties

| Property | Description |
|----------|-------------|
| `resourceKey` | The resource being locked |
| `mode` | `read` or `write` |
| `ownerTaskId` | Which task holds the lease |
| `acquiredAt` | When the lease was acquired (ISO 8601) |
| `expiresAt` | When the lease expires (ISO 8601) |
| `fencingToken` | Monotonic counter for this resource |

### Lease Duration

Default: 120 seconds (`leaseDurationSec`).

Leases are renewed via heartbeat at 30-second intervals (`leaseRenewSec`).

### Fencing Tokens

Each resource has a monotonically increasing fencing token counter. When a lease is acquired, the counter increments and the new value is assigned to the lease.

Before any merge operation, the fencing token is validated:

```
lockManager.validateFencing(resourceKey, ownerTaskId, fencingToken)
```

If another task has acquired a newer lease (higher fencing token), the merge is rejected. This prevents "zombie" merges from tasks that timed out.

### Lease Expiry

Expired leases are automatically cleaned up with a small buffer (50ms) to account for clock skew. When a lease expires:
- The resource becomes available for other tasks
- The expired task's merge attempt will fail fencing validation

### Lease Operations

| Operation | Description |
|-----------|-------------|
| `tryAcquireWrite(keys, taskId)` | Acquire write leases for all keys atomically (all-or-nothing) |
| `renew(key, taskId, token)` | Extend lease expiry (must match owner + token) |
| `validateFencing(key, taskId, token)` | Check if lease is still valid |
| `releaseOwner(taskId)` | Release all leases held by a task |
| `snapshot()` | Get current state of all leases |

## Merge Queue

The merge queue serializes commit integration to prevent race conditions.

### Queue Entry

```typescript
{
  taskId: string;
  commit: string;       // Git commit hash
  leaseToken: number;   // Fencing token
}
```

### Merge Process

1. Task enters the queue after passing scope validation
2. Queue processes entries one at a time (serialized)
3. Before merge:
   - Validate fencing token is still valid
   - Check that the commit hash matches expectations
4. Cherry-pick the commit into the main branch
5. If merge conflict: mark as `VERIFY_FAILED` with `MERGE_CONFLICT` reason
6. Release write leases after merge

## Lease Heartbeat

Long-running provider executions send periodic heartbeats to renew their leases:

- **Interval**: Every `leaseRenewSec` seconds (default: 30)
- **Timeout**: If no heartbeat for `heartbeatTimeoutSec` seconds (default: 60), the task is considered hung
- **Termination**: Hung tasks receive SIGTERM, then SIGKILL after `terminateGraceSec` (default: 10)

## Inspecting Locks

Use the `locks` command to inspect the current lease state:

```bash
orchestrator locks <runId> --json
```

Output includes:
- Active leases (resource, owner, expiry, fencing token)
- Pending lease requests
- Token bucket availability per provider

## Concurrency Tuning

### Low Concurrency (Conservative)

For small projects or limited API quotas:

```json
{
  "concurrencyCap": 2,
  "providerBuckets": {
    "codex": 1,
    "claude": 1,
    "gemini": 0
  }
}
```

### High Concurrency (Aggressive)

For large projects with generous API quotas:

```json
{
  "concurrencyCap": 8,
  "providerBuckets": {
    "codex": 2,
    "claude": 3,
    "gemini": 3
  },
  "leaseDurationSec": 300,
  "leaseRenewSec": 60
}
```

### Avoiding Deadlocks

The lock manager uses all-or-nothing lease acquisition: if any resource in a task's scope is already locked, the entire acquisition fails and the task is requeued. This prevents circular wait conditions.
