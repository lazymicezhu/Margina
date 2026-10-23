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
