import type { LockLease } from "../core/types.js";
import { LockManager } from "./lock-manager.js";

export class LeaseHeartbeat {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(private readonly lockManager: LockManager, private readonly renewMs: number) {}

  public start(ownerTaskId: string, leases: LockLease[]): void {
    for (const lease of leases) {
      const key = `${ownerTaskId};;;${lease.resourceKey}`;
      if (this.timers.has(key)) {
        clearInterval(this.timers.get(key));
        this.timers.delete(key);
      }

      const timer = setInterval(() => {
        const renewed = this.lockManager.renew(lease.resourceKey, ownerTaskId, lease.fencingToken);
        if (!renewed) {
          clearInterval(timer);
          this.timers.delete(key);
        }
      }, this.renewMs);
      this.timers.set(key, timer);
    }
  }

  public stopOwner(ownerTaskId: string): void {
    const prefix = `${ownerTaskId};;;`;
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(prefix)) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
  }
}