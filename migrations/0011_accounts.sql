-- 4.0: accounts. An invite becomes an account with the same id the moment
-- its link is opened and a passkey is made: everything the server keys by
-- the invite id (spend, First Discoveries, ideas, wins, reports) is the
-- account's already, so nothing moves. The link then stops working for
-- anyone else (its hash is replaced); the admin's "New link" on a claimed
-- invite is a one use sign in link for the same person.

-- When the account was created, and when the person asked for deletion
-- (the row stays so the id is never reused and the month's spend stays whole).
ALTER TABLE invites ADD COLUMN claimed_at INTEGER;
ALTER TABLE invites ADD COLUMN deleted_at INTEGER;
-- Set by the person from the account page, only for sign in links by email.
ALTER TABLE invites ADD COLUMN email TEXT;

-- Passkeys. id is the credential id (base64url), public_key the COSE key (base64url).
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  invite TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);

CREATE INDEX credentials_by_invite ON credentials (invite);

-- Signed in devices: a bearer token in a header, hashed here, 30 days.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  invite TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER,
  device TEXT
);

CREATE INDEX sessions_by_invite ON sessions (invite);

-- WebAuthn challenges, one use, a few minutes. kind: register or login.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  invite TEXT,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One use sign in links sent by email, hashed, 20 minutes.
CREATE TABLE account_links (
  token_hash TEXT PRIMARY KEY,
  invite TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- The account's progress, three documents: discoveries, board, island
-- (the island gzipped and base64 encoded). updated_at and device say which
-- device saved last, for the warning before an older device overwrites it.
CREATE TABLE progress (
  invite TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  device TEXT,
  PRIMARY KEY (invite, kind)
);
