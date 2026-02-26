interface TimerRecord {
  startMs: number;
  labels: Record<string, string>;
}

export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly timers = new Map<string, TimerRecord>();
  private readonly histograms = new Map<string, number[]>();

  public inc(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  public startTimer(name: string, labels: Record<string, string> = {}): void {
    this.timers.set(name, { startMs: Date.now(), labels });
  }

  public endTimer(name: string): void {
    const timer = this.timers.get(name);
    if (!timer) {
      return;
    }
    this.timers.delete(name);
    const elapsed = Date.now() - timer.startMs;
    const histName = `${name}:${JSON.stringify(timer.labels)}`;
    const existing = this.histograms.get(histName) ?? [];
    existing.push(elapsed);
    this.histograms.set(histName, existing);
  }

  public snapshot(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      histograms: Object.fromEntries(this.histograms.entries())
    };
  }
}