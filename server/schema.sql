CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  pages INTEGER NOT NULL,
  bilingual INTEGER NOT NULL DEFAULT 0,
  pdf_key TEXT NOT NULL,
  content_hash TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  bundle_key TEXT,
  owner TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS papers_catalog ON papers(removed, created DESC, id);

-- Replacing a snapshot allocates a new sequence. Removed shelf entries stay
-- here as tombstones, so offline devices cannot resurrect old membership.
CREATE TABLE IF NOT EXISTS reading (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  UNIQUE(user_id, book_id)
);
CREATE INDEX IF NOT EXISTS reading_changes ON reading(user_id, seq);

-- Reservations include in-flight and withdrawn files. Failed uploads only
-- release their reservation after R2 confirms deletion.
CREATE TABLE IF NOT EXISTS storage_allocations (
  object_key TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK(bytes >= 0)
);
INSERT OR IGNORE INTO storage_allocations(object_key, bytes) SELECT pdf_key, size FROM papers WHERE removed < 2;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
INSERT OR IGNORE INTO users(id, created, last_seen) SELECT user_id, 0, 0 FROM reading;
INSERT OR IGNORE INTO users(id, created, last_seen) SELECT owner, created, updated FROM papers;
CREATE TABLE IF NOT EXISTS shelf_folders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  salt TEXT, password_hash TEXT, failures INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shelf_folders_owner ON shelf_folders(user_id);
CREATE TABLE IF NOT EXISTS shelf_items (
  user_id TEXT NOT NULL, book_id TEXT NOT NULL, folder_id TEXT, remark TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(user_id, book_id)
);
CREATE INDEX IF NOT EXISTS shelf_items_folder ON shelf_items(user_id, folder_id);
CREATE TABLE IF NOT EXISTS shelf_unlocks (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, folder_id TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shelf_unlocks_folder ON shelf_unlocks(folder_id);
