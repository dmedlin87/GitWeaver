import type { LockLease } from "../core/types.js";

interface LeaseRecord {
  lease: LockLease;
  timer?: NodeJS.Timeout;
}

export class LockManager {
  private readonly leaseDurationMs: number;
  private readonly leasesByKey = new Map<string, LeaseRecord>();
  private readonly counterByKey = new Map<string, number>();

  public constructor(leaseDurationMs: number) {
    this.leaseDurationMs = leaseDurationMs;
  }

  public tryAcquireWrite(resourceKeys: string[], ownerTaskId: string): LockLease[] | null {
    const now = Date.now();
    const orderedKeys = [...new Set(resourceKeys)].sort((a, b) => a.localeCompare(b));

    for (const key of orderedKeys) {
      const existing = this.leasesByKey.get(key);
      if (existing) {
        // If lease is expired, we can steal it
        const expired = new Date(existing.lease.expiresAt).getTime() <= now;
        if (!expired && existing.lease.ownerTaskId !== ownerTaskId) {
          return null;
        }
      }
    }

    const leases: LockLease[] = [];
    for (const key of orderedKeys) {
      const nextToken = (this.counterByKey.get(key) ?? 0) + 1;
      this.counterByKey.set(key, nextToken);
      const acquiredAt = new Date(now).toISOString();
      const expiresAt = new Date(now + this.leaseDurationMs).toISOString();
      const lease: LockLease = {
        resourceKey: key,
        mode: "write",
        ownerTaskId,
        acquiredAt,
        expiresAt,
        fencingToken: nextToken
      };

      const existing = this.leasesByKey.get(key);
      if (existing?.timer) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        const current = this.leasesByKey.get(key);
        if (current && current.lease.fencingToken === nextToken) {
          this.leasesByKey.delete(key);
        }
      }, this.leaseDurationMs + 50);

      this.leasesByKey.set(key, { lease, timer });
      leases.push(lease);
    }

    return leases;
  }

  public renew(resourceKey: string, ownerTaskId: string, fencingToken: number): boolean {
    const current = this.leasesByKey.get(resourceKey);
    if (!current) {
      return false;
    }

    // Strict validation of ownership and token
    if (current.lease.ownerTaskId !== ownerTaskId || current.lease.fencingToken !== fencingToken) {
      return false;
    }

    const now = Date.now();
    // Cannot renew an expired lease
    if (new Date(current.lease.expiresAt).getTime() <= now) {
      return false;
    }

    const expiresAt = new Date(now + this.leaseDurationMs).toISOString();
    const updated: LockLease = {
      ...current.lease,
      expiresAt
    };

    if (current.timer) {
      clearTimeout(current.timer);
    }

    const timer = setTimeout(() => {
      const latest = this.leasesByKey.get(resourceKey);
      if (latest && latest.lease.fencingToken === fencingToken) {
        this.leasesByKey.delete(resourceKey);
      }
    }, this.leaseDurationMs + 50);

    this.leasesByKey.set(resourceKey, { lease: updated, timer });
    return true;
  }

  public validateFencing(resourceKey: string, ownerTaskId: string, fencingToken: number): boolean {
    const current = this.leasesByKey.get(resourceKey);
    if (!current) {
      return false;
    }
    const now = Date.now();
    return (
      current.lease.ownerTaskId === ownerTaskId &&
      current.lease.fencingToken === fencingToken &&
      new Date(current.lease.expiresAt).getTime() > now
    );
  }

  public releaseOwner(ownerTaskId: string): void {
    for (const [resourceKey, record] of this.leasesByKey.entries()) {
      if (record.lease.ownerTaskId === ownerTaskId) {
        if (record.timer) {
          clearTimeout(record.timer);
        }
        this.leasesByKey.delete(resourceKey);
      }
    }
  }

  public snapshot(): LockLease[] {
    return [...this.leasesByKey.values()].map((record) => record.lease);
  }
}
