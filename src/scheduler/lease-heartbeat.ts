import type { LockLease } from "../core/types.js";
import { LockManager } from "./lock-manager.js";

export class LeaseHeartbeat {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(private readonly lockManager: LockManager, private readonly renewMs: number) {}

  public start(ownerTaskId: string, leases: LockLease[]): void {
    for (const lease of leases) {
      const key = `${ownerTaskId}:${lease.resourceKey}`;
      const existing = this.timers.get(key);
      if (existing) {
        clearInterval(existing);
      }

      const timer = setInterval(() => {
        const renewed = this.lockManager.renew(lease.resourceKey, ownerTaskId, lease.fencingToken);
        if (!renewed) {
          const currentTimer = this.timers.get(key);
          if (currentTimer === timer) {
            clearInterval(timer);
            this.timers.delete(key);
          } else {
            // we should still clear this obsolete timer
            clearInterval(timer);
          }
        }
      }, this.renewMs);
      this.timers.set(key, timer);
    }
  }

  public stopOwner(ownerTaskId: string): void {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${ownerTaskId}:`)) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
  }
}
