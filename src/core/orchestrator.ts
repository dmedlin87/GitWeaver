import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, loadConfig, type RuntimeConfig } from "./config.js";
import { Logger } from "../observability/logger.js";
import { Metrics } from "../observability/metrics.js";
import { REASON_CODES, type ReasonCode } from "./reason-codes.js";
import { assertRunTransition } from "./state-machine.js";
import type { DagSpec, ProviderHealthSnapshot, ProviderId, RunRecord, TaskContract, TaskRecord } from "./types.js";
import { sha256, stableStringify } from "./hash.js";
import { runCommand } from "./shell.js";
import { runPreflight, type PreflightOptions } from "../providers/preflight.js";
import { generateDagWithCodex } from "../planning/planner-codex.js";
import { auditPlan } from "../planning/plan-audit.js";
import { freezePlan } from "../planning/plan-freeze.js";
import { routeTask } from "../providers/router.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { LockManager } from "../scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../scheduler/lease-heartbeat.js";
import { MergeQueue } from "../scheduler/merge-queue.js";
import { WorktreeManager } from "../execution/worktree-manager.js";
import { createSandboxHome, buildSandboxEnv } from "../execution/sandbox-env.js";
import { getProviderAdapter } from "../providers/adapters/index.js";
import { analyzeCommit, latestCommit } from "../verification/commit-analyzer.js";
import { evaluateScope } from "../verification/scope-policy.js";
import { verifyTaskOutput } from "../verification/output-verifier.js";
import { runGate } from "../verification/post-merge-gate.js";
import { detectStaleness, type ArtifactSignatureMap } from "../verification/staleness.js";
import { buildContextPack } from "../planning/context-pack.js";
import { buildPromptEnvelope } from "../planning/prompt-envelope.js";
import { classifyFailure, isNonRepairableExecutionFailure } from "../repair/failure-classifier.js";
import { RepairBudget } from "../repair/repair-budget.js";
import { buildRepairTask } from "../repair/repair-planner.js";
import { OrchestratorDb } from "../persistence/sqlite.js";
import { EventLog } from "../persistence/event-log.js";
import { writeRunManifest } from "../persistence/manifest.js";
import { reconcileResume } from "../persistence/resume-reconcile.js";

export interface RunCliOptions extends PreflightOptions {
  prompt: string;
  concurrency?: number;
  dryRun?: boolean;
  config?: string;
  repo?: string;
  allowBaselineRepair?: boolean;
  acceptDrift?: boolean;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ProgressUpdate {
  runId: string;
  ts: string;
  stage: string;
  message: string;
  state?: string;
  taskId?: string;
  provider?: ProviderId;
  attempt?: number;
  elapsedSec?: number;
}

export interface RunOutcome {
  runId: string;
  state: string;
  reasonCode?: ReasonCode;
  summary: Record<string, unknown>;
}

interface RuntimeContext {
  run: RunRecord;
  config: RuntimeConfig;
  runDir: string;
  db: OrchestratorDb;
  events: EventLog;
  onProgress?: (update: ProgressUpdate) => void;
}

export class Orchestrator {
  private readonly logger: Logger;
  private readonly metrics: Metrics;

  public constructor(debug = false) {
    this.logger = new Logger(debug);
    this.metrics = new Metrics();
  }

  public async run(options: RunCliOptions): Promise<RunOutcome> {
    const runId = randomUUID();
    const repoPath = await this.resolveRepo(options.repo);
    const config = loadConfig(options.config);
    const runDir = join(repoPath, ".orchestrator", "runs", runId);
    mkdirSync(runDir, { recursive: true });

    const db = new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"));
    db.migrate();

    const events = new EventLog(join(runDir, "events.ndjson"));

    const baselineCommit = await this.gitHead(repoPath);
    const now = new Date().toISOString();
    const run: RunRecord = {
      runId,
      objective: options.prompt,
      repoPath,
      baselineCommit,
      configHash: sha256(stableStringify(config)),
      state: "INGEST",
      createdAt: now,
      updatedAt: now
    };

    const ctx: RuntimeContext = {
      run,
      config,
      runDir,
      db,
      events,
      onProgress: options.onProgress
    };

    try {
      this.persistRun(ctx);
      this.progress(ctx, "run_started", "Run initialized");

      await this.preflightStageA(ctx, options);
      await this.ensureBaseline(ctx, options);
      const frozenDag = await this.plan(ctx, options);

      const providersInDag = [...new Set(frozenDag.nodes.map((node) => node.provider))] as ProviderId[];
      await this.preflightStageB(ctx, providersInDag, options);

      if (options.dryRun) {
        this.progress(ctx, "dry_run", "Dry run completed after planning");
        return this.completeRun(ctx, "COMPLETED", undefined, {
          dryRun: true,
          dag: frozenDag
        });
      }

      const taskRecords = frozenDag.nodes.map<TaskRecord>((node) => ({
        runId,
        taskId: node.taskId,
        provider: node.provider,
        type: node.type,
        state: "PENDING",
        attempts: 0,
        contractHash: node.contractHash
      }));

      for (const task of taskRecords) {
        db.upsertTask(task);
      }

      const outcome = await this.executeDag(ctx, frozenDag, taskRecords, options);
      return outcome;
    } catch (error) {
      const reasonCode = this.extractReasonCode(error);
      this.logger.error("Run failed", { runId, reasonCode, message: (error as Error).message });
      return this.completeRun(ctx, "ABORTED_POLICY", reasonCode, {
        error: (error as Error).message,
        metrics: this.metrics.snapshot()
      });
    } finally {
      db.close();
    }
  }

  public async resume(runId: string, acceptDrift: boolean): Promise<RunOutcome> {
    const repoPath = await this.resolveRepo(undefined);
    const db = new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"));
    db.migrate();
    const run = db.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    const events = new EventLog(join(repoPath, ".orchestrator", "runs", runId, "events.ndjson"));
    const decision = await reconcileResume({
      run,
      tasksFromDb: db.listTasks(runId),
      events: events.readAll()
    });

    if (decision.driftDetected && !acceptDrift) {
      throw this.errorWithCode("Main branch drift requires --accept-drift", REASON_CODES.RESUME_DRIFT_REQUIRES_ACCEPT);
    }

    return {
      runId,
      state: run.state,
      summary: {
        mergedTaskIds: decision.mergedTaskIds,
        requeueTaskIds: decision.requeueTaskIds,
        escalatedTaskIds: decision.escalatedTaskIds,
        reconcileReasons: decision.reasons
      }
    };
  }

  public async status(runId: string): Promise<Record<string, unknown>> {
    const repoPath = await this.resolveRepo(undefined);
    const db = new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"));
    db.migrate();

    const run = db.getRun(runId);
    const tasks = db.listTasks(runId);
    db.close();

    return {
      run,
      tasks
    };
  }

  public async inspect(runId: string, taskId?: string): Promise<Record<string, unknown>> {
    const repoPath = await this.resolveRepo(undefined);
    const eventPath = join(repoPath, ".orchestrator", "runs", runId, "events.ndjson");
    const events = new EventLog(eventPath).readAll();
    return {
      runId,
      events: taskId ? events.filter((event) => event.payload.taskId === taskId) : events
    };
  }

  public async locks(runId: string): Promise<Record<string, unknown>> {
    const repoPath = await this.resolveRepo(undefined);
    const db = new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"));
    db.migrate();
    const leases = db.listLeases(runId);
    db.close();
    return {
      runId,
      leases
    };
  }

  private async executeDag(
    ctx: RuntimeContext,
    dag: DagSpec,
    taskRecords: TaskRecord[],
    options: RunCliOptions
  ): Promise<RunOutcome> {
    this.transitionRun(ctx, "DISPATCHING");

    const scheduler = new Scheduler({
      ...ctx.config.providerBuckets,
      ...(options.concurrency ? this.limitBuckets(ctx.config.providerBuckets, options.concurrency) : {})
    });
    const lockManager = new LockManager(ctx.config.leaseDurationSec * 1000);
    const heartbeat = new LeaseHeartbeat(lockManager, ctx.config.leaseRenewSec * 1000);
    const mergeQueue = new MergeQueue();
    const worktree = new WorktreeManager();
    const repairBudget = new RepairBudget(ctx.config.maxRepairAttemptsPerClass);

    const taskById = new Map(dag.nodes.map((node) => [node.taskId, node]));
    const stateByTask = new Map(taskRecords.map((record) => [record.taskId, record]));

    const dependencyMap = this.buildDependencyMap(dag);
    const running = new Map<string, Promise<void>>();

    while (!this.allTerminal(stateByTask)) {
      for (const task of taskById.values()) {
        const record = stateByTask.get(task.taskId);
        if (!record || record.state !== "PENDING") {
          continue;
        }
        if (this.dependenciesMet(task, dependencyMap, stateByTask)) {
          record.state = "READY";
          ctx.db.upsertTask(record);
          ctx.events.append(ctx.run.runId, "TASK_READY", { taskId: task.taskId });
          this.progress(ctx, "task_ready", `Task ${task.taskId} is ready`, {
            taskId: task.taskId,
            provider: task.provider
          });
          scheduler.enqueue(task);
        }
      }

      while (running.size < (options.concurrency ?? ctx.config.concurrencyCap)) {
        const task = scheduler.tryDispatch();
        if (!task) {
          break;
        }

        const record = stateByTask.get(task.taskId);
        if (!record) {
          continue;
        }
        ctx.events.append(ctx.run.runId, "TASK_DISPATCHED", {
          taskId: task.taskId,
          provider: task.provider
        });
        this.progress(ctx, "task_dispatched", `Dispatching ${task.taskId} to ${task.provider}`, {
          taskId: task.taskId,
          provider: task.provider
        });

        const taskPromise = this.executeTask(
          ctx,
          task,
          record,
          lockManager,
          heartbeat,
          mergeQueue,
          worktree,
          repairBudget,
          stateByTask,
          taskById,
          dependencyMap
        )
          .catch((error) => {
            const reasonCode = this.extractReasonCode(error);
            record.state = "ESCALATED";
            record.reasonCode = reasonCode;
            ctx.db.upsertTask(record);
            ctx.events.append(ctx.run.runId, "TASK_ESCALATED", {
              taskId: task.taskId,
              reasonCode,
              message: (error as Error).message
            });
          })
          .finally(() => {
            scheduler.complete(task);
            running.delete(task.taskId);
          });

        running.set(task.taskId, taskPromise);
      }

      if (running.size === 0 && scheduler.pending() === 0) {
        const unresolved = [...stateByTask.values()].filter((taskRecord) => !this.isTerminalTaskState(taskRecord.state));
        if (unresolved.length > 0) {
          for (const unresolvedTask of unresolved) {
            unresolvedTask.state = "ESCALATED";
            unresolvedTask.reasonCode = REASON_CODES.ABORTED_POLICY;
            ctx.db.upsertTask(unresolvedTask);
            ctx.events.append(ctx.run.runId, "TASK_ESCALATED", {
              taskId: unresolvedTask.taskId,
              reasonCode: unresolvedTask.reasonCode,
              message: "No schedulable progress available"
            });
          }
        }
        break;
      }

      await Promise.race(running.values());
    }

    await Promise.all(running.values());

    const escalated = [...stateByTask.values()].filter((record) => record.state === "ESCALATED");
    if (escalated.length > 0) {
      const primary = escalated[0]!;
      return this.completeRun(ctx, "ABORTED_POLICY", primary.reasonCode ?? REASON_CODES.ABORTED_POLICY, {
        escalated: escalated.map((record) => ({ taskId: record.taskId, reasonCode: record.reasonCode }))
      });
    }

    this.transitionRun(ctx, "COMPLETED");
    return this.completeRun(ctx, "COMPLETED", undefined, {
      tasks: [...stateByTask.values()],
      metrics: this.metrics.snapshot()
    });
  }

  private async executeTask(
    ctx: RuntimeContext,
    task: TaskContract,
    record: TaskRecord,
    lockManager: LockManager,
    heartbeat: LeaseHeartbeat,
    mergeQueue: MergeQueue,
    worktreeManager: WorktreeManager,
    repairBudget: RepairBudget,
    stateByTask: Map<string, TaskRecord>,
    taskById: Map<string, TaskContract>,
    dependencyMap: Map<string, string[]>
  ): Promise<void> {
    record.attempts += 1;
    record.state = "LEASE_ACQUIRED";
    ctx.db.recordTaskAttempt(ctx.run.runId, task.taskId, record.attempts, record.state);
    ctx.events.append(ctx.run.runId, "TASK_ATTEMPT", { taskId: task.taskId, attempt: record.attempts });
    this.progress(ctx, "task_attempt", `Task ${task.taskId} attempt ${record.attempts} started`, {
      taskId: task.taskId,
      provider: task.provider,
      attempt: record.attempts
    });

    const resourceKeys = this.resourceKeys(task);
    const leases = lockManager.tryAcquireWrite(resourceKeys, task.taskId);
    if (!leases) {
      throw this.errorWithCode(`Unable to acquire lock lease for task ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
    }

    for (const lease of leases) {
      ctx.db.upsertLease(ctx.run.runId, lease.resourceKey, task.taskId, lease.expiresAt, lease.fencingToken);
    }
    heartbeat.start(task.taskId, leases);

    const baseCommit = await this.gitHead(ctx.run.repoPath);
    const worktree = await worktreeManager.create(ctx.run.repoPath, ctx.run.runId, task.taskId, baseCommit);

    try {
      record.state = "RUNNING";
      ctx.db.upsertTask(record);

      const contextPack = buildContextPack(worktree.path, task);
      const immutable = {
        task,
        contextPack,
        commandPolicy: task.commandPolicy
      };
      const envelope = buildPromptEnvelope({
        runId: ctx.run.runId,
        task,
        attempt: record.attempts,
        baselineCommit: baseCommit,
        contextPackHash: contextPack.contextPackHash,
        immutableSections: immutable
      });

      const prompt = this.composeExecutionPrompt(task, envelope, contextPack);
      const sandboxHome = createSandboxHome(ctx.run.runId, task.taskId, task.provider);
      const env = buildSandboxEnv(process.env, sandboxHome);

      const adapter = getProviderAdapter(task.provider);
      const providerStartedAt = Date.now();
      const heartbeatMs = 15_000;
      ctx.events.append(ctx.run.runId, "TASK_PROVIDER_START", {
        taskId: task.taskId,
        provider: task.provider,
        attempt: record.attempts
      });
      this.progress(ctx, "provider_start", `Invoking ${task.provider} for ${task.taskId}`, {
        taskId: task.taskId,
        provider: task.provider,
        attempt: record.attempts
      });

      const providerHeartbeat = setInterval(() => {
        const elapsedSec = Math.max(1, Math.floor((Date.now() - providerStartedAt) / 1000));
        ctx.events.append(ctx.run.runId, "TASK_PROVIDER_HEARTBEAT", {
          taskId: task.taskId,
          provider: task.provider,
          attempt: record.attempts,
          elapsedSec
        });
        this.progress(ctx, "provider_heartbeat", `Still waiting on ${task.provider} for ${task.taskId}`, {
          taskId: task.taskId,
          provider: task.provider,
          attempt: record.attempts,
          elapsedSec
        });
      }, heartbeatMs);

      let execution;
      try {
        execution = await adapter.execute({
          prompt,
          cwd: worktree.path,
          timeoutMs: ctx.config.heartbeatTimeoutSec * 1000
        });
      } finally {
        clearInterval(providerHeartbeat);
      }

      const providerElapsedSec = Math.max(1, Math.floor((Date.now() - providerStartedAt) / 1000));
      ctx.events.append(ctx.run.runId, "TASK_PROVIDER_FINISH", {
        taskId: task.taskId,
        provider: task.provider,
        attempt: record.attempts,
        elapsedSec: providerElapsedSec,
        exitCode: execution.exitCode
      });
      this.progress(ctx, "provider_finish", `${task.provider} finished ${task.taskId} with exit code ${execution.exitCode}`, {
        taskId: task.taskId,
        provider: task.provider,
        attempt: record.attempts,
        elapsedSec: providerElapsedSec
      });

      if (execution.exitCode !== 0) {
        throw this.errorWithCode(`Task ${task.taskId} execution failed: ${execution.stderr || execution.stdout}`, REASON_CODES.EXEC_FAILED);
      }

      const commitHash = await latestCommit(worktree.path);
      if (commitHash === baseCommit) {
        throw this.errorWithCode(`Task ${task.taskId} produced no commit`, REASON_CODES.NO_COMMIT_PRODUCED);
      }

      const analysis = await analyzeCommit(worktree.path, commitHash);
      const scope = evaluateScope(worktree.path, analysis.changedFiles, task.writeScope.allow, task.writeScope.deny);
      if (!scope.allowed) {
        throw this.errorWithCode(`Scope policy failed for ${task.taskId}: ${scope.violations.join("; ")}`, REASON_CODES.SCOPE_DENY);
      }

      record.state = "SCOPE_PASSED";
      record.commitHash = commitHash;
      ctx.db.upsertTask(record);

      await mergeQueue.enqueue(async () => {
        for (const lease of leases) {
          if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
            throw this.errorWithCode(`Fencing token invalid for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
          }
        }

        const stale = await detectStaleness(ctx.run.repoPath, baseCommit, task.artifactIO.consumes, {}, {} as ArtifactSignatureMap);
        if (stale.stale) {
          throw this.errorWithCode(`Task ${task.taskId} is stale: ${stale.reasons.join("; ")}`, REASON_CODES.STALE_TASK);
        }

        for (const lease of leases) {
          if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
            throw this.errorWithCode(`Fencing token expired before merge for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
          }
        }

        await this.integrateCommit(ctx, task, commitHash, leases[0]?.fencingToken ?? 0);

        const verify = verifyTaskOutput(ctx.run.repoPath, task);
        if (!verify.ok) {
          throw this.errorWithCode(`Output verification failed: ${verify.errors.join("; ")}`, REASON_CODES.VERIFY_FAIL_OUTPUT);
        }

        const gateCommand = task.verify.gateCommand || ctx.config.baselineGateCommand;
        const gate = await runGate(gateCommand, ctx.run.repoPath, (task.verify.gateTimeoutSec ?? 120) * 1000);
        ctx.db.recordGateResult(ctx.run.runId, task.taskId, gate.command, gate.exitCode, gate.stdout, gate.stderr);
        if (!gate.ok) {
          throw this.errorWithCode(`Post-merge gate failed for ${task.taskId}`, REASON_CODES.MERGE_GATE_FAILED);
        }
      });

      record.state = "VERIFIED";
      ctx.db.upsertTask(record);
      ctx.events.append(ctx.run.runId, "TASK_VERIFIED", { taskId: task.taskId, commitHash });
      this.progress(ctx, "task_verified", `Task ${task.taskId} verified`, {
        taskId: task.taskId,
        provider: task.provider
      });
    } catch (error) {
      const reasonCode = this.extractReasonCode(error);
      const errorText = (error as Error).message;
      this.progress(ctx, "task_error", `Task ${task.taskId} failed: ${errorText}`, {
        taskId: task.taskId,
        provider: task.provider
      });

      if (isNonRepairableExecutionFailure(errorText, reasonCode)) {
        ctx.db.recordRepairEvent(ctx.run.runId, task.taskId, "NON_REPAIRABLE_EXEC", 0, errorText);
        record.state = "ESCALATED";
        record.reasonCode = reasonCode;
        ctx.db.upsertTask(record);
        throw error;
      }

      const failureClass = classifyFailure(errorText, reasonCode);
      const attempt = repairBudget.increment(failureClass);
      ctx.db.recordRepairEvent(ctx.run.runId, task.taskId, failureClass, attempt, errorText);

      if (repairBudget.allowed(failureClass)) {
        const changedFiles = task.writeScope.allow;
        const repairTask = buildRepairTask({
          failedTask: task,
          changedFiles,
          errorFiles: changedFiles
        });
        taskById.set(repairTask.taskId, repairTask);
        dependencyMap.set(repairTask.taskId, [task.taskId]);
        stateByTask.set(repairTask.taskId, {
          runId: ctx.run.runId,
          taskId: repairTask.taskId,
          provider: repairTask.provider,
          type: repairTask.type,
          state: "PENDING",
          attempts: 0,
          contractHash: repairTask.contractHash
        });
        ctx.db.upsertTask(stateByTask.get(repairTask.taskId)!);
        ctx.events.append(ctx.run.runId, "TASK_REPAIR_ENQUEUED", {
          taskId: task.taskId,
          repairTaskId: repairTask.taskId,
          failureClass,
          attempt
        });

        record.state = "VERIFY_FAILED";
        record.reasonCode = reasonCode;
        ctx.db.upsertTask(record);
        return;
      }

      record.state = "ESCALATED";
      record.reasonCode = reasonCode;
      ctx.db.upsertTask(record);
      throw error;
    } finally {
      heartbeat.stopOwner(task.taskId);
      lockManager.releaseOwner(task.taskId);
      ctx.db.removeLeasesByTask(ctx.run.runId, task.taskId);
      await worktreeManager.remove(ctx.run.repoPath, worktree.path).catch(() => undefined);
    }
  }

  private async integrateCommit(ctx: RuntimeContext, task: TaskContract, commitHash: string, fencingToken: number): Promise<void> {
    this.transitionRun(ctx, "INTEGRATING");

    const pick = await runCommand("git", ["-C", ctx.run.repoPath, "cherry-pick", commitHash], { timeoutMs: 60_000 });
    if (pick.code !== 0) {
      await runCommand("git", ["-C", ctx.run.repoPath, "cherry-pick", "--abort"], { timeoutMs: 15_000 });
      throw this.errorWithCode(`Cherry-pick failed: ${pick.stderr}`, REASON_CODES.MERGE_CONFLICT);
    }

    const message = (await runCommand("git", ["-C", ctx.run.repoPath, "log", "-1", "--pretty=%B"], { timeoutMs: 10_000 })).stdout.trim();
    const footerLines = [
      `ORCH_RUN_ID=${ctx.run.runId}`,
      `ORCH_TASK_ID=${task.taskId}`,
      `ORCH_CONTRACT_HASH=${task.contractHash}`,
      `ORCH_FENCING_TOKEN=${fencingToken}`
    ];
    const amended = `${message}\n\n${footerLines.join("\n")}`;
    await runCommand("git", ["-C", ctx.run.repoPath, "commit", "--amend", "--file", "-"], {
      timeoutMs: 30_000,
      stdin: `${amended}\n`
    });

    this.transitionRun(ctx, "VERIFYING");
  }

  private async preflightStageA(ctx: RuntimeContext, options: RunCliOptions): Promise<void> {
    this.progress(ctx, "preflight_a_start", "Preflight stage A starting");
    const preflight = await runPreflight(["codex"], options);
    ctx.events.append(ctx.run.runId, "PREFLIGHT_STAGE_A", {
      statuses: preflight.statuses,
      installPlan: preflight.installPlan,
      reasonCodes: preflight.reasonCodes
    });
    this.progress(ctx, "preflight_a_done", "Preflight stage A completed");
    if (preflight.reasonCodes.length > 0) {
      throw this.errorWithCode("Preflight stage A failed", preflight.reasonCodes[0] ?? REASON_CODES.ABORTED_POLICY);
    }
  }

  private async preflightStageB(ctx: RuntimeContext, providers: ProviderId[], options: RunCliOptions): Promise<void> {
    this.progress(ctx, "preflight_b_start", `Preflight stage B starting for: ${providers.join(", ")}`);
    const preflight = await runPreflight(providers, options);
    ctx.events.append(ctx.run.runId, "PREFLIGHT_STAGE_B", {
      statuses: preflight.statuses,
      installPlan: preflight.installPlan,
      reasonCodes: preflight.reasonCodes
    });
    this.progress(ctx, "preflight_b_done", "Preflight stage B completed");

    const missingAuthProviders = preflight.statuses
      .filter((status) => status.authStatus === "MISSING")
      .map((status) => status.provider);
    if (missingAuthProviders.length > 0) {
      throw this.errorWithCode(
        `Preflight stage B failed: missing auth for providers ${missingAuthProviders.join(", ")}`,
        REASON_CODES.AUTH_MISSING
      );
    }

    if (preflight.reasonCodes.length > 0) {
      throw this.errorWithCode("Preflight stage B failed", preflight.reasonCodes[0] ?? REASON_CODES.ABORTED_POLICY);
    }
  }

  private async ensureBaseline(ctx: RuntimeContext, options: RunCliOptions): Promise<void> {
    this.progress(ctx, "baseline_start", "Checking repository baseline");
    const clean = await this.isRepoClean(ctx.run.repoPath);
    if (!clean) {
      throw this.errorWithCode("Repository is dirty at run start", REASON_CODES.BASELINE_DIRTY_REPO);
    }

    const gate = await runGate(ctx.config.baselineGateCommand, ctx.run.repoPath, 180_000);
    if (!gate.ok && !options.allowBaselineRepair) {
      throw this.errorWithCode("Baseline gate failed", REASON_CODES.BASELINE_GATE_FAILED);
    }

    this.transitionRun(ctx, "BASELINE_OK");
    ctx.events.append(ctx.run.runId, "BASELINE_OK", { command: gate.command, exitCode: gate.exitCode });
    this.progress(ctx, "baseline_done", "Baseline checks passed");
  }

  private async plan(ctx: RuntimeContext, options: RunCliOptions): Promise<DagSpec> {
    this.progress(ctx, "plan_start", "Generating and auditing DAG");
    const planned = options.dryRun
      ? this.mockDag(options.prompt)
      : (await generateDagWithCodex(options.prompt, ctx.run.repoPath)).dag;

    const healthSnapshots = this.defaultHealth();
    const routed: DagSpec = {
      ...planned,
      nodes: planned.nodes.map((node) => {
        const decision = routeTask(node.type, healthSnapshots);
        return {
          ...node,
          provider: decision.provider
        };
      })
    };

    const audited = auditPlan(routed);
    const frozen = freezePlan(audited.dag);

    this.transitionRun(ctx, "PLAN_FROZEN");

    writeFileSync(join(ctx.runDir, "plan.raw.json"), JSON.stringify(planned, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "plan.audited.json"), JSON.stringify(audited, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "plan.frozen.json"), JSON.stringify(frozen, null, 2), "utf8");

    writeRunManifest(join(ctx.runDir, "manifest.json"), {
      runId: ctx.run.runId,
      baselineCommit: ctx.run.baselineCommit,
      configHash: ctx.run.configHash,
      dagHash: frozen.dag.dagHash ?? "",
      plannerRawPath: join(ctx.runDir, "plan.raw.json"),
      providerVersions: {},
      createdAt: new Date().toISOString()
    });

    ctx.events.append(ctx.run.runId, "PLAN_FROZEN", {
      dagHash: frozen.dag.dagHash,
      findings: audited.findings,
      immutablePlanHash: frozen.immutablePlanHash
    });
    this.progress(ctx, "plan_done", `Plan frozen with ${frozen.dag.nodes.length} task(s)`);

    return frozen.dag;
  }

  private mockDag(prompt: string): DagSpec {
    const task: TaskContract = {
      taskId: "task-1",
      title: `Implement objective: ${prompt.slice(0, 80)}`,
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: {
        allow: ["src/**/*.ts", "tests/**/*.ts", "package.json"],
        deny: ["docs/**", ".orchestrator/**"],
        ownership: "exclusive"
      },
      commandPolicy: {
        allow: ["pnpm test", "pnpm typecheck", "git status", "git add", "git commit"],
        deny: DEFAULT_CONFIG.defaultCommandDeny,
        network: "deny"
      },
      expected: {},
      verify: {
        outputVerificationRequired: false
      },
      artifactIO: {},
      contractHash: ""
    };

    task.contractHash = sha256(stableStringify({ ...task, contractHash: undefined }));

    return {
      nodes: [task],
      edges: []
    };
  }

  private defaultHealth(): Partial<Record<ProviderId, ProviderHealthSnapshot>> {
    return {
      codex: { provider: "codex", score: 100, lastErrors: [], tokenBucket: 1 },
      claude: { provider: "claude", score: 100, lastErrors: [], tokenBucket: 2 },
      gemini: { provider: "gemini", score: 100, lastErrors: [], tokenBucket: 2 }
    };
  }

  private composeExecutionPrompt(task: TaskContract, envelope: ReturnType<typeof buildPromptEnvelope>, contextPack: ReturnType<typeof buildContextPack>): string {
    return [
      "You are executing a bounded task contract for orchestrated coding.",
      "Immutable contract:",
      JSON.stringify(task, null, 2),
      "Prompt envelope:",
      JSON.stringify(envelope, null, 2),
      "Context pack:",
      JSON.stringify(contextPack, null, 2),
      "Rules:",
      "- Only modify files in writeScope.allow and never touch deny paths.",
      "- Produce at least one git commit.",
      "- End with completion marker: __ORCH_DONE__: {\"status\":\"success\",\"files_changed\":[...],\"summary\":\"...\"}",
      "- Do not change objective or requirements."
    ].join("\n\n");
  }

  private resourceKeys(task: TaskContract): string[] {
    const fromAllow = task.writeScope.allow.map((file) => `file:${file}`);
    const shared = task.writeScope.sharedKey ? [`class:${task.writeScope.sharedKey}`] : [];
    return [...new Set([...fromAllow, ...shared])];
  }

  private buildDependencyMap(dag: DagSpec): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const node of dag.nodes) {
      map.set(node.taskId, [...node.dependencies]);
    }
    for (const edge of dag.edges) {
      map.set(edge.to, [...(map.get(edge.to) ?? []), edge.from]);
    }
    return map;
  }

  private dependenciesMet(task: TaskContract, deps: Map<string, string[]>, stateByTask: Map<string, TaskRecord>): boolean {
    const taskDeps = deps.get(task.taskId) ?? [];
    return taskDeps.every((dep) => {
      const depRecord = stateByTask.get(dep);
      if (!depRecord) {
        return false;
      }
      if (task.type === "repair") {
        return ["VERIFIED", "VERIFY_FAILED", "EXEC_FAILED", "SCOPE_FAILED", "STALE", "ESCALATED"].includes(depRecord.state);
      }
      return depRecord.state === "VERIFIED";
    });
  }

  private allTerminal(stateByTask: Map<string, TaskRecord>): boolean {
    for (const record of stateByTask.values()) {
      if (!this.isTerminalTaskState(record.state)) {
        return false;
      }
    }
    return true;
  }

  private isTerminalTaskState(state: TaskRecord["state"]): boolean {
    return ["VERIFIED", "ESCALATED", "VERIFY_FAILED"].includes(state);
  }

  private transitionRun(ctx: RuntimeContext, to: RunRecord["state"]): void {
    assertRunTransition(ctx.run.state, to);
    ctx.run.state = to;
    ctx.run.updatedAt = new Date().toISOString();
    this.persistRun(ctx);
    ctx.events.append(ctx.run.runId, "RUN_STATE", {
      state: to
    });
    this.progress(ctx, "run_state", `Run state changed to ${to}`, { state: to });
  }

  private persistRun(ctx: RuntimeContext): void {
    ctx.db.upsertRun(ctx.run);
  }

  private completeRun(
    ctx: RuntimeContext,
    state: RunRecord["state"],
    reasonCode: ReasonCode | undefined,
    summary: Record<string, unknown>
  ): RunOutcome {
    if (ctx.run.state !== state) {
      if (ctx.run.state === "COMPLETED" || ctx.run.state.startsWith("ABORTED")) {
        // terminal already set
      } else {
        assertRunTransition(ctx.run.state, state);
        ctx.run.state = state;
      }
    }

    ctx.run.reasonCode = reasonCode;
    ctx.run.updatedAt = new Date().toISOString();
    this.persistRun(ctx);
    ctx.events.append(ctx.run.runId, "RUN_COMPLETE", {
      state,
      reasonCode,
      summary
    });
    this.progress(ctx, "run_complete", `Run completed with state ${state}`, { state });

    return {
      runId: ctx.run.runId,
      state,
      reasonCode,
      summary
    };
  }

  private async resolveRepo(inputRepo?: string): Promise<string> {
    const cwd = inputRepo ? resolve(inputRepo) : process.cwd();
    const result = await runCommand("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeoutMs: 10_000 });
    if (result.code !== 0) {
      throw this.errorWithCode(`Not a git repository: ${cwd}`, REASON_CODES.REPO_NOT_GIT);
    }
    return result.stdout.trim();
  }

  private async isRepoClean(repoPath: string): Promise<boolean> {
    const result = await runCommand("git", ["-C", repoPath, "status", "--porcelain"], { timeoutMs: 10_000 });
    return result.code === 0 && result.stdout.trim().length === 0;
  }

  private async gitHead(repoPath: string): Promise<string> {
    const head = await runCommand("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeoutMs: 10_000 });
    if (head.code !== 0) {
      throw new Error(head.stderr || "Failed to resolve HEAD");
    }
    return head.stdout.trim();
  }

  private limitBuckets(buckets: RuntimeConfig["providerBuckets"], concurrency: number): RuntimeConfig["providerBuckets"] {
    if (concurrency <= 0) {
      return buckets;
    }

    const limited = { ...buckets };
    let total = limited.codex + limited.claude + limited.gemini;
    while (total > concurrency) {
      if (limited.gemini > 1) {
        limited.gemini -= 1;
      } else if (limited.claude > 1) {
        limited.claude -= 1;
      } else if (limited.codex > 1) {
        limited.codex -= 1;
      } else {
        break;
      }
      total = limited.codex + limited.claude + limited.gemini;
    }

    return limited;
  }

  private errorWithCode(message: string, reasonCode: ReasonCode): Error {
    const error = new Error(message) as Error & { reasonCode?: ReasonCode };
    error.reasonCode = reasonCode;
    return error;
  }

  private extractReasonCode(error: unknown): ReasonCode {
    const reasonCode = (error as { reasonCode?: ReasonCode }).reasonCode;
    return reasonCode ?? REASON_CODES.ABORTED_POLICY;
  }

  private progress(
    ctx: RuntimeContext,
    stage: string,
    message: string,
    details: Omit<ProgressUpdate, "runId" | "ts" | "stage" | "message"> = {}
  ): void {
    if (!ctx.onProgress) {
      return;
    }
    ctx.onProgress({
      runId: ctx.run.runId,
      ts: new Date().toISOString(),
      stage,
      message,
      ...details
    });
  }
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${formatJson(value)}\n`);
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
