CREATE TABLE IF NOT EXISTS catalog_folders (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL,
  created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_folders_owner ON catalog_folders(owner);
CREATE TABLE IF NOT EXISTS catalog_items (
  book_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES catalog_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS catalog_items_folder ON catalog_items(folder_id);
