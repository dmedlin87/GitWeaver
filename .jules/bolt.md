## 2025-02-28 - SQLite Batch Inserts Optimization
**Learning:** SQLite disk sync for each implicit transaction is highly inefficient when doing loops of `upsertTask` with autocommit on. Grouping them inside `db.transaction()` reduces I/O overhead from O(N) fsyncs to O(1). This was shown in the `db_loop_benchmark.ts` to be significantly faster.
**Action:** Always wrap loops of database write operations (like `upsertTask`) in a single `db.transaction()` block within Node.js SQLite abstractions when operating on an array of records.

## 2026-02-28 - Optimizing `minimatch` in hot loops
**Learning:** Calling the `minimatch(path, pattern)` function inside a loop parses the glob pattern string every single time. For `N` files and `M` patterns, this results in `N * M` redundant parses, creating a significant CPU bottleneck during large commit or error string evaluations.
**Action:** Always pre-compile glob patterns using the `Minimatch` class (e.g. `new Minimatch(pattern)`) *outside* the loop, then call `.match()` on the pre-compiled objects inside the loop to achieve O(M) compilation time instead of O(N * M).
