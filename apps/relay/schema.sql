CREATE TABLE spaces (
  space_id   TEXT PRIMARY KEY,          -- 32 hex chars, from HKDF (research R2)
  token_hash TEXT NOT NULL,             -- hex SHA-256 of the auth token
  created_at INTEGER NOT NULL           -- unix ms
);
CREATE TABLE batches (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   TEXT NOT NULL,
  batch_id   TEXT NOT NULL,
  iv         TEXT NOT NULL,
  ct         TEXT NOT NULL,             -- base64url ciphertext, ≤ 1 MiB request
  created_at INTEGER NOT NULL,
  UNIQUE (space_id, batch_id)
);
CREATE INDEX idx_batches_space_seq ON batches(space_id, seq);
CREATE TABLE rate (
  space_id TEXT NOT NULL,
  minute   INTEGER NOT NULL,            -- floor(unix ms / 60000)
  count    INTEGER NOT NULL,
  PRIMARY KEY (space_id, minute)
);
