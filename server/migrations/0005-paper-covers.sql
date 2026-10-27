-- Cover images are separate from PDF bytes and reading records.
CREATE TABLE IF NOT EXISTS paper_covers (
  book_id TEXT NOT NULL REFERENCES papers(id),
  crop TEXT NOT NULL CHECK(crop IN ('zh', 'full')),
  object_key TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY(book_id, crop)
);
