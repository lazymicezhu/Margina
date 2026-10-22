-- Apply once to databases created before TXT/private uploads.
ALTER TABLE papers ADD COLUMN content_hash TEXT;
ALTER TABLE papers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
