import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ProviderHealthSnapshot, RunRecord, TaskRecord } from "../core/types.js";
import type { ReasonCode } from "../core/reason-codes.js";

export interface OrchestratorDbOptions {
  journalMode?: "WAL" | "DELETE";
  synchronous?: "NORMAL" | "FULL";
  busyTimeoutMs?: number;
  busyRetryMax?: number;
  onBusyRetry?: (operation: string, attempt: number, error: Error) => void;
  onBusyExhausted?: (operation: string, attempts: number, error: Error) => void;
}

export interface ResumeCheckpoint {
  runId: string;
  taskId?: string;
  state?: string;
  eventSeq: number;
  commitHash: string;
  updatedAt: string;
}

const DEFAULT_DB_OPTIONS: Required<Pick<OrchestratorDbOptions, "journalMode" | "synchronous" | "busyTimeoutMs" | "busyRetryMax">> = {
  journalMode: "WAL",
  synchronous: "NORMAL",
  busyTimeoutMs: 5_000,
  busyRetryMax: 2
};

const SQLITE_BUSY_ERRCODE = 5;

const SLEEP_BUFFER = new SharedArrayBuffer(4);
const SLEEP_VIEW = new Int32Array(SLEEP_BUFFER);

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_VIEW, 0, 0, ms);
}

export class OrchestratorDb {
  private readonly db: DatabaseSync;
  private readonly options: Required<Pick<OrchestratorDbOptions, "journalMode" | "synchronous" | "busyTimeoutMs" | "busyRetryMax">> & Omit<OrchestratorDbOptions, "journalMode" | "synchronous" | "busyTimeoutMs" | "busyRetryMax">;
  private upsertTaskStmt: StatementSync | undefined;

  public constructor(dbPath: string, options: OrchestratorDbOptions = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.options = {
      ...DEFAULT_DB_OPTIONS,
      ...options
    };
    this.db = new DatabaseSync(dbPath);
    this.applyPragmas();
  }

  public migrate(): void {
    this.withBusyRetry("migrate", () => {
      const bundledPath = fileURLToPath(new URL("./migrations/001_init.sql", import.meta.url));
      const sourceFallback = join(process.cwd(), "src", "persistence", "migrations", "001_init.sql");
      const migrationPath = existsSync(bundledPath) ? bundledPath : sourceFallback;
      const sql = readFileSync(migrationPath, "utf8");
      this.db.exec(sql);

      // Backfill columns for older state.sqlite files created before current schema.
      this.ensureColumn("provider_health", "cooldown_until", "TEXT");
      this.ensureColumn("provider_health", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
      this.ensureColumn("provider_health", "backoff_sec", "INTEGER NOT NULL DEFAULT 0");
      this.ensureColumn("resume_checkpoints", "task_id", "TEXT");
      this.ensureColumn("resume_checkpoints", "state", "TEXT");
    });
  }

  public transaction<T>(fn: () => T): T {
    return this.withBusyRetry("transaction", () => {
      this.db.exec("BEGIN");
      try {
        const result = fn();
        if (result instanceof Promise) {
          throw new Error("Async callbacks are not supported in synchronous transactions. Use a synchronous function.");
        }
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  public upsertRun(run: RunRecord): void {
    this.withBusyRetry("upsertRun", () => {
      this.db
        .prepare(
          `INSERT INTO runs(run_id, objective, repo_path, baseline_commit, config_hash, state, created_at, updated_at, reason_code)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             objective=excluded.objective,
             repo_path=excluded.repo_path,
             baseline_commit=excluded.baseline_commit,
             config_hash=excluded.config_hash,
             state=excluded.state,
             updated_at=excluded.updated_at,
             reason_code=excluded.reason_code`
        )
        .run(
          run.runId,
          run.objective,
          run.repoPath,
          run.baselineCommit,
          run.configHash,
          run.state,
          run.createdAt,
          run.updatedAt,
          run.reasonCode ?? null
        );
    });
  }

  public upsertTask(task: TaskRecord): void {
    this.withBusyRetry("upsertTask", () => {
      if (!this.upsertTaskStmt) {
        this.upsertTaskStmt = this.db.prepare(
          `INSERT INTO tasks(run_id, task_id, provider, type, state, attempts, contract_hash, lease_token, commit_hash, reason_code)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id, task_id) DO UPDATE SET
             provider=excluded.provider,
             type=excluded.type,
             state=excluded.state,
             attempts=excluded.attempts,
             contract_hash=excluded.contract_hash,
             lease_token=excluded.lease_token,
             commit_hash=excluded.commit_hash,
             reason_code=excluded.reason_code`
        );
      }
      this.upsertTaskStmt.run(
        task.runId,
        task.taskId,
        task.provider,
        task.type,
        task.state,
        task.attempts,
        task.contractHash,
        task.leaseToken ?? null,
        task.commitHash ?? null,
        task.reasonCode ?? null
      );
    });
  }

  public recordTaskAttempt(runId: string, taskId: string, attempt: number, state: string, reasonCode?: string): void {
    this.withBusyRetry("recordTaskAttempt", () => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO task_attempts(run_id, task_id, attempt, state, reason_code, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`
        )
        .run(runId, taskId, attempt, state, reasonCode ?? null, new Date().toISOString());
    });
  }

  public recordPromptEnvelope(
    runId: string,
    taskId: string,
    attempt: number,
    immutableSectionsHash: string,
    taskContractHash: string,
    contextPackHash: string
  ): void {
    this.withBusyRetry("recordPromptEnvelope", () => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO prompt_envelopes(
            run_id,
            task_id,
            attempt,
            immutable_sections_hash,
            task_contract_hash,
            context_pack_hash,
            created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, taskId, attempt, immutableSectionsHash, taskContractHash, contextPackHash, new Date().toISOString());
    });
  }

  public getLatestPromptEnvelope(runId: string, taskId: string):
    | {
        attempt: number;
        immutableSectionsHash: string;
        taskContractHash: string;
        contextPackHash: string;
      }
    | undefined {
    const row = this.withBusyRetry("getLatestPromptEnvelope", () => {
      return this.db
        .prepare(
          `SELECT attempt, immutable_sections_hash, task_contract_hash, context_pack_hash
           FROM prompt_envelopes
           WHERE run_id=? AND task_id=?
           ORDER BY attempt DESC
           LIMIT 1`
        )
        .get(runId, taskId) as
        | {
            attempt: number;
            immutable_sections_hash: string;
            task_contract_hash: string;
            context_pack_hash: string;
          }
        | undefined;
    });

    if (!row) {
      return undefined;
    }

    return {
      attempt: row.attempt,
      immutableSectionsHash: row.immutable_sections_hash,
      taskContractHash: row.task_contract_hash,
      contextPackHash: row.context_pack_hash
    };
  }

  public upsertLease(runId: string, resourceKey: string, ownerTaskId: string, expiresAt: string, fencingToken: number): void {
    this.withBusyRetry("upsertLease", () => {
      this.db
        .prepare(
          `INSERT INTO leases(run_id, resource_key, owner_task_id, expires_at, fencing_token)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(run_id, resource_key) DO UPDATE SET
             owner_task_id=excluded.owner_task_id,
             expires_at=excluded.expires_at,
             fencing_token=excluded.fencing_token`
        )
        .run(runId, resourceKey, ownerTaskId, expiresAt, fencingToken);
    });
  }

  public upsertArtifactSignature(runId: string, artifactKey: string, signature: string, filePath?: string): void {
    this.withBusyRetry("upsertArtifactSignature", () => {
      this.db
        .prepare(
          `INSERT INTO artifacts(run_id, artifact_key, signature, file_path, updated_at)
           VALUES(?, ?, ?, ?, ?)
           ON CONFLICT(run_id, artifact_key) DO UPDATE SET
             signature=excluded.signature,
             file_path=excluded.file_path,
             updated_at=excluded.updated_at`
        )
        .run(runId, artifactKey, signature, filePath ?? null, new Date().toISOString());
    });
  }

  public listArtifactSignatures(runId: string, artifactKeys: string[]): Record<string, string> {
    if (artifactKeys.length === 0) {
      return {};
    }

    const uniqueKeys = [...new Set(artifactKeys)];
    const placeholders = uniqueKeys.map(() => "?").join(", ");
    const rows = this.withBusyRetry("listArtifactSignatures", () => {
      return this.db
        .prepare(`SELECT artifact_key, signature FROM artifacts WHERE run_id=? AND artifact_key IN (${placeholders})`)
        .all(runId, ...uniqueKeys) as Array<{ artifact_key: string; signature: string }>;
    });

    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.artifact_key] = row.signature;
      return acc;
    }, {});
  }

  public removeLeasesByTask(runId: string, taskId: string): void {
    this.withBusyRetry("removeLeasesByTask", () => {
      this.db.prepare(`DELETE FROM leases WHERE run_id=? AND owner_task_id=?`).run(runId, taskId);
    });
  }

  public listLeases(runId: string): Array<{
    runId: string;
    resourceKey: string;
    ownerTaskId: string;
    expiresAt: string;
    fencingToken: number;
  }> {
    const rows = this.withBusyRetry("listLeases", () => {
      return this.db
        .prepare(`SELECT run_id, resource_key, owner_task_id, expires_at, fencing_token FROM leases WHERE run_id=? ORDER BY resource_key`)
        .all(runId) as Array<{
        run_id: string;
        resource_key: string;
        owner_task_id: string;
        expires_at: string;
        fencing_token: number;
      }>;
    });

    return rows.map((row) => ({
      runId: row.run_id,
      resourceKey: row.resource_key,
      ownerTaskId: row.owner_task_id,
      expiresAt: row.expires_at,
      fencingToken: row.fencing_token
    }));
  }

  public recordGateResult(runId: string, taskId: string, command: string, exitCode: number, stdout: string, stderr: string): void {
    this.withBusyRetry("recordGateResult", () => {
      this.db
        .prepare(
          `INSERT INTO gate_results(run_id, task_id, command, exit_code, stdout, stderr, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, taskId, command, exitCode, stdout, stderr, new Date().toISOString());
    });
  }

  public recordRepairEvent(runId: string, taskId: string, failureClass: string, attempt: number, details: string): void {
    this.withBusyRetry("recordRepairEvent", () => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO repair_events(run_id, task_id, failure_class, attempt, details, created_at)
           VALUES(?, ?, ?, ?, ?, ?)`
        )
        .run(runId, taskId, failureClass, attempt, details, new Date().toISOString());
    });
  }

  public upsertProviderHealth(runId: string, snapshot: ProviderHealthSnapshot): void {
    this.withBusyRetry("upsertProviderHealth", () => {
      this.db
        .prepare(
          `INSERT INTO provider_health(
            run_id,
            provider,
            score,
            last_errors,
            token_bucket,
            cooldown_until,
            consecutive_failures,
            backoff_sec,
            updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, provider) DO UPDATE SET
            score=excluded.score,
            last_errors=excluded.last_errors,
            token_bucket=excluded.token_bucket,
            cooldown_until=excluded.cooldown_until,
            consecutive_failures=excluded.consecutive_failures,
            backoff_sec=excluded.backoff_sec,
            updated_at=excluded.updated_at`
        )
        .run(
          runId,
          snapshot.provider,
          snapshot.score,
          JSON.stringify(snapshot.lastErrors),
          snapshot.tokenBucket,
          snapshot.cooldownUntil ?? null,
          snapshot.consecutiveFailures ?? 0,
          snapshot.backoffSec ?? 0,
          new Date().toISOString()
        );
    });
  }

  public listProviderHealth(runId: string): ProviderHealthSnapshot[] {
    const rows = this.withBusyRetry("listProviderHealth", () => {
      return this.db
        .prepare(
          `SELECT provider, score, last_errors, token_bucket, cooldown_until, consecutive_failures, backoff_sec
           FROM provider_health
           WHERE run_id=?
           ORDER BY provider`
        )
        .all(runId) as Array<{
        provider: string;
        score: number;
        last_errors: string;
        token_bucket: number;
        cooldown_until: string | null;
        consecutive_failures: number | null;
        backoff_sec: number | null;
      }>;
    });

    return rows.map((row) => ({
      provider: row.provider as ProviderHealthSnapshot["provider"],
      score: row.score,
      lastErrors: parseJsonArray(row.last_errors),
      tokenBucket: row.token_bucket,
      cooldownUntil: row.cooldown_until ?? undefined,
      consecutiveFailures: row.consecutive_failures ?? 0,
      backoffSec: row.backoff_sec ?? 0
    }));
  }

  public upsertResumeCheckpoint(runId: string, taskId: string | undefined, state: string | undefined, eventSeq: number, commitHash: string): void {
    this.withBusyRetry("upsertResumeCheckpoint", () => {
      this.db
        .prepare(
          `INSERT INTO resume_checkpoints(run_id, task_id, state, event_seq, commit_hash, updated_at)
           VALUES(?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             task_id=excluded.task_id,
             state=excluded.state,
             event_seq=excluded.event_seq,
             commit_hash=excluded.commit_hash,
             updated_at=excluded.updated_at`
        )
        .run(runId, taskId ?? null, state ?? null, eventSeq, commitHash, new Date().toISOString());
    });
  }

  public getResumeCheckpoint(runId: string): ResumeCheckpoint | undefined {
    const row = this.withBusyRetry("getResumeCheckpoint", () => {
      return this.db
        .prepare(`SELECT run_id, task_id, state, event_seq, commit_hash, updated_at FROM resume_checkpoints WHERE run_id=?`)
        .get(runId) as
        | {
            run_id: string;
            task_id: string | null;
            state: string | null;
            event_seq: number;
            commit_hash: string;
            updated_at: string;
          }
        | undefined;
    });

    if (!row) {
      return undefined;
    }

    return {
      runId: row.run_id,
      taskId: row.task_id ?? undefined,
      state: row.state ?? undefined,
      eventSeq: row.event_seq,
      commitHash: row.commit_hash,
      updatedAt: row.updated_at
    };
  }

  public getRun(runId: string): RunRecord | undefined {
    const row = this.withBusyRetry("getRun", () => {
      return this.db.prepare(`SELECT * FROM runs WHERE run_id=?`).get(runId) as
        | {
            run_id: string;
            objective: string;
            repo_path: string;
            baseline_commit: string;
            config_hash: string;
            state: string;
            created_at: string;
            updated_at: string;
            reason_code: string | null;
          }
        | undefined;
    });

    if (!row) {
      return undefined;
    }

    return {
      runId: row.run_id,
      objective: row.objective,
      repoPath: row.repo_path,
      baselineCommit: row.baseline_commit,
      configHash: row.config_hash,
      state: row.state as RunRecord["state"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reasonCode: (row.reason_code ?? undefined) as ReasonCode | undefined
    };
  }

  public listTasks(runId: string): TaskRecord[] {
    const rows = this.withBusyRetry("listTasks", () => {
      return this.db.prepare(`SELECT * FROM tasks WHERE run_id=? ORDER BY task_id`).all(runId) as Array<{
        run_id: string;
        task_id: string;
        provider: string;
        type: string;
        state: string;
        attempts: number;
        contract_hash: string;
        lease_token: number | null;
        commit_hash: string | null;
        reason_code: string | null;
      }>;
    });

    return rows.map((row) => ({
      runId: row.run_id,
      taskId: row.task_id,
      provider: row.provider as TaskRecord["provider"],
      type: row.type,
      state: row.state as TaskRecord["state"],
      attempts: row.attempts,
      contractHash: row.contract_hash,
      leaseToken: row.lease_token ?? undefined,
      commitHash: row.commit_hash ?? undefined,
      reasonCode: (row.reason_code ?? undefined) as ReasonCode | undefined
    }));
  }

  public close(): void {
    this.db.close();
  }

  private applyPragmas(): void {
    this.withBusyRetry("applyPragmas", () => {
      this.db.exec(`PRAGMA journal_mode = ${this.options.journalMode}`);
      this.db.exec(`PRAGMA synchronous = ${this.options.synchronous}`);
      this.db.exec(`PRAGMA busy_timeout = ${this.options.busyTimeoutMs}`);
    });
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      if (!isExpectedSchemaBackfillError(error)) {
        throw error;
      }
    }
  }

  private withBusyRetry<T>(operation: string, fn: () => T): T {
    let attempt = 0;
    while (true) {
      try {
        return fn();
      } catch (error) {
        const normalized = normalizeError(error);
        const busy = isSqliteBusyError(normalized);
        if (!busy || attempt >= this.options.busyRetryMax) {
          if (busy) {
            this.options.onBusyExhausted?.(operation, attempt, normalized);
          }
          throw error;
        }

        attempt += 1;
        this.options.onBusyRetry?.(operation, attempt, normalized);
        sleepSync(Math.min(250, 25 * attempt));
      }
    }
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    return [];
  }
  return [];
}

export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const {
    code,
    errcode,
    errstr,
    message
  } = error as {
    code?: unknown;
    errcode?: unknown;
    errstr?: unknown;
    message?: unknown;
  };

  if (typeof errcode === "number" && errcode === SQLITE_BUSY_ERRCODE) {
    return true;
  }

  if (typeof code === "string" && code.toUpperCase().includes("SQLITE_BUSY")) {
    return true;
  }

  return containsBusyText(errstr) || containsBusyText(message);
}

function containsBusyText(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes("sqlite_busy")
    || normalized.includes("database is locked")
    || normalized.includes("database table is locked")
  );
}

function isExpectedSchemaBackfillError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { message } = error as { message?: unknown };
  if (typeof message !== "string") {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes("duplicate column name") || normalized.includes("no such table");
}
