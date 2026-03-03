import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, loadConfig, type RuntimeConfig } from "./config.js";
import { Logger } from "../observability/logger.js";
import { Metrics } from "../observability/metrics.js";
import { REASON_CODES, type ReasonCode } from "./reason-codes.js";
import { assertRunTransition } from "./state-machine.js";
import type { DagSpec, LockLease, ProviderHealthSnapshot, ProviderId, ProviderStatus, RoutingDecision, RunRecord, TaskContract, TaskRecord } from "./types.js";
import { sha256, stableStringify } from "./hash.js";
import { runCommand } from "./shell.js";
import { runPreflight, type PreflightOptions } from "../providers/preflight.js";
import { generateDagWithCodex } from "../planning/planner-codex.js";
import { condenseHistory } from "../planning/condenser-gemini.js";
import { auditPlan } from "../planning/plan-audit.js";
import { freezePlan } from "../planning/plan-freeze.js";
import { rerouteOnDegradation, routeExecutionFallback, routeTask } from "../providers/router.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { LockManager } from "../scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../scheduler/lease-heartbeat.js";
import { MergeQueue } from "../scheduler/merge-queue.js";
import { WorktreeManager } from "../execution/worktree-manager.js";
import { createSandboxHome, buildSandboxEnv } from "../execution/sandbox-env.js";
import { getProviderAdapter } from "../providers/adapters/index.js";
import { analyzeCommit, latestCommit } from "../verification/commit-analyzer.js";
import { evaluateScope } from "../verification/scope-policy.js";
import { extractFilesFromError } from "../verification/error-extractor.js";
import { verifyTaskOutput } from "../verification/output-verifier.js";
import { runGate } from "../verification/post-merge-gate.js";
import { artifactKey, collectArtifactSignatures, detectStaleness, type ArtifactSignatureMap } from "../verification/staleness.js";
import { buildContextPack } from "../planning/context-pack.js";
import { assertPromptDrift, buildPromptEnvelope } from "../planning/prompt-envelope.js";
import { parseCompletionMarker } from "../execution/completion-parser.js";
import { classifyFailure, isNonRepairableExecutionFailure } from "../repair/failure-classifier.js";
import { RepairBudget } from "../repair/repair-budget.js";
import { buildRepairTask } from "../repair/repair-planner.js";
import { OrchestratorDb, isSqliteBusyError } from "../persistence/sqlite.js";
import { EventLog } from "../persistence/event-log.js";
import { writeRunManifest, type RunManifest } from "../persistence/manifest.js";
import { reconcileResume } from "../persistence/resume-reconcile.js";
import { validateCommand } from "../verification/command-policy.js";
import { ProviderHealthManager } from "../providers/health-manager.js";
import { createSecureExecutor } from "../secure/factory.js";
import type { SecureExecutor } from "../secure/secure-executor.js";

export interface RunCliOptions extends PreflightOptions {
  prompt: string;
  concurrency?: number;
  dryRun?: boolean;
  dryRunReport?: "basic" | "detailed";
  config?: string;
  repo?: string;
  allowBaselineRepair?: boolean;
  acceptDrift?: boolean;
  executionMode?: "host" | "container";
  containerRuntime?: "docker" | "podman";
  containerImage?: string;
  plannerProvider?: ProviderId;
  forceModel?: ProviderId;
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
  secureExecutor: SecureExecutor;
  providerHealth: ProviderHealthManager;
  providerVersions: Record<string, string | undefined>;
  routeDecisions: TaskRoutingDecision[];
  onProgress?: (update: ProgressUpdate) => void;
}

interface TaskRoutingDecision {
  taskId: string;
  taskType: TaskContract["type"];
  plannedProvider: ProviderId;
  routedProvider: ProviderId;
  routingReason: string;
  fallbackProvider?: ProviderId;
  fallbackReason?: string;
}

interface ProviderExecutionAttempt {
  provider: ProviderId;
  mode: "primary" | "fallback";
  reason: string;
}

interface BaselineGateResult {
  command: string;
  exitCode: number;
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
    const loadedConfig = loadConfig(options.config);
    const config: RuntimeConfig = {
      ...loadedConfig,
      executionMode: options.executionMode ?? loadedConfig.executionMode,
      containerRuntime: options.containerRuntime ?? loadedConfig.containerRuntime,
      containerImage: options.containerImage ?? loadedConfig.containerImage
    };
    const secureExecutor = createSecureExecutor(config.executionMode);
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
    let db: OrchestratorDb | undefined;
    let ctx: RuntimeContext | undefined;

    try {
      this.emitProgress(runId, options.onProgress, "run_started", "Run initialized");
      const baselineGate = await this.checkBaseline(runId, repoPath, config, secureExecutor, options);

      const runDir = join(repoPath, ".orchestrator", "runs", runId);
      mkdirSync(runDir, { recursive: true });

      db = new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"), {
        journalMode: config.sqliteJournalMode,
        synchronous: config.sqliteSynchronous,
        busyTimeoutMs: config.sqliteBusyTimeoutMs,
        busyRetryMax: config.sqliteBusyRetryMax,
        onBusyRetry: (operation, attempt, error) => {
          this.metrics.inc("sqlite.busy_retry");
          this.logger.info("SQLite busy retry", { runId, operation, attempt, message: error.message });
        },
        onBusyExhausted: (operation, attempts, error) => {
          this.metrics.inc("sqlite.busy_exhausted");
          this.logger.error("SQLite busy exhausted", { runId, operation, attempts, message: error.message });
        }
      });
      await db.migrate();

      const events = new EventLog(join(runDir, "events.ndjson"));
      const initialHealth = await db.listProviderHealth(runId);
      const providerHealth = new ProviderHealthManager({
        buckets: config.providerBuckets,
        baseBackoffSec: config.providerBackoffBaseSec,
        maxBackoffSec: config.providerBackoffMaxSec,
        recoverPerSuccess: config.providerHealthRecoverPerSuccess,
        initial: this.indexProviderHealth(initialHealth)
      });
      ctx = {
        run,
        config,
        runDir,
        db,
        events,
        secureExecutor,
        providerHealth,
        providerVersions: {},
        routeDecisions: [],
        onProgress: options.onProgress
      };
      const runtimeCtx = ctx;

      await this.persistRun(runtimeCtx);
      await this.recordBaselineOk(runtimeCtx, baselineGate);

      await this.preflightStageA(runtimeCtx, options);
      const frozenDag = await this.plan(runtimeCtx, options);
      this.writeManifest(runtimeCtx, frozenDag);

      const providersInDag = [...new Set(frozenDag.nodes.map((node) => node.provider))] as ProviderId[];
      await this.preflightStageB(runtimeCtx, providersInDag, options);
      this.writeManifest(runtimeCtx, frozenDag);

      if (options.dryRun) {
        this.progress(runtimeCtx, "dry_run", "Dry run completed after planning");
        const detailed = options.dryRunReport !== "basic";
        return await this.completeRun(runtimeCtx, "COMPLETED", undefined, {
          dryRun: true,
          dag: frozenDag,
          routeDecisions: detailed ? runtimeCtx.routeDecisions : undefined,
          estimatedCost: detailed ? this.estimateDryRunCost(frozenDag) : undefined
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

      // ⚡ Bolt: Wrap initial task insertion in a transaction
      // 💡 What: Grouping multiple task inserts into a single SQLite transaction.
      // 🎯 Why: SQLite requires a separate disk sync for each implicit transaction when auto-commit is on.
      // 📊 Impact: Reduces I/O overhead from O(N) fsyncs to O(1), making DAG initialization significantly faster.
      await runtimeCtx.db.transaction(async () => {
        for (const task of taskRecords) {
          await runtimeCtx.db.upsertTask(task);
        }
      });

      const outcome = await this.executeDag(runtimeCtx, frozenDag, taskRecords, options);
      return outcome;
    } catch (error) {
      const reasonCode = this.extractReasonCode(error);
      this.logger.error("Run failed", { runId, reasonCode, message: (error as Error).message });
      if (ctx) {
        return await this.completeRun(ctx, "ABORTED_POLICY", reasonCode, {
          error: (error as Error).message,
          metrics: this.metrics.snapshot()
        });
      }
      return {
        runId,
        state: "ABORTED_POLICY",
        reasonCode,
        summary: {
          error: (error as Error).message,
          metrics: this.metrics.snapshot()
        }
      };
    } finally {
      db?.close();
    }
  }

  public async resume(runId: string, acceptDrift: boolean): Promise<RunOutcome> {
    const repoPath = await this.resolveRepo(undefined);
    const db = this.openDb(repoPath);
    await db.migrate();
    try {
      const run = await db.getRun(runId);
      if (!run) {
        throw new Error(`Run ${runId} not found`);
      }

      const events = new EventLog(join(repoPath, ".orchestrator", "runs", runId, "events.ndjson"));
      const decision = await reconcileResume({
        run,
        tasksFromDb: await db.listTasks(runId),
        events: events.readAll()
      });
      const checkpoint = await db.getResumeCheckpoint(runId);
      if (
        checkpoint?.taskId &&
        checkpoint.state === "MERGE_QUEUED" &&
        !decision.mergedTaskIds.includes(checkpoint.taskId) &&
        !decision.escalatedTaskIds.includes(checkpoint.taskId) &&
        !decision.requeueTaskIds.includes(checkpoint.taskId)
      ) {
        decision.requeueTaskIds.push(checkpoint.taskId);
        decision.reasons[checkpoint.taskId] = REASON_CODES.RESUME_MERGE_IN_FLIGHT;
      }
      decision.requeueTaskIds.sort();

      if (decision.driftDetected) {
        events.append(runId, "DRIFT_DETECTED", {
          driftCommits: decision.driftCommits
        });
      }

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
          driftDetected: decision.driftDetected,
          driftCommits: decision.driftCommits,
          reconcileReasons: decision.reasons,
          resumeCheckpoint: checkpoint
        }
      };
    } finally {
      db.close();
    }
  }

  public async status(runId: string): Promise<Record<string, unknown>> {
    const repoPath = await this.resolveRepo(undefined);
    const db = this.openDb(repoPath);
    await db.migrate();

    const run = await db.getRun(runId);
    const tasks = await db.listTasks(runId);
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
    const db = this.openDb(repoPath);
    await db.migrate();
    const leases = await db.listLeases(runId);
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
    await this.transitionRun(ctx, "DISPATCHING");

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
      const readyTasks: TaskRecord[] = [];
      for (const task of taskById.values()) {
        const record = stateByTask.get(task.taskId);
        if (!record || record.state !== "PENDING") {
          continue;
        }
        if (this.dependenciesMet(task, dependencyMap, stateByTask)) {
          record.state = "READY";
          readyTasks.push(record);
          ctx.events.append(ctx.run.runId, "TASK_READY", { taskId: task.taskId });
          this.progress(ctx, "task_ready", `Task ${task.taskId} is ready`, {
            taskId: task.taskId,
            provider: task.provider
          });
          scheduler.enqueue(task);
        }
      }

      if (readyTasks.length > 0) {
        await ctx.db.transaction(async () => {
          for (const task of readyTasks) {
            await ctx.db.upsertTask(task);
          }
        });
      }

      while (running.size < (options.concurrency ?? ctx.config.concurrencyCap)) {
        const task = scheduler.tryDispatch(
          (candidate) => ctx.providerHealth.canDispatch(candidate.provider),
          (candidate) => {
            const decision = rerouteOnDegradation(candidate, ctx.providerHealth.snapshotAll());
            if (!decision || decision.provider === candidate.provider) {
              return null;
            }
            return { ...candidate, provider: decision.provider };
          }
        );
        if (!task) {
          break;
        }

        const record = stateByTask.get(task.taskId);
        if (!record) {
          continue;
        }
        if (task.reroutedFrom) {
          ctx.events.append(ctx.run.runId, "TASK_REROUTED", {
            taskId: task.taskId,
            fromProvider: task.reroutedFrom,
            toProvider: task.provider
          });
          this.metrics.inc("scheduler.task_rerouted");
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
          .catch(async (error) => {
            const reasonCode = this.extractReasonCode(error);
            if (reasonCode === REASON_CODES.REPLAN_REQUESTED) {
              const evidence = (error as any).evidence;
              ctx.run.state = "REPLANNING";
              ctx.run.replanEvidence = evidence;
              await this.persistRun(ctx);

              ctx.events.append(ctx.run.runId, "REPLAN_REQUESTED", {
                taskId: task.taskId,
                summary: evidence.summary,
                research: evidence.research
              });

              this.progress(ctx, "replan_requested", `Task ${task.taskId} requested replan: ${evidence.summary}`, {
                taskId: task.taskId
              });

              // Pause new dispatches while we replan
              // In this simplified implementation, we just need the loop to see PLANNING state.
              return;
            }

            record.state = "ESCALATED";
            record.reasonCode = reasonCode;
            await ctx.db.upsertTask(record);
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

      if (ctx.run.state === "REPLANNING") {
        await Promise.all(running.values());
        
        const completedSummaries = [...stateByTask.values()]
          .filter(t => t.state === "VERIFIED")
          .map(t => `${t.taskId}: ${t.summary}`);

        const pendingTaskIds = scheduler.listPending();
        const pendingContracts = pendingTaskIds
          .map(id => taskById.get(id))
          .filter((t): t is TaskContract => !!t);

        const replanObjective = [
          `Original Objective: ${ctx.run.objective}`,
          `Progress so far:\n${completedSummaries.join("\n")}`,
          `REPLAN REQUESTED by agent.`,
          `Request Summary: ${ctx.run.replanEvidence?.summary}`,
          `Agent Research:\n${ctx.run.replanEvidence?.research || "N/A"}`
        ].join("\n\n");

        const deltaResult = await generateDagWithCodex(replanObjective, ctx.run.repoPath, pendingContracts, {
          plannerProvider: options.plannerProvider
        });
        const planned = deltaResult.dag;

        // Apply routing and audit to the new tasks
        const healthSnapshots = ctx.providerHealth.snapshotAll();
        const routed: DagSpec = {
          ...planned,
          nodes: planned.nodes.map((node) => {
            const decision = routeTask(node.type, healthSnapshots);
            // We don't necessarily update ctx.routeDecisions here as it's a delta,
            // but we ensure providers are assigned correctly.
            return {
              ...node,
              provider: options.forceModel ?? decision.provider
            };
          })
        };

        const audited = auditPlan(routed);
        const deltaDag = audited.dag;
        
        const newNodeIds = new Set(deltaDag.nodes.map(n => n.taskId));

        // 1. Cancel pending tasks that are NOT in the new DAG
        for (const pendingId of pendingTaskIds) {
          if (!newNodeIds.has(pendingId)) {
            const record = stateByTask.get(pendingId);
            if (record) {
              record.state = "ESCALATED";
              record.reasonCode = REASON_CODES.STALE_REPLAN_TRIGGERED;
              await ctx.db.upsertTask(record);
              ctx.events.append(ctx.run.runId, "TASK_CANCELLED", {
                taskId: pendingId,
                reasonCode: record.reasonCode
              });
            }
            scheduler.cancel(pendingId);
          }
        }

        // 2. Add or Update tasks from the new DAG
        for (const newNode of deltaDag.nodes) {
          const isNew = !taskById.has(newNode.taskId);
          taskById.set(newNode.taskId, newNode);
          
          if (isNew) {
            const newRecord: TaskRecord = {
              runId: ctx.run.runId,
              taskId: newNode.taskId,
              provider: newNode.provider,
              type: newNode.type,
              state: "PENDING",
              attempts: 0,
              contractHash: newNode.contractHash
            };
            stateByTask.set(newNode.taskId, newRecord);
            await ctx.db.upsertTask(newRecord);
            scheduler.add(newNode);
          } else {
            // Task already existed.
            const record = stateByTask.get(newNode.taskId);
            
            // If it wasn't terminal (e.g. it was the task that requested replan, 
            // or it was READY/RUNNING when replan started), reset it to PENDING 
            // so the scheduler can re-evaluate its dependencies.
            if (record && !this.isTerminalTaskState(record.state)) {
              record.state = "PENDING";
              await ctx.db.upsertTask(record);
              
              // If it's already in the scheduler queue, update its contract.
              // Otherwise, add it back to the queue.
              if (scheduler.listPending().includes(newNode.taskId)) {
                scheduler.updateContract(newNode);
              } else {
                scheduler.add(newNode);
              }
            } else {
              // If it was terminal (VERIFIED), just update the contract stored in taskById 
              // (already done above) but don't re-schedule.
              // If it was already in scheduler (shouldn't happen if terminal), update it.
              scheduler.updateContract(newNode);
            }
          }
          
          const deps = newNode.dependencies ?? [];
          dependencyMap.set(newNode.taskId, deps);
        }

        ctx.run.state = "DISPATCHING";
        ctx.run.replanEvidence = undefined;
        await this.persistRun(ctx);
        continue;
      }

      if (running.size === 0 && scheduler.pending() === 0) {
        const unresolved = [...stateByTask.values()].filter((taskRecord) => !this.isTerminalTaskState(taskRecord.state));
        if (unresolved.length > 0) {
          // ⚡ Bolt: Wrap unresolved task escalation in a transaction
          // 💡 What: Grouping multiple task updates into a single SQLite transaction.
          // 🎯 Why: SQLite requires a separate disk sync for each implicit transaction when auto-commit is on.
          // 📊 Impact: Reduces I/O overhead from O(N) fsyncs to O(1), making run finalization significantly faster.
          await ctx.db.transaction(async () => {
            for (const unresolvedTask of unresolved) {
              unresolvedTask.state = "ESCALATED";
              unresolvedTask.reasonCode = REASON_CODES.ABORTED_POLICY;
              await ctx.db.upsertTask(unresolvedTask);
              ctx.events.append(ctx.run.runId, "TASK_ESCALATED", {
                taskId: unresolvedTask.taskId,
                reasonCode: unresolvedTask.reasonCode,
                message: "No schedulable progress available"
              });
            }
          });
        }
        break;
      }

      if (running.size === 0 && scheduler.pending() > 0) {
        await this.waitMs(250);
        continue;
      }

      await Promise.race(running.values());
    }

    await Promise.all(running.values());

    const escalated = [...stateByTask.values()].filter((record) => record.state === "ESCALATED");
    if (escalated.length > 0) {
      const primary = escalated[0]!;
      return await this.completeRun(ctx, "ABORTED_POLICY", primary.reasonCode ?? REASON_CODES.ABORTED_POLICY, {
        escalated: escalated.map((record) => ({ taskId: record.taskId, reasonCode: record.reasonCode }))
      });
    }

    await this.transitionRun(ctx, "COMPLETED");
    return await this.completeRun(ctx, "COMPLETED", undefined, {
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
    await ctx.db.recordTaskAttempt(ctx.run.runId, task.taskId, record.attempts, record.state);
    ctx.events.append(ctx.run.runId, "TASK_ATTEMPT", { taskId: task.taskId, attempt: record.attempts });
    this.progress(ctx, "task_attempt", `Task ${task.taskId} attempt ${record.attempts} started`, {
      taskId: task.taskId,
      provider: task.provider,
      attempt: record.attempts
    });

    const resourceKeys = this.resourceKeys(task);
    const leases = await this.acquireWriteLeasesWithRetry(ctx, lockManager, resourceKeys, task.taskId);

    for (const lease of leases) {
      await ctx.db.upsertLease(ctx.run.runId, lease.resourceKey, task.taskId, lease.expiresAt, lease.fencingToken);
    }
    heartbeat.start(task.taskId, leases);

    const baseCommit = await this.gitHead(ctx.run.repoPath);
    const worktree = await worktreeManager.create(ctx.run.repoPath, ctx.run.runId, task.taskId, baseCommit);
    await this.injectWorktreeMemory(ctx, worktree.path, task, stateByTask);
    const consumedArtifacts = task.artifactIO.consumes ?? [];
    const consumedArtifactKeys = consumedArtifacts.map((artifact) => artifactKey(ctx.run.repoPath, artifact));
    const registrySignatures = await ctx.db.listArtifactSignatures(ctx.run.runId, consumedArtifactKeys);
    const worktreeSignatures = collectArtifactSignatures(worktree.path, consumedArtifacts);
    const priorSignatures: ArtifactSignatureMap = {
      ...worktreeSignatures,
      ...registrySignatures
    };

    try {
      record.state = "RUNNING";
      await ctx.db.upsertTask(record);

      const contextPack = buildContextPack(worktree.path, task);
      const immutable = {
        task,
        contextPack,
        commandPolicy: task.commandPolicy
      };

      let failureEvidence: string[] | undefined;
      const targetTaskId = task.type === "repair" && task.dependencies[0] ? task.dependencies[0] : task.taskId;
      const repairEvents = await ctx.db.listRepairEvents(ctx.run.runId, targetTaskId);
      if (repairEvents.length > 0) {
        failureEvidence = repairEvents.map((e) => `[Attempt ${e.attempt} - ${e.failureClass}]: ${e.details}`);
      }

      const envelope = buildPromptEnvelope({
        runId: ctx.run.runId,
        task,
        attempt: record.attempts,
        baselineCommit: baseCommit,
        contextPackHash: contextPack.contextPackHash,
        immutableSections: immutable,
        failureEvidence
      });

      const previousEnvelope = await ctx.db.getLatestPromptEnvelope(ctx.run.runId, task.taskId);
      if (previousEnvelope) {
        const previous = {
          ...envelope,
          immutableSectionsHash: previousEnvelope.immutableSectionsHash,
          taskContractHash: previousEnvelope.taskContractHash,
          contextPackHash: previousEnvelope.contextPackHash
        };
        try {
          assertPromptDrift(previous, envelope);
        } catch (error) {
          throw this.errorWithCode((error as Error).message, REASON_CODES.PROMPT_DRIFT);
        }
      }

      await ctx.db.recordPromptEnvelope(
        ctx.run.runId,
        task.taskId,
        record.attempts,
        envelope.immutableSectionsHash,
        envelope.taskContractHash,
        envelope.contextPackHash
      );
      ctx.events.append(ctx.run.runId, "TASK_PROMPT_ENVELOPE", {
        taskId: task.taskId,
        attempt: record.attempts,
        immutableSectionsHash: envelope.immutableSectionsHash,
        taskContractHash: envelope.taskContractHash,
        contextPackHash: envelope.contextPackHash
      });

      const dependenciesState: Record<string, unknown> = {};
      for (const depId of task.dependencies) {
        const depTask = taskById.get(depId);
        const depRecord = stateByTask.get(depId);
        if (depTask && depRecord) {
          dependenciesState[depId] = {
            title: depTask.title,
            state: depRecord.state,
            commitHash: depRecord.commitHash
          };
        }
      }

      const prompt = this.composeExecutionPrompt(ctx.run.objective, task, envelope, contextPack, dependenciesState);
      const secureBaseEnv = ctx.secureExecutor.prepareEnvironment(process.env);
      const executionPlan: ProviderExecutionAttempt[] = [
        {
          provider: task.provider,
          mode: "primary",
          reason: "task-assigned provider"
        }
      ];

      let execution: { exitCode: number; stdout: string; stderr: string; rawOutput?: string } | undefined;
      let providerFailurePersisted = false;
      let finalProvider = task.provider;
      while (executionPlan.length > 0) {
        const attemptProvider = executionPlan.shift()!;
        finalProvider = attemptProvider.provider;
        try {
          execution = await this.runProviderAttempt(ctx, task, record, worktree.path, prompt, secureBaseEnv, attemptProvider);
        } catch (error) {
          execution = {
            exitCode: 1,
            stdout: "",
            stderr: (error as Error).message
          };
        }

        if (execution.exitCode === 0) {
          await this.persistProviderHealth(ctx, ctx.providerHealth.onSuccess(finalProvider));
          break;
        }

        const failureText = execution.stderr || execution.stdout || "provider execution failed";
        await this.persistProviderHealth(ctx, ctx.providerHealth.onFailure(finalProvider, failureText));
        providerFailurePersisted = true;

        if (!this.eligibleForExecutionFallback(failureText)) {
          break;
        }

        const fallbackDecision = routeExecutionFallback(finalProvider, ctx.providerHealth.snapshotAll(), "provider-specific execution failure signature");
        if (!fallbackDecision || fallbackDecision.provider === finalProvider) {
          break;
        }

        await ctx.db.recordTaskRoutingDecision(
          ctx.run.runId,
          task.taskId,
          record.attempts,
          finalProvider,
          fallbackDecision.provider,
          fallbackDecision.fallbackReason ?? fallbackDecision.routingReason
        );
        ctx.events.append(ctx.run.runId, "TASK_EXECUTION_FALLBACK_ROUTED", {
          taskId: task.taskId,
          attempt: record.attempts,
          fromProvider: finalProvider,
          toProvider: fallbackDecision.provider,
          reason: fallbackDecision.fallbackReason ?? fallbackDecision.routingReason
        });
        executionPlan.push({
          provider: fallbackDecision.provider,
          mode: "fallback",
          reason: fallbackDecision.fallbackReason ?? fallbackDecision.routingReason
        });
      }

      task.provider = finalProvider;
      record.provider = finalProvider;

      if (!execution) {
        throw this.errorWithCode(`Task ${task.taskId} execution failed: no provider execution output`, REASON_CODES.EXEC_FAILED);
      }

      if (ctx.config.forensicRawLogs && execution.rawOutput) {
        const forensicPath = this.persistForensicOutput(ctx, task.taskId, record.attempts, execution.rawOutput);
        ctx.events.append(ctx.run.runId, "TASK_FORENSIC_RAW_CAPTURED", {
          taskId: task.taskId,
          attempt: record.attempts,
          path: forensicPath
        });
      }

      if (execution.exitCode !== 0) {
        const err = this.errorWithCode(`Task ${task.taskId} execution failed: ${execution.stderr || execution.stdout}`, REASON_CODES.EXEC_FAILED);
        (err as any).providerFailurePersisted = providerFailurePersisted;
        throw err;
      }

      const marker = parseCompletionMarker(execution.stdout);
      if (marker) {
        record.summary = marker.summary;
        record.research = marker.research;

        if (marker.status === "replan") {
          const replanErr = this.errorWithCode(`Agent requested replan: ${marker.summary}`, REASON_CODES.REPLAN_REQUESTED);
          (replanErr as any).evidence = { summary: marker.summary, research: marker.research };
          throw replanErr;
        }

        // Tier 3: Extract and save Axioms
        if (marker.research) {
          const axiomRegex = /\[AXIOM\]\s*([^[]*)/gi;
          let match;
          while ((match = axiomRegex.exec(marker.research)) !== null) {
            const content = match[1]?.trim();
            if (content) {
              await ctx.db.upsertAxiom({
                runId: ctx.run.runId,
                axiomId: sha256(`${ctx.run.runId}:${content}`),
                content,
                sourceTaskId: task.taskId,
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      }

      const commitHash = await latestCommit(worktree.path);
      if (commitHash === baseCommit) {
        throw this.errorWithCode(`Task ${task.taskId} produced no commit`, REASON_CODES.NO_COMMIT_PRODUCED);
      }

      record.state = "COMMIT_PRODUCED";
      record.commitHash = commitHash;
      await ctx.db.upsertTask(record);
      ctx.events.append(ctx.run.runId, "TASK_COMMIT_PRODUCED", {
        taskId: task.taskId,
        commitHash
      });

      const analysis = await analyzeCommit(worktree.path, commitHash);
      const scope = evaluateScope(worktree.path, analysis.changedFiles, task.writeScope.allow, task.writeScope.deny);
      if (!scope.allowed) {
        throw this.errorWithCode(`Scope policy failed for ${task.taskId}: ${scope.violations.join("; ")}`, REASON_CODES.SCOPE_DENY);
      }

      record.state = "SCOPE_PASSED";
      await ctx.db.upsertTask(record);

      for (const lease of leases) {
        if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
          throw this.errorWithCode(`Fencing token expired before queuing merge for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
        }
      }

      record.state = "MERGE_QUEUED";
      await ctx.db.upsertTask(record);
      ctx.events.append(ctx.run.runId, "TASK_MERGE_QUEUED", { taskId: task.taskId, commitHash });

      await mergeQueue.enqueue(async () => {
        const mergeTimer = `merge.duration.${task.taskId}.${record.attempts}`;
        this.metrics.startTimer(mergeTimer, { taskId: task.taskId, provider: task.provider });
        const integrationStart = ctx.events.append(ctx.run.runId, "TASK_INTEGRATION_START", { taskId: task.taskId, commitHash });
        await ctx.db.upsertResumeCheckpoint(ctx.run.runId, task.taskId, "MERGE_QUEUED", integrationStart.seq, commitHash);

        for (const lease of leases) {
          if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
            throw this.errorWithCode(`Fencing token invalid for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
          }
        }

        const latestSignatures = collectArtifactSignatures(ctx.run.repoPath, consumedArtifacts);
        const stale = await detectStaleness(ctx.run.repoPath, baseCommit, consumedArtifacts, priorSignatures, latestSignatures);
        if (stale.stale) {
          ctx.events.append(ctx.run.runId, "TASK_REPLAN_TRIGGERED", {
            taskId: task.taskId,
            reasons: stale.reasons
          });
          throw this.errorWithCode(`Task ${task.taskId} is stale: ${stale.reasons.join("; ")}`, REASON_CODES.STALE_TASK);
        }

        for (const lease of leases) {
          if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
            throw this.errorWithCode(`Fencing token expired before merge for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
          }
        }

        await this.integrateCommit(ctx, task, commitHash, leases[0]?.fencingToken ?? 0, leases[0]?.resourceKey, lockManager);
        record.state = "MERGED";
        await ctx.db.upsertTask(record);
        ctx.events.append(ctx.run.runId, "TASK_MERGED", { taskId: task.taskId, commitHash });

        try {
          if (task.verify.outputVerificationRequired) {
            const verify = verifyTaskOutput(ctx.run.repoPath, task);
            if (!verify.ok) {
              throw this.errorWithCode(`Output verification failed: ${verify.errors.join("; ")}`, REASON_CODES.VERIFY_FAIL_OUTPUT);
            }
          }

          const gateCommand = task.verify.gateCommand || ctx.config.baselineGateCommand;
          const validation = validateCommand(gateCommand, task.commandPolicy, ctx.config);
          if (!validation.allowed) {
            throw this.errorWithCode(`Gate command rejected: ${validation.reason}`, REASON_CODES.ABORTED_POLICY);
          }

          const gateTimer = `gate.duration.${task.taskId}.${record.attempts}`;
          this.metrics.startTimer(gateTimer, { taskId: task.taskId, provider: task.provider });
          const gate = await (async () => {
            try {
              return await runGate(gateCommand, ctx.run.repoPath, (task.verify.gateTimeoutSec ?? 120) * 1000, {
                env: ctx.secureExecutor.prepareEnvironment(process.env),
                executionMode: ctx.config.executionMode,
                containerRuntime: ctx.config.containerRuntime,
                containerImage: ctx.config.containerImage,
                containerMemoryMb: ctx.config.containerMemoryMb,
                containerCpuLimit: ctx.config.containerCpuLimit,
                containerRunAsUser: ctx.config.containerRunAsUser,
                containerDropCapabilities: ctx.config.containerDropCapabilities,
                containerReadOnlyRootfs: ctx.config.containerReadOnlyRootfs,
                networkPolicy: this.resolveNetworkPolicy(ctx, task.commandPolicy.network)
              });
            } finally {
              this.metrics.endTimer(gateTimer);
            }
          })();
          await ctx.db.recordGateResult(ctx.run.runId, task.taskId, gate.command, gate.exitCode, gate.stdout, gate.stderr);
          if (!gate.ok) {
            throw this.errorWithCode(`Post-merge gate failed for ${task.taskId}`, REASON_CODES.MERGE_GATE_FAILED);
          }

          const producedArtifacts = task.artifactIO.produces ?? [];
          const producedSignatures = collectArtifactSignatures(ctx.run.repoPath, producedArtifacts);
          for (const [artifactKey, signature] of Object.entries(producedSignatures)) {
            await ctx.db.upsertArtifactSignature(ctx.run.runId, artifactKey, signature, artifactKey);
          }

          const integrationDone = ctx.events.append(ctx.run.runId, "TASK_INTEGRATION_FINISH", { taskId: task.taskId, commitHash });
          await ctx.db.upsertResumeCheckpoint(ctx.run.runId, task.taskId, "VERIFIED", integrationDone.seq, commitHash);
        } catch (verificationError) {
          await runCommand("git", ["-C", ctx.run.repoPath, "revert", "--no-commit", commitHash], { timeoutMs: 15_000 });
          await runCommand("git", ["-C", ctx.run.repoPath, "commit", "-m", `Revert "${commitHash}" due to verification failure`], { timeoutMs: 15_000 });
          ctx.events.append(ctx.run.runId, "TASK_INTEGRATION_ROLLBACK", {
            taskId: task.taskId,
            commitHash,
            reason: (verificationError as Error).message
          });
          throw verificationError;
        } finally {
          this.metrics.endTimer(mergeTimer);
        }
      });

      record.state = "VERIFIED";
      await ctx.db.upsertTask(record);
      ctx.events.append(ctx.run.runId, "TASK_VERIFIED", { taskId: task.taskId, commitHash });
      this.progress(ctx, "task_verified", `Task ${task.taskId} verified`, {
        taskId: task.taskId,
        provider: task.provider
      });

      // Tier 2: Trigger Narrative Condensation (Synchronous to ensure next task sees it)
      const verified = await ctx.db.listRecentVerifiedTasks(ctx.run.runId, 100);
      if (verified.length > 5) {
        try {
          const summary = await condenseHistory(ctx.run.objective, verified, ctx.run.repoPath, ctx.run.narrativeSummary);
          ctx.run.narrativeSummary = summary;
          await ctx.db.upsertRun(ctx.run);
          ctx.events.append(ctx.run.runId, "NARRATIVE_UPDATED", { summary });
        } catch (err) {
          this.logger.error("Condenser failed", { error: (err as Error).message, runId: ctx.run.runId });
        }
      }
    } catch (error) {
      const reasonCode = this.extractReasonCode(error);
      const errorText = (error as Error).message;

      // If it's a replan request, bubble it up to the DAG execution loop immediately.
      if (reasonCode === REASON_CODES.REPLAN_REQUESTED) {
        throw error;
      }

      const providerFailurePersisted = Boolean((error as any).providerFailurePersisted);
      if ((reasonCode === REASON_CODES.EXEC_FAILED || reasonCode === REASON_CODES.AUTH_MISSING) && !providerFailurePersisted) {
        await this.persistProviderHealth(ctx, ctx.providerHealth.onFailure(task.provider, errorText));
      }
      this.progress(ctx, "task_error", `Task ${task.taskId} failed: ${errorText}`, {
        taskId: task.taskId,
        provider: task.provider
      });

      if (isNonRepairableExecutionFailure(errorText, reasonCode)) {
        await ctx.db.recordRepairEvent(ctx.run.runId, task.taskId, "NON_REPAIRABLE_EXEC", 0, errorText);
        record.state = "ESCALATED";
        record.reasonCode = reasonCode;
        await ctx.db.upsertTask(record);
        throw error;
      }

      const failureClass = classifyFailure(errorText, reasonCode);
      const attempt = repairBudget.increment(failureClass);
      await ctx.db.recordRepairEvent(ctx.run.runId, task.taskId, failureClass, attempt, errorText);
      if (reasonCode === REASON_CODES.STALE_TASK) {
        this.metrics.inc("stale.replan_triggered");
      }

      if (repairBudget.allowed(failureClass)) {
        if (reasonCode === REASON_CODES.STALE_TASK) {
          await this.transitionRun(ctx, "REPLANNING");
          record.state = "PENDING";
          record.reasonCode = REASON_CODES.STALE_REPLAN_TRIGGERED;
          await ctx.db.upsertTask(record);
          ctx.events.append(ctx.run.runId, "TASK_REPLAN_ENQUEUED", {
            taskId: task.taskId,
            attempt,
            failureClass
          });
          await this.transitionRun(ctx, "DISPATCHING");
          return;
        }

        let changedFiles: string[] = [];
        if (record.commitHash) {
          try {
            const analysis = await analyzeCommit(worktree.path, record.commitHash);
            changedFiles = analysis.changedFiles;
          } catch {
            // If analysis fails (e.g. repo corruption), fallback to empty
          }
        }

        const errorFiles = extractFilesFromError(errorText, task.writeScope.allow);
        const narrowedFiles = [...new Set([...changedFiles, ...errorFiles])];
        const effectiveFiles = narrowedFiles.length > 0 ? narrowedFiles : task.writeScope.allow;

        const repairTask = buildRepairTask({
          failedTask: task,
          changedFiles: effectiveFiles,
          errorFiles: effectiveFiles
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
        await ctx.db.upsertTask(stateByTask.get(repairTask.taskId)!);
        ctx.events.append(ctx.run.runId, "TASK_REPAIR_ENQUEUED", {
          taskId: task.taskId,
          repairTaskId: repairTask.taskId,
          failureClass,
          attempt
        });

        record.state = "VERIFY_FAILED";
        record.reasonCode = reasonCode;
        await ctx.db.upsertTask(record);
        return;
      }

      record.state = "ESCALATED";
      record.reasonCode = reasonCode;
      await ctx.db.upsertTask(record);
      throw error;
    } finally {
      heartbeat.stopOwner(task.taskId);
      lockManager.releaseOwner(task.taskId);
      await ctx.db.removeLeasesByTask(ctx.run.runId, task.taskId);
      await worktreeManager.remove(ctx.run.repoPath, worktree.path).catch(() => undefined);
    }
  }

  private eligibleForExecutionFallback(errorText: string): boolean {
    const lower = errorText.toLowerCase();
    return [
      "tool not found",
      "unknown option",
      "unsupported option",
      "unsupported tool",
      "invalid argument",
      "unrecognized arguments",
      "no such file or directory",
      "provider unavailable",
      "service unavailable",
      "temporarily unavailable",
      "connection reset",
      "econnreset",
      "etimedout",
      "deadline exceeded"
    ].some((signature) => lower.includes(signature));
  }

  private async runProviderAttempt(
    ctx: RuntimeContext,
    task: TaskContract,
    record: TaskRecord,
    worktreePath: string,
    prompt: string,
    secureBaseEnv: NodeJS.ProcessEnv,
    attempt: ProviderExecutionAttempt
  ) {
    const sandboxHome = await createSandboxHome(ctx.run.runId, task.taskId, attempt.provider);
    const env = buildSandboxEnv(secureBaseEnv, sandboxHome);
    env.ORCH_TASK_NETWORK_POLICY = task.commandPolicy.network;

    const adapter = getProviderAdapter(attempt.provider);
    const providerStartedAt = Date.now();
    const providerTimer = `provider.duration.${task.taskId}.${record.attempts}.${attempt.provider}.${attempt.mode}`;
    this.metrics.startTimer(providerTimer, { taskId: task.taskId, provider: attempt.provider, mode: attempt.mode });
    const heartbeatMs = 15_000;
    ctx.events.append(ctx.run.runId, "TASK_PROVIDER_START", {
      taskId: task.taskId,
      provider: attempt.provider,
      attempt: record.attempts,
      mode: attempt.mode,
      reason: attempt.reason
    });
    this.progress(ctx, "provider_start", `Invoking ${attempt.provider} (${attempt.mode}) for ${task.taskId}`, {
      taskId: task.taskId,
      provider: attempt.provider,
      attempt: record.attempts
    });

    const providerHeartbeat = setInterval(() => {
      const elapsedSec = Math.max(1, Math.floor((Date.now() - providerStartedAt) / 1000));
      ctx.events.append(ctx.run.runId, "TASK_PROVIDER_HEARTBEAT", {
        taskId: task.taskId,
        provider: attempt.provider,
        attempt: record.attempts,
        elapsedSec,
        mode: attempt.mode
      });
      this.progress(ctx, "provider_heartbeat", `Still waiting on ${attempt.provider} for ${task.taskId}`, {
        taskId: task.taskId,
        provider: attempt.provider,
        attempt: record.attempts,
        elapsedSec
      });
    }, heartbeatMs);

    try {
      return await adapter.execute({
        prompt,
        promptViaStdin: true,
        cwd: worktreePath,
        timeoutMs: ctx.config.heartbeatTimeoutSec * 1000,
        env,
        executionMode: ctx.config.executionMode,
        containerRuntime: ctx.config.containerRuntime,
        containerImage: ctx.config.containerImage,
        containerMemoryMb: ctx.config.containerMemoryMb,
        containerCpuLimit: ctx.config.containerCpuLimit,
        containerRunAsUser: ctx.config.containerRunAsUser,
        containerDropCapabilities: ctx.config.containerDropCapabilities,
        containerReadOnlyRootfs: ctx.config.containerReadOnlyRootfs,
        networkPolicy: "allow"
      });
    } finally {
      clearInterval(providerHeartbeat);
      this.metrics.endTimer(providerTimer);
      const providerElapsedSec = Math.max(1, Math.floor((Date.now() - providerStartedAt) / 1000));
      ctx.events.append(ctx.run.runId, "TASK_PROVIDER_FINISH", {
        taskId: task.taskId,
        provider: attempt.provider,
        attempt: record.attempts,
        elapsedSec: providerElapsedSec,
        mode: attempt.mode
      });
    }
  }

  private async integrateCommit(
    ctx: RuntimeContext,
    task: TaskContract,
    commitHash: string,
    fencingToken: number,
    resourceKey: string | undefined,
    lockManager: LockManager
  ): Promise<void> {
    await this.transitionRun(ctx, "INTEGRATING");

    if (resourceKey && !lockManager.validateFencing(resourceKey, task.taskId, fencingToken)) {
      throw this.errorWithCode(`Fencing token invalid or expired immediately before integrate`, REASON_CODES.LOCK_TIMEOUT);
    }

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

    await this.transitionRun(ctx, "VERIFYING");
  }

  private async preflightStageA(ctx: RuntimeContext, options: RunCliOptions): Promise<void> {
    this.progress(ctx, "preflight_a_start", "Preflight stage A starting");
    const plannerProviders: ProviderId[] = options.plannerProvider ? [options.plannerProvider] : ["codex", "claude"];
    const preflight = await runPreflight(plannerProviders, options);
    this.recordProviderVersions(ctx, preflight.statuses);
    ctx.events.append(ctx.run.runId, "PREFLIGHT_STAGE_A", {
      statuses: preflight.statuses,
      installPlan: preflight.installPlan,
      reasonCodes: preflight.reasonCodes
    });
    this.progress(ctx, "preflight_a_done", "Preflight stage A completed");

    const plannerReady = preflight.statuses.some((status) => status.installed && status.authStatus === "OK");
    if (!plannerReady) {
      const reasonCode = preflight.reasonCodes[0] ?? REASON_CODES.PROVIDER_MISSING;
      throw this.errorWithCode("Preflight stage A failed: no ready planner provider", reasonCode);
    }
  }

  private async preflightStageB(ctx: RuntimeContext, providers: ProviderId[], options: RunCliOptions): Promise<void> {
    this.progress(ctx, "preflight_b_start", `Preflight stage B starting for: ${providers.join(", ")}`);
    const preflight = await runPreflight(providers, options);
    this.recordProviderVersions(ctx, preflight.statuses);
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

  private async checkBaseline(
    runId: string,
    repoPath: string,
    config: RuntimeConfig,
    secureExecutor: SecureExecutor,
    options: Pick<RunCliOptions, "allowBaselineRepair" | "onProgress">
  ): Promise<BaselineGateResult> {
    this.emitProgress(runId, options.onProgress, "baseline_start", "Checking repository baseline");
    const clean = await this.isRepoClean(repoPath);
    if (!clean) {
      throw this.errorWithCode("Repository is dirty at run start", REASON_CODES.BASELINE_DIRTY_REPO);
    }

    const gate = await runGate(config.baselineGateCommand, repoPath, 180_000, {
      env: secureExecutor.prepareEnvironment(process.env),
      executionMode: config.executionMode,
      containerRuntime: config.containerRuntime,
      containerImage: config.containerImage,
      containerMemoryMb: config.containerMemoryMb,
      containerCpuLimit: config.containerCpuLimit,
      containerRunAsUser: config.containerRunAsUser,
      containerDropCapabilities: config.containerDropCapabilities,
      containerReadOnlyRootfs: config.containerReadOnlyRootfs,
      networkPolicy: secureExecutor.networkAllowed(config.defaultNetworkPolicy === "allow") ? "allow" : "deny"
    });
    if (!gate.ok && !options.allowBaselineRepair) {
      throw this.errorWithCode("Baseline gate failed", REASON_CODES.BASELINE_GATE_FAILED);
    }

    this.emitProgress(runId, options.onProgress, "baseline_done", "Baseline checks passed");
    return {
      command: gate.command,
      exitCode: gate.exitCode
    };
  }

  private async recordBaselineOk(ctx: RuntimeContext, gate: BaselineGateResult): Promise<void> {
    await this.transitionRun(ctx, "BASELINE_OK");
    ctx.events.append(ctx.run.runId, "BASELINE_OK", { command: gate.command, exitCode: gate.exitCode });
  }

  private async plan(ctx: RuntimeContext, options: RunCliOptions): Promise<DagSpec> {
    this.progress(ctx, "plan_start", "Generating and auditing DAG");
    const planned = options.dryRun
      ? this.mockDag(options.prompt)
      : (await generateDagWithCodex(options.prompt, ctx.run.repoPath, undefined, {
          plannerProvider: options.plannerProvider
        })).dag;

    const healthSnapshots = ctx.providerHealth.snapshotAll();
    const routeDecisions: TaskRoutingDecision[] = [];
    const routed: DagSpec = {
      ...planned,
      nodes: planned.nodes.map((node) => {
        const decision = routeTask(node.type, healthSnapshots);
        const effectiveDecision = options.forceModel
          ? { ...decision, provider: options.forceModel, routingReason: `force-model override: ${options.forceModel}` }
          : decision;
        routeDecisions.push(this.buildRouteDecision(node.taskId, node.type, node.provider, effectiveDecision));
        return {
          ...node,
          provider: effectiveDecision.provider
        };
      })
    };
    ctx.routeDecisions = routeDecisions;

    const audited = auditPlan(routed);
    const frozen = freezePlan(audited.dag);

    await this.transitionRun(ctx, "PLAN_FROZEN");

    writeFileSync(join(ctx.runDir, "plan.raw.json"), JSON.stringify(planned, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "plan.routed.json"), JSON.stringify({ dag: routed, routeDecisions }, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "plan.audited.json"), JSON.stringify(audited, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "plan.frozen.json"), JSON.stringify(frozen, null, 2), "utf8");

    ctx.events.append(ctx.run.runId, "PLAN_FROZEN", {
      dagHash: frozen.dag.dagHash,
      findings: audited.findings,
      immutablePlanHash: frozen.immutablePlanHash,
      routeDecisions
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

  private writeManifest(ctx: RuntimeContext, dag: DagSpec): void {
    writeRunManifest(join(ctx.runDir, "manifest.json"), {
      runId: ctx.run.runId,
      baselineCommit: ctx.run.baselineCommit,
      configHash: ctx.run.configHash,
      dagHash: dag.dagHash ?? "",
      plannerRawPath: join(ctx.runDir, "plan.raw.json"),
      providerVersions: { ...ctx.providerVersions },
      providerHealth: ctx.providerHealth.snapshotAll(),
      executionMode: ctx.config.executionMode,
      createdAt: new Date().toISOString()
    });
  }

  private recordProviderVersions(ctx: RuntimeContext, statuses: ProviderStatus[]): void {
    for (const status of statuses) {
      ctx.providerVersions[status.provider] = status.versionInstalled ?? status.versionLatest;
    }
  }

  private buildRouteDecision(
    taskId: string,
    taskType: TaskContract["type"],
    plannedProvider: ProviderId,
    decision: RoutingDecision
  ): TaskRoutingDecision {
    return {
      taskId,
      taskType,
      plannedProvider,
      routedProvider: decision.provider,
      routingReason: decision.routingReason,
      fallbackProvider: decision.fallbackProvider,
      fallbackReason: decision.fallbackReason
    };
  }

  private composeExecutionPrompt(
    runObjective: string,
    task: TaskContract,
    envelope: ReturnType<typeof buildPromptEnvelope>,
    contextPack: ReturnType<typeof buildContextPack>,
    dependenciesState: Record<string, unknown>
  ): string {
    const failureEvidence = envelope.mutableSections.failureEvidence ?? [];
    const boundedHints = envelope.mutableSections.boundedHints ?? [];
    const completionMarkerExample = JSON.stringify({
      status: "success",
      files_changed: ["src/example.ts"],
      summary: "Implemented scoped changes for task objective and validated behavior.",
      research: "Key evidence and decisions, plus optional [AXIOM] rules for future tasks."
    });

    return [
      "You are the execution agent for one bounded GitWeaver task.",
      "Operate evidence-first and honor every immutable constraint.",
      "",
      "## Mission",
      `Global objective: ${runObjective}`,
      `Task objective: ${task.title}`,
      "",
      "## Immutable Task Contract",
      JSON.stringify(task, null, 2),
      "",
      "## Prompt Envelope",
      JSON.stringify(envelope, null, 2),
      "",
      "## Context Pack",
      JSON.stringify(contextPack, null, 2),
      "",
      "## Dependency State",
      JSON.stringify(dependenciesState, null, 2),
      "",
      "## Hard Constraints",
      "- Modify only files matched by writeScope.allow.",
      "- Never touch writeScope.deny paths.",
      "- Respect commandPolicy.allow/deny and commandPolicy.network exactly.",
      "- Do not invent requirements or alter the global objective.",
      "- Do not claim commands/tests passed unless you actually ran them.",
      "- Produce at least one git commit for status=success.",
      "",
      "## Execution Protocol",
      "1. Inspect relevant files in scope and reconcile them with dependency state.",
      "2. Implement the minimal patch that satisfies the task contract.",
      "3. Run only policy-allowed validation commands needed for confidence.",
      "4. Ensure changed files are inside scope and commit your work.",
      "5. Emit exactly one completion marker as the final machine-readable line.",
      "",
      "## Retry Context",
      failureEvidence.length > 0 ? `Failure evidence:\n${failureEvidence.map((e) => `- ${e}`).join("\n")}` : "Failure evidence: none",
      boundedHints.length > 0 ? `Bounded hints:\n${boundedHints.map((h) => `- ${h}`).join("\n")}` : "Bounded hints: none",
      "",
      "## Completion Marker Contract",
      "Final output must include one line that begins with __ORCH_DONE__: followed by single-line JSON.",
      `Example: __ORCH_DONE__: ${completionMarkerExample}`,
      "Allowed statuses:",
      "- success: task contract completed with a commit.",
      "- fail: task cannot be completed within current contract/constraints.",
      "- replan: progress is blocked by missing prerequisite or flawed DAG dependency.",
      "For replan, include a concrete missing prerequisite in summary.",
      "Use research to capture architectural decisions, key evidence, and discovered conventions.",
      "If you discover a durable project convention, prefix it with [AXIOM] in research."
    ].join("\n");
  }

  private async injectWorktreeMemory(
    ctx: RuntimeContext,
    worktreePath: string,
    task: TaskContract,
    stateByTask: Map<string, TaskRecord>
  ): Promise<void> {
    const run = ctx.run;
    const repairEvents = await ctx.db.listRepairEvents(run.runId, task.taskId);
    const axioms = await ctx.db.listAxioms(run.runId);
    // Tier 1: Active Memory (Sliding Window - last 5 verified tasks)
    const recentTasks = await ctx.db.listRecentVerifiedTasks(run.runId, 5);

    const memory = [
      `# Run Context & Memory`,
      `**Run ID:** ${run.runId}`,
      `**Global Objective:** ${run.objective}`,
      ""
    ];

    // Tier 3: Persistent Research Ledger (Knowledge Graph / Axioms)
    if (axioms.length > 0) {
      memory.push("## Project Axioms (Architectural Rules)");
      for (const axiom of axioms) {
        memory.push(`- **[AXIOM]:** ${axiom.content}`);
      }
      memory.push("");
    }

    // Tier 2: Condensed Memory (The Story So Far)
    memory.push("## The Story So Far");
    if (ctx.run.narrativeSummary) {
      memory.push(ctx.run.narrativeSummary);
    } else if (recentTasks.length > 0) {
      const latest = recentTasks[0]!;
      memory.push(`Most recently, ${latest.taskId} was completed: ${latest.summary || "No summary provided."}`);
    } else {
      memory.push("Project initialized and core architectural foundations are being established.");
    }
    memory.push("");

    // Tier 1: Active Memory (The Sliding Window)
    memory.push("## Active Memory (Recent Progress)");
    if (recentTasks.length > 0) {
      for (const t of recentTasks) {
        memory.push(`### ${t.taskId} (Completed)`);
        if (t.summary) {
          memory.push(`**Summary:** ${t.summary}`);
        }
        if (t.research) {
          memory.push(`**Research Findings:**\n${t.research}`);
        }
        memory.push("");
      }
    } else {
      memory.push("No tasks have been verified in Active Memory yet.");
      memory.push("");
    }

    if (repairEvents.length > 0) {
      memory.push("## Repair History (Current Task)");
      memory.push("This task has failed previously. Learn from these failures:");
      for (const event of repairEvents) {
        memory.push(`- **Attempt ${event.attempt} (${event.failureClass}):** ${event.details}`);
      }
      memory.push("");
    }

    const dotGeminiDir = join(worktreePath, ".gemini");
    mkdirSync(dotGeminiDir, { recursive: true });
    writeFileSync(join(dotGeminiDir, "run_context.md"), memory.join("\n"), "utf8");
    writeFileSync(join(worktreePath, "GEMINI.md"), memory.join("\n"), "utf8");
  }

  private resourceKeys(task: TaskContract): string[] {
    const fromAllow = task.writeScope.allow.map((file) => `file:${file}`);
    const shared = task.writeScope.sharedKey ? [`class:${task.writeScope.sharedKey}`] : [];
    return [...new Set([...fromAllow, ...shared])].sort((a, b) => a.localeCompare(b));
  }

  private async acquireWriteLeasesWithRetry(
    ctx: RuntimeContext,
    lockManager: LockManager,
    resourceKeys: string[],
    taskId: string
  ): Promise<LockLease[]> {
    let attempt = 0;
    while (attempt <= ctx.config.lockContentionRetryMax) {
      const leases = lockManager.tryAcquireWrite(resourceKeys, taskId);
      if (leases) {
        return leases;
      }

      if (attempt === ctx.config.lockContentionRetryMax) {
        break;
      }

      attempt += 1;
      const backoffMs = Math.min(500, ctx.config.lockContentionBackoffMs * attempt);
      this.metrics.inc("lock.contention_retry");
      await this.waitMs(backoffMs);
    }

    this.metrics.inc("lock.contention_exhausted");
    throw this.errorWithCode(`Unable to acquire lock lease for task ${taskId}`, REASON_CODES.LOCK_TIMEOUT);
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

  private async transitionRun(ctx: RuntimeContext, to: RunRecord["state"]): Promise<void> {
    assertRunTransition(ctx.run.state, to);
    ctx.run.state = to;
    ctx.run.updatedAt = new Date().toISOString();
    await this.persistRun(ctx);
    ctx.events.append(ctx.run.runId, "RUN_STATE", {
      state: to
    });
    this.progress(ctx, "run_state", `Run state changed to ${to}`, { state: to });
  }

  private async persistRun(ctx: RuntimeContext): Promise<void> {
    await ctx.db.upsertRun(ctx.run);
  }

  private async completeRun(
    ctx: RuntimeContext,
    state: RunRecord["state"],
    reasonCode: ReasonCode | undefined,
    summary: Record<string, unknown>
  ): Promise<RunOutcome> {
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
    await this.persistRun(ctx);
    const metricsSnapshot = this.metrics.snapshot();
    const stageLatencyMs = this.buildStageLatencySummary(metricsSnapshot);
    if (!("metrics" in summary)) {
      summary.metrics = metricsSnapshot;
    }
    if (Object.keys(stageLatencyMs).length > 0 && !("stageLatencyMs" in summary)) {
      summary.stageLatencyMs = stageLatencyMs;
    }
    writeFileSync(join(ctx.runDir, "metrics.json"), JSON.stringify(metricsSnapshot, null, 2), "utf8");
    writeFileSync(join(ctx.runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    this.updateManifestTelemetry(ctx.runDir, stageLatencyMs);
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

  private openDb(repoPath: string): OrchestratorDb {
    const config = loadConfig(undefined);
    return new OrchestratorDb(join(repoPath, ".orchestrator", "state.sqlite"), {
      journalMode: config.sqliteJournalMode,
      synchronous: config.sqliteSynchronous,
      busyTimeoutMs: config.sqliteBusyTimeoutMs,
      busyRetryMax: config.sqliteBusyRetryMax
    });
  }

  private indexProviderHealth(snapshots: ProviderHealthSnapshot[]): Partial<Record<ProviderId, ProviderHealthSnapshot>> {
    return snapshots.reduce<Partial<Record<ProviderId, ProviderHealthSnapshot>>>((acc, snapshot) => {
      acc[snapshot.provider] = snapshot;
      return acc;
    }, {});
  }

  private async persistProviderHealth(ctx: RuntimeContext, snapshot: ProviderHealthSnapshot): Promise<void> {
    await ctx.db.upsertProviderHealth(ctx.run.runId, snapshot);
    this.metrics.inc("provider.health_updates");
    ctx.events.append(ctx.run.runId, "PROVIDER_HEALTH_UPDATED", {
      provider: snapshot.provider,
      score: snapshot.score,
      cooldownUntil: snapshot.cooldownUntil,
      consecutiveFailures: snapshot.consecutiveFailures,
      backoffSec: snapshot.backoffSec
    });
  }

  private resolveNetworkPolicy(ctx: RuntimeContext, taskPolicy: "allow" | "deny"): "allow" | "deny" {
    const allowed = ctx.secureExecutor.networkAllowed(taskPolicy === "allow");
    return allowed ? "allow" : "deny";
  }

  private persistForensicOutput(ctx: RuntimeContext, taskId: string, attempt: number, rawOutput: string): string {
    const dir = join(ctx.runDir, "forensics");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${taskId}.attempt-${attempt}.raw.log`);
    writeFileSync(path, rawOutput, "utf8");
    return path;
  }

  private estimateDryRunCost(dag: DagSpec): Record<string, unknown> {
    const providerCounts = dag.nodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.provider] = (acc[node.provider] ?? 0) + 1;
      return acc;
    }, {});

    const weightedUnits = dag.nodes.reduce((total, node) => {
      if (node.type === "code" || node.type === "refactor") {
        return total + 3;
      }
      if (node.type === "test" || node.type === "repair") {
        return total + 2;
      }
      return total + 1;
    }, 0);

    return {
      unitModel: "relative-weight",
      weightedUnits,
      taskCount: dag.nodes.length,
      byProvider: providerCounts
    };
  }

  private async waitMs(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private errorWithCode(message: string, reasonCode: ReasonCode): Error {
    const error = new Error(message) as Error & { reasonCode?: ReasonCode };
    error.reasonCode = reasonCode;
    return error;
  }

  private extractReasonCode(error: unknown): ReasonCode {
    const reasonCode = (error as { reasonCode?: ReasonCode }).reasonCode;
    if (!reasonCode && isSqliteBusyError(error)) {
      return REASON_CODES.SQLITE_BUSY_EXHAUSTED;
    }
    return reasonCode ?? REASON_CODES.ABORTED_POLICY;
  }

  private buildStageLatencySummary(metricsSnapshot: Record<string, unknown>): Record<string, { count: number; min: number; max: number; avg: number }> {
    const histogramsRaw = metricsSnapshot.histograms;
    if (!histogramsRaw || typeof histogramsRaw !== "object") {
      return {};
    }

    const stageBuckets = {
      provider: [] as number[],
      merge: [] as number[],
      gate: [] as number[]
    };

    for (const [key, value] of Object.entries(histogramsRaw as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const samples = value.filter((sample): sample is number => typeof sample === "number" && Number.isFinite(sample));
      if (samples.length === 0) {
        continue;
      }

      const metricName = key.split(":")[0] ?? key;
      if (metricName.startsWith("provider.duration.")) {
        stageBuckets.provider.push(...samples);
      } else if (metricName.startsWith("merge.duration.")) {
        stageBuckets.merge.push(...samples);
      } else if (metricName.startsWith("gate.duration.")) {
        stageBuckets.gate.push(...samples);
      }
    }

    const summary: Record<string, { count: number; min: number; max: number; avg: number }> = {};
    for (const [stage, samples] of Object.entries(stageBuckets)) {
      if (samples.length === 0) {
        continue;
      }
      const total = samples.reduce((acc, sample) => acc + sample, 0);
      summary[stage] = {
        count: samples.length,
        min: Math.min(...samples),
        max: Math.max(...samples),
        avg: Number((total / samples.length).toFixed(2))
      };
    }
    return summary;
  }

  private updateManifestTelemetry(
    runDir: string,
    stageLatencyMs: Record<string, { count: number; min: number; max: number; avg: number }>
  ): void {
    if (Object.keys(stageLatencyMs).length === 0) {
      return;
    }

    const manifestPath = join(runDir, "manifest.json");
    try {
      const existing = JSON.parse(readFileSync(manifestPath, "utf8")) as RunManifest;
      writeRunManifest(manifestPath, {
        ...existing,
        stageLatencyMs
      });
    } catch {
      // Manifest is optional in some tests and abort paths.
    }
  }

  private emitProgress(
    runId: string,
    onProgress: ((update: ProgressUpdate) => void) | undefined,
    stage: string,
    message: string,
    details: Omit<ProgressUpdate, "runId" | "ts" | "stage" | "message"> = {}
  ): void {
    if (!onProgress) {
      return;
    }

    onProgress({
      runId,
      ts: new Date().toISOString(),
      stage,
      message,
      ...details
    });
  }

  private progress(
    ctx: RuntimeContext,
    stage: string,
    message: string,
    details: Omit<ProgressUpdate, "runId" | "ts" | "stage" | "message"> = {}
  ): void {
    this.emitProgress(ctx.run.runId, ctx.onProgress, stage, message, details);
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
