-- 4.4.6: the owner is an account, and admin is a role of it. The admin's
-- rows were always keyed 'admin' (spend, elements.invite, suggestions,
-- challenge_wins, reports), so the owner's account is an invite with that id:
-- nothing moves, the same trick as 0011. Its link hash is random (nobody
-- holds a link to it); it becomes an account the first time the owner makes
-- a passkey from a device that holds the admin token, and from then on any
-- device signed in to it has the admin powers, with no token to type.
ALTER TABLE invites ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO invites (id, token_hash, name, status, cap_usd, created_at, admin)
VALUES ('admin', lower(hex(randomblob(32))), 'admin', 'active', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000, 1);

-- When each signed in device last saved to the account, for the account page.
ALTER TABLE sessions ADD COLUMN last_sync INTEGER;
