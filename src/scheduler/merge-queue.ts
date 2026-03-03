export class MergeQueue {
  private chain: Promise<void> = Promise.resolve();

  public enqueue<T>(job: () => Promise<T>, validate?: () => boolean): Promise<T> {
    if (validate && !validate()) {
      return Promise.reject(new Error("Stale lease: validation failed before queueing"));
    }
    const run = (): Promise<T> => {
      if (validate && !validate()) {
        return Promise.reject(new Error("Stale lease: validation failed before execution"));
      }
      return job();
    };
    const result = this.chain.then(run, run);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}