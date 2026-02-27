CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  baseline_commit TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason_code TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  contract_hash TEXT NOT NULL,
  lease_token INTEGER,
  commit_hash TEXT,
  reason_code TEXT,
  PRIMARY KEY (run_id, task_id)
);

CREATE TABLE IF NOT EXISTS task_attempts (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  reason_code TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, task_id, attempt)
);

CREATE TABLE IF NOT EXISTS leases (
  run_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  owner_task_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  PRIMARY KEY (run_id, resource_key)
);

CREATE TABLE IF NOT EXISTS lease_counters (
  run_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  PRIMARY KEY (run_id, resource_key)
);

CREATE TABLE IF NOT EXISTS provider_health (
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  score INTEGER NOT NULL,
  last_errors TEXT NOT NULL,
  token_bucket INTEGER NOT NULL,
  cooldown_until TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  backoff_sec INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, provider)
);

CREATE TABLE IF NOT EXISTS artifacts (
  run_id TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  file_path TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, artifact_key)
);

CREATE TABLE IF NOT EXISTS prompt_envelopes (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  immutable_sections_hash TEXT NOT NULL,
  task_contract_hash TEXT NOT NULL,
  context_pack_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, task_id, attempt)
);

CREATE TABLE IF NOT EXISTS gate_results (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repair_events (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, task_id, failure_class, attempt)
);

CREATE TABLE IF NOT EXISTS resume_checkpoints (
  run_id TEXT PRIMARY KEY,
  task_id TEXT,
  state TEXT,
  event_seq INTEGER NOT NULL,
  commit_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
