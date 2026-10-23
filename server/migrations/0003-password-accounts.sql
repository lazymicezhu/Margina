CREATE TABLE IF NOT EXISTS account_credentials (
 email TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, salt TEXT NOT NULL,
 password_hash TEXT NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_user ON account_sessions(user_id);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires);
CREATE TABLE IF NOT EXISTS account_auth_grants (
 token_hash TEXT PRIMARY KEY, user_id TEXT, email TEXT, purpose TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_grants_expiry ON account_auth_grants(expires);
CREATE TABLE IF NOT EXISTS account_auth_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_limits_expiry ON account_auth_limits(expires);
