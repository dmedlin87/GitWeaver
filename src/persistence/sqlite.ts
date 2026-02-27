import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { RunRecord, TaskRecord } from "../core/types.js";
import type { ReasonCode } from "../core/reason-codes.js";

export class OrchestratorDb {
  private readonly db: DatabaseSync;
  private upsertTaskStmt: StatementSync | undefined;

  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
  }

  public migrate(): void {
    const bundledPath = fileURLToPath(new URL("./migrations/001_init.sql", import.meta.url));
    const sourceFallback = join(process.cwd(), "src", "persistence", "migrations", "001_init.sql");
    const migrationPath = existsSync(bundledPath) ? bundledPath : sourceFallback;
    const sql = readFileSync(migrationPath, "utf8");
    this.db.exec(sql);
  }

  public transaction<T>(fn: () => T): T {
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
  }

  public upsertRun(run: RunRecord): void {
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
  }

  public upsertTask(task: TaskRecord): void {
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
  }

  public recordTaskAttempt(runId: string, taskId: string, attempt: number, state: string, reasonCode?: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO task_attempts(run_id, task_id, attempt, state, reason_code, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`
      )
      .run(runId, taskId, attempt, state, reasonCode ?? null, new Date().toISOString());
  }

  public recordPromptEnvelope(
    runId: string,
    taskId: string,
    attempt: number,
    immutableSectionsHash: string,
    taskContractHash: string,
    contextPackHash: string
  ): void {
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
  }

  public getLatestPromptEnvelope(runId: string, taskId: string):
    | {
        attempt: number;
        immutableSectionsHash: string;
        taskContractHash: string;
        contextPackHash: string;
      }
    | undefined {
    const row = this.db
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
  }

  public upsertArtifactSignature(runId: string, artifactKey: string, signature: string, filePath?: string): void {
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
  }

  public listArtifactSignatures(runId: string, artifactKeys: string[]): Record<string, string> {
    if (artifactKeys.length === 0) {
      return {};
    }

    const uniqueKeys = [...new Set(artifactKeys)];
    const placeholders = uniqueKeys.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT artifact_key, signature FROM artifacts WHERE run_id=? AND artifact_key IN (${placeholders})`)
      .all(runId, ...uniqueKeys) as Array<{ artifact_key: string; signature: string }>;

    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.artifact_key] = row.signature;
      return acc;
    }, {});
  }

  public removeLeasesByTask(runId: string, taskId: string): void {
    this.db.prepare(`DELETE FROM leases WHERE run_id=? AND owner_task_id=?`).run(runId, taskId);
  }

  public listLeases(runId: string): Array<{
    runId: string;
    resourceKey: string;
    ownerTaskId: string;
    expiresAt: string;
    fencingToken: number;
  }> {
    const rows = this.db
      .prepare(`SELECT run_id, resource_key, owner_task_id, expires_at, fencing_token FROM leases WHERE run_id=? ORDER BY resource_key`)
      .all(runId) as Array<{
      run_id: string;
      resource_key: string;
      owner_task_id: string;
      expires_at: string;
      fencing_token: number;
    }>;

    return rows.map((row) => ({
      runId: row.run_id,
      resourceKey: row.resource_key,
      ownerTaskId: row.owner_task_id,
      expiresAt: row.expires_at,
      fencingToken: row.fencing_token
    }));
  }

  public recordGateResult(runId: string, taskId: string, command: string, exitCode: number, stdout: string, stderr: string): void {
    this.db
      .prepare(
        `INSERT INTO gate_results(run_id, task_id, command, exit_code, stdout, stderr, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`
      )
      .run(runId, taskId, command, exitCode, stdout, stderr, new Date().toISOString());
  }

  public recordRepairEvent(runId: string, taskId: string, failureClass: string, attempt: number, details: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO repair_events(run_id, task_id, failure_class, attempt, details, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`
      )
      .run(runId, taskId, failureClass, attempt, details, new Date().toISOString());
  }

  public getRun(runId: string): RunRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM runs WHERE run_id=?`).get(runId) as
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
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE run_id=? ORDER BY task_id`).all(runId) as Array<{
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
}
