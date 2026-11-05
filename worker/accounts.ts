import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { HttpError } from "./http";
import { newSecret, sha256, type InviteRow } from "./ledger";
import type { AccountInfo, ProgressDoc, ProgressKind, ProgressPut, SignedIn, StoredKind } from "../shared/account";
import { PROGRESS_KINDS, PROGRESS_LIMITS } from "../shared/account";

// 4.0: accounts. An invite becomes an account with the same id when its
// link is opened and a passkey is made; the link's hash is then replaced, so
// it stops working for anyone else. A signed in device holds a bearer token
// (x-session), hashed here, 30 days, rotated on each passkey sign in. The
// admin's "New link" on a claimed invite is a one use sign in link for the
// same person (claimLink); an email link is the same thing sent by a
// provider, when one is set up (EMAIL_API_URL, EMAIL_API_KEY, EMAIL_FROM).

export interface AccountEnv {
  DB: D1Database;
  // A Resend compatible endpoint (POST JSON {from, to, subject, text} with a
  // bearer key). Unset: sign in by email is not offered.
  EMAIL_API_URL?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
}

export const SESSION_DAYS = 30;
const CHALLENGE_MS = 5 * 60_000;
const EMAIL_LINK_MS = 20 * 60_000;
const RP_NAME = "Magic Merger";

export interface SessionRow {
  token_hash: string;
  invite: string;
  created_at: number;
  expires_at: number;
  last_seen: number | null;
  device: string | null;
  // 4.4.6: when this device last saved to the account.
  last_sync?: number | null;
}

// What a sign in answers: the session, and whose account it is.
function signInAnswer(token: string, invite: InviteRow): SignedIn {
  return { token, name: invite.name, id: invite.id, admin: !!invite.admin };
}

interface CredentialRow {
  id: string;
  invite: string;
  public_key: string;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  created_at: number;
  last_used: number | null;
}

// The signed in person behind an x-session header, or null. A revoked or
// deleted invite signs nobody in, whatever token it holds.
export async function sessionByToken(db: D1Database, token: string, now = Date.now()): Promise<{ session: SessionRow; invite: InviteRow } | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const hash = await sha256(token);
  const session = await db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?").bind(hash, now).first<SessionRow>();
  if (!session) return null;
  const invite = await db.prepare("SELECT * FROM invites WHERE id = ?").bind(session.invite).first<InviteRow>();
  if (!invite || invite.status === "revoked" || invite.deleted_at) return null;
  if ((session.last_seen ?? 0) < now - 300_000) {
    await db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").bind(now, hash).run();
  }
  return { session, invite };
}

async function newSession(db: D1Database, invite: string, device: string, now = Date.now()): Promise<string> {
  const token = newSecret(32);
  await db
    .prepare("INSERT INTO sessions (token_hash, invite, created_at, expires_at, last_seen, device) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256(token), invite, now, now + SESSION_DAYS * 86400_000, now, device.slice(0, 120))
    .run();
  return token;
}

// A one use link's hash is replaced by one nobody holds: the link is dead.
// Conditional on the hash it was opened with, so two openings at once take
// it once: the second finds it gone.
async function retireLink(db: D1Database, invite: InviteRow): Promise<boolean> {
  const r = await db
    .prepare("UPDATE invites SET token_hash = ? WHERE id = ? AND token_hash = ?")
    .bind(await sha256(newSecret(32)), invite.id, invite.token_hash)
    .run();
  return r.meta.changes > 0;
}

function deviceOf(request: Request): string {
  const ua = request.headers.get("user-agent") ?? "";
  const m = /\((?:iPhone|iPad|Android|Windows|Macintosh|Linux|CrOS)[^)]*\)/.exec(ua);
  return (m ? m[0].slice(1, -1).split(";")[0] : ua.split(" ")[0] || "a device").slice(0, 60);
}

function rp(url: URL): { rpID: string; origin: string } {
  return { rpID: url.hostname, origin: url.origin };
}

async function putChallenge(db: D1Database, kind: "register" | "login", invite: string | null, challenge: string, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(now),
    db
      .prepare("INSERT INTO auth_challenges (id, kind, invite, challenge, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, kind, invite, challenge, now + CHALLENGE_MS),
  ]);
  return id;
}

// Takes a challenge: one use, its kind and invite must match, not expired.
async function takeChallenge(db: D1Database, id: unknown, kind: "register" | "login", invite: string | null, now = Date.now()): Promise<string> {
  if (typeof id !== "string" || id.length > 64) throw new HttpError(400, "Start again: the sign in step was not found");
  const row = await db
    .prepare("SELECT challenge, invite FROM auth_challenges WHERE id = ? AND kind = ? AND expires_at > ?")
    .bind(id, kind, now)
    .first<{ challenge: string; invite: string | null }>();
  const taken = await db.prepare("DELETE FROM auth_challenges WHERE id = ?").bind(id).run();
  if (!row || !taken.meta.changes || row.invite !== invite) throw new HttpError(400, "Start again: the sign in step expired or was already used");
  return row.challenge;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(text);
  const out = new Uint8Array(new ArrayBuffer(enc.length));
  out.set(enc);
  return out;
}

// Who may make a passkey: an invite whose link was just opened and never
// claimed (the account is created by the first passkey), or a signed in
// person adding one for another device.
export async function registrationOptions(env: AccountEnv, url: URL, invite: InviteRow, signedIn: boolean) {
  if (!signedIn && invite.claimed_at) throw new HttpError(409, "This link was used already. Sign in with your passkey, or ask for a new link.");
  const existing = await env.DB.prepare("SELECT id, transports FROM credentials WHERE invite = ?")
    .bind(invite.id)
    .all<{ id: string; transports: string | null }>();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp(url).rpID,
    userName: invite.name,
    userDisplayName: invite.name,
    userID: bytesOf(invite.id),
    attestationType: "none",
    excludeCredentials: existing.results.map((c) => ({ id: c.id, transports: c.transports ? (JSON.parse(c.transports) as string[]) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await putChallenge(env.DB, "register", invite.id, options.challenge);
  return { options, challengeId };
}

export async function registrationVerify(
  env: AccountEnv,
  url: URL,
  request: Request,
  invite: InviteRow,
  signedIn: boolean,
  body: { challengeId?: unknown; response?: unknown },
): Promise<SignedIn & { created: boolean }> {
  const expectedChallenge = await takeChallenge(env.DB, body.challengeId, "register", invite.id);
  if (!body.response || typeof body.response !== "object") throw new HttpError(400, "The passkey answer is missing");
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp(url).origin,
      expectedRPID: rp(url).rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(400, `The passkey could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!verified.verified || !verified.registrationInfo) throw new HttpError(400, "The passkey could not be checked");
  const c = verified.registrationInfo.credential;
  const now = Date.now();
  let created = false;
  if (!signedIn) {
    // The claim: one statement, so two openings of the same link make one account.
    const claim = await env.DB.prepare("UPDATE invites SET claimed_at = ?, token_hash = ? WHERE id = ? AND claimed_at IS NULL AND deleted_at IS NULL")
      .bind(now, await sha256(newSecret(32)), invite.id)
      .run();
    if (!claim.meta.changes) throw new HttpError(409, "This link was used already. Sign in with your passkey, or ask for a new link.");
    created = true;
  }
  await env.DB.prepare(
    "INSERT INTO credentials (id, invite, public_key, counter, transports, device_type, backed_up, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      c.id,
      invite.id,
      b64url(c.publicKey),
      c.counter,
      c.transports ? JSON.stringify(c.transports) : null,
      verified.registrationInfo.credentialDeviceType,
      verified.registrationInfo.credentialBackedUp ? 1 : 0,
      now,
    )
    .run();
  const token = await newSession(env.DB, invite.id, deviceOf(request), now);
  return { ...signInAnswer(token, invite), created };
}

// Sign in on any device: a discoverable passkey, no name to type.
export async function loginOptions(env: AccountEnv, url: URL) {
  const options = await generateAuthenticationOptions({ rpID: rp(url).rpID, userVerification: "preferred" });
  const challengeId = await putChallenge(env.DB, "login", null, options.challenge);
  return { options, challengeId };
}

export async function loginVerify(env: AccountEnv, url: URL, request: Request, body: { challengeId?: unknown; response?: unknown }): Promise<SignedIn> {
  const expectedChallenge = await takeChallenge(env.DB, body.challengeId, "login", null);
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response !== "object" || typeof response.id !== "string") throw new HttpError(400, "The passkey answer is missing");
  const cred = await env.DB.prepare("SELECT * FROM credentials WHERE id = ?").bind(response.id.slice(0, 1024)).first<CredentialRow>();
  if (!cred) throw new HttpError(403, "That passkey is not known here");
  const invite = await env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(cred.invite).first<InviteRow>();
  if (!invite || invite.status === "revoked" || invite.deleted_at) throw new HttpError(403, "This account is closed");
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp(url).origin,
      expectedRPID: rp(url).rpID,
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: fromB64url(cred.public_key),
        counter: cred.counter,
        transports: cred.transports ? (JSON.parse(cred.transports) as never) : undefined,
      },
    });
  } catch (err) {
    throw new HttpError(403, `The passkey could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!verified.verified) throw new HttpError(403, "The passkey could not be checked");
  const now = Date.now();
  await env.DB.prepare("UPDATE credentials SET counter = ?, last_used = ? WHERE id = ?").bind(verified.authenticationInfo.newCounter, now, cred.id).run();
  const token = await newSession(env.DB, invite.id, deviceOf(request), now);
  return signInAnswer(token, invite);
}

// A one use link for a claimed account (the admin's "New link", or an email
// link): opening it signs this device in, and the link dies.
export async function claimLink(env: AccountEnv, request: Request, invite: InviteRow): Promise<SignedIn> {
  if (!invite.claimed_at) throw new HttpError(400, "This link makes an account first: add a passkey");
  if (invite.deleted_at || invite.status === "revoked") throw new HttpError(403, "This account is closed");
  if (!(await retireLink(env.DB, invite))) throw new HttpError(409, "This link was just used on another device. Ask for a new one if that was not you.");
  return signInAnswer(await newSession(env.DB, invite.id, deviceOf(request)), invite);
}

export async function logout(env: AccountEnv, session: SessionRow): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.token_hash).run();
}

export async function revokeSession(env: AccountEnv, invite: string, body: { hash?: unknown }): Promise<void> {
  if (typeof body.hash !== "string") throw new HttpError(400, "Which device?");
  await env.DB.prepare("DELETE FROM sessions WHERE invite = ? AND token_hash = ?").bind(invite, body.hash).run();
}

export function emailReady(env: AccountEnv): boolean {
  return !!(env.EMAIL_API_URL && env.EMAIL_API_KEY && env.EMAIL_FROM);
}

export async function accountInfo(env: AccountEnv, invite: InviteRow, session: SessionRow): Promise<AccountInfo> {
  const [creds, sessions, progress] = await Promise.all([
    env.DB.prepare("SELECT id, device_type, backed_up, created_at, last_used FROM credentials WHERE invite = ? ORDER BY created_at")
      .bind(invite.id)
      .all<CredentialRow>(),
    env.DB.prepare("SELECT token_hash, created_at, last_seen, last_sync, device FROM sessions WHERE invite = ? AND expires_at > ? ORDER BY created_at")
      .bind(invite.id, Date.now())
      .all<SessionRow>(),
    env.DB.prepare("SELECT kind, updated_at, device, LENGTH(data) AS size FROM progress WHERE invite = ?")
      .bind(invite.id)
      .all<{ kind: StoredKind; updated_at: number; device: string | null; size: number }>(),
  ]);
  return {
    id: invite.id,
    name: invite.name,
    claimedAt: invite.claimed_at ?? 0,
    admin: !!invite.admin,
    email: invite.email ? invite.email.replace(/^(.).*(@.*)$/, "$1…$2") : null,
    emailOffered: emailReady(env),
    passkeys: creds.results.map((c) => ({ id: c.id, createdAt: c.created_at, lastUsed: c.last_used, synced: c.backed_up === 1 })),
    devices: sessions.results.map((s) => ({
      hash: s.token_hash,
      device: s.device ?? "a device",
      since: s.created_at,
      lastSeen: s.last_seen,
      lastSync: s.last_sync ?? null,
      current: s.token_hash === session.token_hash,
    })),
    progress: progress.results.map((p) => ({ kind: p.kind, updatedAt: p.updated_at, device: p.device, size: p.size })),
  };
}

// Sign in links by email: the person sets an address from the account page
// (nothing else uses it), then any device can ask for a link. The answer is
// the same whether the address is known or not.
export async function setEmail(env: AccountEnv, invite: string, body: { email?: unknown }): Promise<{ ok: true }> {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "That does not look like an email address");
  await env.DB.prepare("UPDATE invites SET email = ? WHERE id = ?")
    .bind(email || null, invite)
    .run();
  return { ok: true };
}

export async function emailLink(env: AccountEnv, url: URL, body: { email?: unknown }): Promise<{ ok: true }> {
  if (!emailReady(env)) throw new HttpError(400, "Sign in by email is not set up here: ask the person who invited you for a new link");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (!email) throw new HttpError(400, "An email address is needed");
  const row = await env.DB.prepare("SELECT * FROM invites WHERE email = ? AND claimed_at IS NOT NULL AND deleted_at IS NULL AND status != 'revoked'")
    .bind(email)
    .first<InviteRow>();
  if (!row) return { ok: true };
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM account_links WHERE invite = ? AND created_at > ?")
    .bind(row.id, now - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) return { ok: true };
  const token = newSecret(32);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM account_links WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO account_links (token_hash, invite, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256(token),
      row.id,
      now,
      now + EMAIL_LINK_MS,
    ),
  ]);
  const link = `${url.origin}/#signin=${token}`;
  const res = await fetch(env.EMAIL_API_URL!, {
    method: "POST",
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email],
      subject: "Your Magic Merger sign in link",
      text: `Hello ${row.name}. Open this link on the device you want to play on; it works once, for 20 minutes:\n\n${link}\n\nIf you did not ask for it, ignore this message.`,
    }),
  }).catch(() => null);
  if (!res || !res.ok) console.error("email link not sent", res?.status);
  return { ok: true };
}

export async function emailClaim(env: AccountEnv, request: Request, body: { token?: unknown }): Promise<SignedIn> {
  const raw = typeof body.token === "string" ? body.token : "";
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(raw)) throw new HttpError(400, "That link is not right");
  const now = Date.now();
  const hash = await sha256(raw);
  const used = await env.DB.prepare("UPDATE account_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now, hash, now)
    .run();
  if (!used.meta.changes) throw new HttpError(403, "That link was used already or has expired: ask for a new one");
  const link = await env.DB.prepare("SELECT invite FROM account_links WHERE token_hash = ?").bind(hash).first<{ invite: string }>();
  const invite = link ? await env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(link.invite).first<InviteRow>() : null;
  if (!invite || invite.deleted_at || invite.status === "revoked") throw new HttpError(403, "This account is closed");
  return signInAnswer(await newSession(env.DB, invite.id, deviceOf(request), now), invite);
}

// Progress: three documents, each replaced whole. A device says what it
// last saw (`since`); a newer save from another device is refused with what
// is there, unless the device says `force` after the warning.
// 4.4.6: a save tagged with another account is refused (the page never sends
// one; this is the server's half of "progress belongs to one account").
// Discoveries are joined with what is stored (a union by key, the earliest
// time), so two devices that write in turn never erase each other's. An
// island forced over a newer one from elsewhere keeps the replaced one as
// the previous island, and a device can keep its own there before it loads
// another's: a choice between two islands never loses one.
export async function putProgress(env: AccountEnv, invite: string, body: ProgressPut, session: string | null = null, now = Date.now()) {
  const kind = PROGRESS_KINDS.find((k) => k === body.kind);
  if (!kind) throw new HttpError(400, "Which progress?");
  if (body.owner !== undefined && body.owner !== null && body.owner !== invite) {
    throw new HttpError(409, "This device's save belongs to another account: it stays on the device and is never sent to this one", { owner: "other" });
  }
  let data = typeof body.data === "string" ? body.data : JSON.stringify(body.data ?? null);
  if (data.length > PROGRESS_LIMITS[kind]) throw new HttpError(413, `That ${kind} save is too big to keep`);
  checkShape(kind, body.data);
  const device = typeof body.device === "string" ? body.device.slice(0, 60) : "a device";
  const synced = session ? env.DB.prepare("UPDATE sessions SET last_sync = ? WHERE token_hash = ?").bind(now, session) : null;
  if (body.previous === true) {
    if (kind !== "island") throw new HttpError(400, "Only an island is kept as the previous one");
    await env.DB.batch([upsert(env.DB, invite, "island_previous", data, now, device), ...(synced ? [synced] : [])]);
    return { ok: true as const, updatedAt: now };
  }
  const current = await env.DB.prepare(
    "SELECT updated_at, device, CASE WHEN kind = 'discoveries' THEN data END AS data FROM progress WHERE invite = ? AND kind = ?",
  )
    .bind(invite, kind)
    .first<{ updated_at: number; device: string | null; data: string | null }>();
  const since = typeof body.since === "number" ? body.since : 0;
  const newer = !!current && current.updated_at > since;
  if (newer && body.force !== true) {
    throw new HttpError(409, `A newer ${kind} save exists from ${current.device ?? "another device"}`, {
      updatedAt: current.updated_at,
      device: current.device,
    });
  }
  if (kind === "discoveries" && current?.data) {
    data = JSON.stringify(joinDiscoveries(parseList(current.data), body.data as unknown as Record<string, unknown>[]));
    if (data.length > PROGRESS_LIMITS.discoveries) throw new HttpError(413, "That discoveries save is too big to keep");
  }
  const writes = [upsert(env.DB, invite, kind, data, now, device)];
  if (kind === "island" && newer) {
    writes.unshift(
      env.DB.prepare(
        `INSERT INTO progress (invite, kind, data, updated_at, device) SELECT invite, 'island_previous', data, updated_at, device FROM progress WHERE invite = ? AND kind = 'island'
         ON CONFLICT (invite, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, device = excluded.device`,
      ).bind(invite),
    );
  }
  if (synced) writes.push(synced);
  await env.DB.batch(writes);
  return { ok: true as const, updatedAt: now };
}

function upsert(db: D1Database, invite: string, kind: StoredKind, data: string, now: number, device: string) {
  return db
    .prepare(
      `INSERT INTO progress (invite, kind, data, updated_at, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (invite, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, device = excluded.device`,
    )
    .bind(invite, kind, data, now, device);
}

function parseList(text: string): Record<string, unknown>[] {
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

// The union by key with the earliest time, as shared/account.ts merges them,
// keeping the element each device sent so another device can show it.
function joinDiscoveries(stored: Record<string, unknown>[], sent: Record<string, unknown>[]): Record<string, unknown>[] {
  const out = new Map<string, Record<string, unknown>>();
  for (const d of [...stored, ...sent]) {
    if (!d || typeof d.key !== "string" || typeof d.at !== "number") continue;
    const known = out.get(d.key);
    if (!known) out.set(d.key, { ...d });
    else {
      const at = known.at as number;
      if (d.at > 0 && (at === 0 || d.at < at))
        out.set(d.key, { ...known, ...d, recipe: d.recipe ?? known.recipe ?? null, element: d.element ?? known.element });
      else if (!known.element && d.element) known.element = d.element;
    }
  }
  return [...out.values()].slice(0, 5000);
}

function checkShape(kind: ProgressKind, data: unknown): void {
  const bad = (why: string) => new HttpError(400, `That ${kind} save cannot be read: ${why}`);
  if (kind === "discoveries") {
    if (!Array.isArray(data)) throw bad("not a list");
    for (const d of data as unknown[]) {
      const x = d as Record<string, unknown>;
      if (!x || typeof x.key !== "string" || x.key.length > 60 || typeof x.at !== "number") throw bad("an item has no key or time");
      if (
        x.recipe !== null &&
        x.recipe !== undefined &&
        !(Array.isArray(x.recipe) && x.recipe.length === 2 && x.recipe.every((r) => typeof r === "string" && r.length <= 60))
      )
        throw bad("a recipe is not a pair");
    }
    if ((data as unknown[]).length > 5000) throw bad("too many items");
  } else if (kind === "board") {
    const b = data as { chips?: unknown; next?: unknown };
    if (!b || !Array.isArray(b.chips) || b.chips.length > 300 || typeof b.next !== "number") throw bad("not a board");
    for (const c of b.chips as Record<string, unknown>[]) {
      if (!c || typeof c.key !== "string" || c.key.length > 60 || typeof c.x !== "number" || typeof c.y !== "number" || typeof c.id !== "number")
        throw bad("a chip is not a chip");
    }
  } else {
    const i = data as { gz?: unknown; size?: unknown; at?: unknown };
    if (!i || typeof i.gz !== "string" || !/^[A-Za-z0-9+/=]*$/.test(i.gz) || typeof i.at !== "number") throw bad("not a packed island");
    if (!["small", "medium", "large", "huge", "giant"].includes(i.size as string)) throw bad("no size");
  }
}

// The account's documents; 4.4.6: `kinds` asks for some only (the
// previous island is never sent unless asked for by name).
export async function getProgress(env: AccountEnv, invite: string, kinds: readonly StoredKind[] = PROGRESS_KINDS): Promise<{ progress: ProgressDoc[] }> {
  const rows = await env.DB.prepare(`SELECT kind, data, updated_at, device FROM progress WHERE invite = ? AND kind IN (${kinds.map(() => "?").join(", ")})`)
    .bind(invite, ...kinds)
    .all<{ kind: StoredKind; data: string; updated_at: number; device: string | null }>();
  return {
    progress: rows.results.map((r) => {
      let data: unknown = null;
      try {
        data = JSON.parse(r.data);
      } catch {
        data = null;
      }
      return { kind: r.kind, data, updatedAt: r.updated_at, device: r.device };
    }),
  };
}

// Everything the account holds, as one JSON document.
export async function exportAccount(env: AccountEnv, invite: InviteRow): Promise<Record<string, unknown>> {
  const db = env.DB;
  const id = invite.id;
  const all = async <T>(sql: string, ...binds: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...binds)
        .all<T>()
    ).results;
  const [
    credentials,
    sessions,
    progress,
    discoveries,
    votes,
    casts,
    ideas,
    ideaVotes,
    wins,
    reports,
    spend,
    days,
    dailyFinds,
    community,
    wonders,
    perf,
    refusals,
    writes,
  ] = await Promise.all([
    all<object>("SELECT id, device_type, backed_up, created_at, last_used FROM credentials WHERE invite = ?", id),
    all<object>("SELECT created_at, expires_at, last_seen, device FROM sessions WHERE invite = ?", id),
    (await getProgress(env, id, [...PROGRESS_KINDS, "island_previous"])).progress,
    all<object>("SELECT name, emoji, kind, tier, created_at FROM elements WHERE invite = ? ORDER BY created_at", id),
    all<object>("SELECT key, up, reason, at FROM votes WHERE player = ?", id),
    all<object>("SELECT pid, at FROM casts WHERE player = ?", id),
    all<object>("SELECT id, title, body, status, created_at FROM suggestions WHERE invite = ?", id),
    all<object>("SELECT suggestion, at FROM suggestion_votes WHERE invite = ?", id),
    all<object>("SELECT challenge, merges, spell, at FROM challenge_wins WHERE invite = ?", id),
    all<object>("SELECT name, reason, at, status FROM reports WHERE invite = ?", id),
    all<object>(
      "SELECT strftime('%Y-%m', at / 1000, 'unixepoch') AS month, call, COUNT(*) AS n, ROUND(SUM(usd), 4) AS usd FROM spend WHERE invite = ? GROUP BY month, call",
      id,
    ),
    // 4.5.1 (audit, A.A11, C.R40-8): every other row keyed by the account.
    all<object>("SELECT day FROM activity WHERE player = ? ORDER BY day", id),
    all<object>("SELECT day, result, found_at, found_pair FROM daily_challenges WHERE found_by = ?", id),
    all<object>("SELECT favorite, community_hidden, last_seen FROM invites WHERE id = ?", id),
    all<object>("SELECT kind, status, created_at FROM wonders WHERE source = 'player' AND key IN (SELECT key FROM elements WHERE invite = ?)", id),
    all<object>("SELECT at, ua, sample FROM perf WHERE invite = ?", id),
    all<object>("SELECT at, path, reason FROM refusals WHERE invite = ?", id),
    all<object>("SELECT key, cause, status, day, usd FROM writes WHERE invite = ?", id),
  ]);
  return {
    exportedAt: Date.now(),
    account: {
      id,
      name: invite.name,
      createdAt: invite.created_at,
      claimedAt: invite.claimed_at,
      email: invite.email,
      status: invite.status,
      cap: invite.cap_usd,
    },
    passkeys: credentials,
    devices: sessions,
    progress,
    firstDiscoveries: discoveries,
    votes,
    casts,
    ideas,
    ideaVotes,
    challengeWins: wins,
    reports,
    spend,
    daysPlayed: days,
    dailyFinds,
    community: community[0] ?? null,
    wondersFromYourFinds: wonders,
    frameTimes: perf,
    refusals,
    itemsWrittenAhead: writes,
  };
}

// Deletion: everything that is the person's goes; the shared library stays
// (an element they found first no longer names anyone), and spend keeps the
// random id so the month's budget stays whole. The invite row stays as
// deleted so the id is never reused and no link or passkey works again.
export async function deleteAccount(env: AccountEnv, invite: InviteRow): Promise<{ ok: true }> {
  // 4.4.6: the owner's account holds the game's own rows (every spend and
  // First Discovery of the admin since 3.4); it is never deleted.
  if (invite.admin) throw new HttpError(400, "The owner's account is never deleted: it holds the admin's rows since 3.4");
  const db = env.DB;
  const id = invite.id;
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM credentials WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM sessions WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM auth_challenges WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM account_links WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM progress WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM votes WHERE player = ?").bind(id),
    db.prepare("DELETE FROM casts WHERE player = ?").bind(id),
    db.prepare("DELETE FROM activity WHERE player = ?").bind(id),
    db.prepare("DELETE FROM suggestion_votes WHERE invite = ? OR suggestion IN (SELECT id FROM suggestions WHERE invite = ?)").bind(id, id),
    db.prepare("DELETE FROM suggestions WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM challenge_wins WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM reports WHERE invite = ?").bind(id),
    // 4.5.1 (audit, E.S10-19): the name copied on a wonder grown from their find, before the find loses its finder.
    db.prepare("UPDATE wonders SET by_name = NULL WHERE source = 'player' AND key IN (SELECT key FROM elements WHERE invite = ?)").bind(id),
    db.prepare("DELETE FROM perf WHERE invite = ?").bind(id),
    db.prepare("DELETE FROM refusals WHERE invite = ?").bind(id),
    db.prepare("UPDATE elements SET invite = NULL WHERE invite = ?").bind(id),
    db.prepare("UPDATE daily_challenges SET found_by = NULL WHERE found_by = ?").bind(id),
    db
      .prepare("UPDATE invites SET deleted_at = ?, status = 'revoked', email = NULL, favorite = NULL, token_hash = ? WHERE id = ?")
      .bind(now, await sha256(newSecret(32)), id),
  ]);
  return { ok: true };
}
