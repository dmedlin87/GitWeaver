export class MergeQueue {
  private chain: Promise<void> = Promise.resolve();

  public enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => job();
    const result = this.chain.then(run, run);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}