CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    quarantined BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS analysis_runs_owner_idx
    ON analysis_runs (owner_id);
