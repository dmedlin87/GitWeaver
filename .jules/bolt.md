## 2025-02-28 - SQLite Batch Inserts Optimization
**Learning:** SQLite disk sync for each implicit transaction is highly inefficient when doing loops of `upsertTask` with autocommit on. Grouping them inside `db.transaction()` reduces I/O overhead from O(N) fsyncs to O(1). This was shown in the `db_loop_benchmark.ts` to be significantly faster.
**Action:** Always wrap loops of database write operations (like `upsertTask`) in a single `db.transaction()` block within Node.js SQLite abstractions when operating on an array of records.
