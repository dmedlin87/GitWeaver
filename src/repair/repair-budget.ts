import type { FailureClass } from "./failure-classifier.js";

export class RepairBudget {
  private readonly attempts = new Map<FailureClass, number>();

  public constructor(private readonly maxAttemptsPerClass: number) {}

  public increment(failureClass: FailureClass): number {
    const next = (this.attempts.get(failureClass) ?? 0) + 1;
    this.attempts.set(failureClass, next);
    return next;
  }

  public allowed(failureClass: FailureClass): boolean {
    return (this.attempts.get(failureClass) ?? 0) <= this.maxAttemptsPerClass;
  }

  public snapshot(): Record<string, number> {
    return Object.fromEntries(this.attempts.entries());
  }
}
