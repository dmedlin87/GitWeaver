import { PriorityQueue } from "./priority-queue.js";
import { ProviderTokenBuckets } from "./token-buckets.js";
import type { TaskContract } from "../core/types.js";

export interface ScheduledTask extends TaskContract {
  priority?: number;
}

export class Scheduler {
  private readonly queue = new PriorityQueue<ScheduledTask>();
  private readonly buckets: ProviderTokenBuckets;

  public constructor(providerBuckets: { codex: number; claude: number; gemini: number }) {
    this.buckets = new ProviderTokenBuckets(providerBuckets);
  }

  public enqueue(task: ScheduledTask, priority = 0): void {
    if (this.queue.has(task.taskId)) {
      return;
    }
    this.queue.enqueue(task.taskId, task, priority);
  }

  public tryDispatch(): ScheduledTask | null {
    const snapshot = this.queue.size();
    for (let attempt = 0; attempt < snapshot; attempt += 1) {
      const candidate = this.queue.dequeue();
      if (!candidate) {
        return null;
      }

      if (this.buckets.tryAcquire(candidate.provider)) {
        return candidate;
      }

      this.queue.enqueue(candidate.taskId, candidate, candidate.priority ?? 0);
    }
    return null;
  }

  public complete(task: ScheduledTask): void {
    this.buckets.release(task.provider);
  }

  public pending(): number {
    return this.queue.size();
  }

  public bucketSnapshot(): Record<string, { capacity: number; available: number }> {
    return this.buckets.snapshot();
  }
}