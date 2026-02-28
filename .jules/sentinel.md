
## 2026-02-28 - [PtyManager Leak]
**Vulnerability:** Inherited API Keys in PtyManager process.env leakage
**Learning:** node-pty child processes inherit process.env by default, allowing untrusted commands to access the agent's sensitive API keys.
**Prevention:** Filter out explicit `DENYLIST` keys from base `process.env` before explicitly allowing overrides via `options.env` when passing environmental variables to node-pty.
