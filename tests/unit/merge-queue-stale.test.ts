import { describe, expect, it } from "vitest";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";

describe("MergeQueue", () => {
  it("rejects synchronously and avoids race conditions", async () => {
    const queue = new MergeQueue();
    let executed = false;

    // According to memory: "In JavaScript, throw new Error(...) and return Promise.reject(...) inside an async function are functionally identical. To fix synchronous validation race conditions before a Promise chain, the validation must occur synchronously outside the async wrapper."

    // This means `run` should be a regular function returning a Promise, not an `async` function.
    // And if validate() fails, it should synchronously throw or return a rejected Promise inside the `then` handler. Wait, `then(run)` will execute `run` asynchronously relative to the enqueueing, but synchronously relative to the chain execution.

    const p = queue.enqueue(
      async () => { executed = true; },
      () => false
    );

    await expect(p).rejects.toThrow("Stale lease: validation failed before execution");
    expect(executed).toBe(false);
  });
});
