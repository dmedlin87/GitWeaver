export interface QueueItem<T> {
  key: string;
  priority: number;
  enqueuedAt: number;
  payload: T;
}

export class PriorityQueue<T> {
  private readonly items = new Map<string, QueueItem<T>>();

  public enqueue(key: string, payload: T, priority = 0): void {
    this.items.set(key, {
      key,
      payload,
      priority,
      enqueuedAt: Date.now()
    });
  }

  public dequeue(): T | undefined {
    const next = this.pickNext();
    if (!next) {
      return undefined;
    }
    this.items.delete(next.key);
    return next.payload;
  }

  public has(key: string): boolean {
    return this.items.has(key);
  }

  public size(): number {
    return this.items.size;
  }

  public remove(key: string): boolean {
    return this.items.delete(key);
  }

  public get(key: string): T | undefined {
    return this.items.get(key)?.payload;
  }

  public keys(): string[] {
    return Array.from(this.items.keys());
  }

  private pickNext(): QueueItem<T> | undefined {
    let best: QueueItem<T> | undefined;
    for (const item of this.items.values()) {
      if (!best) {
        best = item;
        continue;
      }

      const bestScore = this.score(best);
      const itemScore = this.score(item);
      if (itemScore > bestScore) {
        best = item;
      }
    }
    return best;
  }

  private score(item: QueueItem<T>): number {
    const ageSeconds = (Date.now() - item.enqueuedAt) / 1000;
    return item.priority + ageSeconds / 30;
  }
}