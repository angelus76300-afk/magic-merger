import { PRIMITIVES, elementKey } from "../shared/elements";
import type { CommunityResponse, Friend, ProfileChange } from "../shared/community";
import { isTier } from "../shared/tiers";
import type { ElementKind } from "../shared/types";
import { HttpError } from "./http";

// 4.5: the Community tab (docs/DESIGN.md, "The Community tab"). Who plays,
// when they last played, how many items they found (their synced
// discoveries), their First Discoveries and daily challenges found first,
// and the favorite spell they picked from their own discoveries. Never a
// recipe. A player hidden from the tab is in nobody's list, theirs included.

interface Row {
  id: string;
  name: string;
  admin: number;
  last_seen: number | null;
  session_seen: number | null;
  found: number | null;
  firsts: number;
  daily: number;
  favorite: string | null;
  community_hidden: number;
  f_name: string | null;
  f_emoji: string | null;
  f_kind: ElementKind | null;
  f_tier: string | null;
}

export async function community(db: D1Database, invite: string): Promise<CommunityResponse> {
  const rows = await db
    .prepare(
      `SELECT i.id, i.name, i.admin, i.last_seen, i.favorite, i.community_hidden,
         (SELECT MAX(s.last_seen) FROM sessions s WHERE s.invite = i.id) AS session_seen,
         (SELECT json_array_length(p.data) FROM progress p WHERE p.invite = i.id AND p.kind = 'discoveries') AS found,
         (SELECT COUNT(*) FROM elements e WHERE e.invite = i.id) AS firsts,
         (SELECT COUNT(*) FROM daily_challenges d WHERE d.found_by = i.id) AS daily,
         f.name AS f_name, f.emoji AS f_emoji, f.kind AS f_kind, f.tier AS f_tier
       FROM invites i LEFT JOIN elements f ON f.key = i.favorite
       WHERE i.deleted_at IS NULL AND i.status != 'revoked'`,
    )
    .all<Row>();
  const me = rows.results.find((r) => r.id === invite);
  const friends: Friend[] = rows.results
    .filter((r) => !r.community_hidden)
    .map((r) => ({ r, played: Math.max(r.last_seen ?? 0, r.session_seen ?? 0) || null }))
    // Someone who never played (a link not opened yet) is not "who plays".
    .filter(({ r, played }) => played || r.firsts > 0 || r.id === invite)
    .map(({ r, played }) => ({
      name: r.admin && r.name === "admin" ? "The owner" : r.name,
      me: r.id === invite,
      // 4.5.1 (audit, A.C4): to the hour, not to the five minutes a session
      // is seen: the tab says "today" or "this week", and friends need no more.
      lastPlayed: played ? Math.floor(played / 3_600_000) * 3_600_000 : null,
      // 4.5.1 (audit, A.C2): the synced list starts with the eight primal
      // forces, which nobody found.
      found: r.found === null || r.found === undefined ? null : Math.max(0, r.found - PRIMITIVES.length),
      firsts: r.firsts,
      daily: r.daily,
      favorite: r.favorite ? favoriteCard(r) : null,
      ...(r.admin && !played ? { unrecorded: true } : {}),
    }))
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  return { friends, me: { favorite: me?.favorite ?? null, hidden: !!me?.community_hidden, card: me?.favorite ? favoriteCard(me) : null } };
}

function favoriteCard(r: Row): Friend["favorite"] {
  const primitive = PRIMITIVES.find((p) => elementKey(p.name) === r.favorite);
  if (primitive) return { name: primitive.name, emoji: primitive.emoji, kind: primitive.kind, tier: primitive.tier ?? null };
  if (!r.f_name) return null;
  return { name: r.f_name, emoji: r.f_emoji ?? "✨", kind: r.f_kind ?? "spell", tier: isTier(r.f_tier) ? r.f_tier : null };
}

// The player's own choices. A favorite must be a spell they found: in their
// synced discoveries when they have an account, a spell of the pool when
// they play with a link only (their discoveries live in that browser).
export async function setProfile(db: D1Database, invite: string, body: ProfileChange): Promise<CommunityResponse["me"]> {
  if (body.favorite !== undefined) {
    let favorite: string | null = null;
    if (body.favorite !== null) {
      if (typeof body.favorite !== "string" || !body.favorite.trim() || body.favorite.length > 60) throw new HttpError(400, "Which spell?");
      const key = elementKey(body.favorite);
      const primitive = PRIMITIVES.find((p) => elementKey(p.name) === key);
      const element = primitive ?? (await db.prepare("SELECT kind FROM elements WHERE key = ?").bind(key).first<{ kind: ElementKind }>());
      if (!element) throw new HttpError(400, "Nobody has discovered that yet");
      if (element.kind !== "spell") throw new HttpError(400, "A favorite spell must be a spell");
      const open = await db.prepare("SELECT 1 AS n FROM daily_challenges WHERE result = ? AND found_at IS NULL").bind(key).first<{ n: number }>();
      if (open) throw new HttpError(400, "Nobody has discovered that yet");
      const doc = await db.prepare("SELECT 1 AS n FROM progress WHERE invite = ? AND kind = 'discoveries'").bind(invite).first<{ n: number }>();
      if (doc) {
        const owned = await db
          .prepare(
            "SELECT 1 AS n FROM progress p, json_each(p.data) j WHERE p.invite = ? AND p.kind = 'discoveries' AND json_extract(j.value, '$.key') = ? LIMIT 1",
          )
          .bind(invite, key)
          .first<{ n: number }>();
        if (!owned && !primitive) throw new HttpError(400, "Your favorite must be one of your own discoveries");
      }
      favorite = key;
    }
    await db.prepare("UPDATE invites SET favorite = ? WHERE id = ?").bind(favorite, invite).run();
  }
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== "boolean") throw new HttpError(400, "Hidden or not?");
    await db
      .prepare("UPDATE invites SET community_hidden = ? WHERE id = ?")
      .bind(body.hidden ? 1 : 0, invite)
      .run();
  }
  const row = await db
    .prepare("SELECT favorite, community_hidden FROM invites WHERE id = ?")
    .bind(invite)
    .first<{ favorite: string | null; community_hidden: number }>();
  return { favorite: row?.favorite ?? null, hidden: !!row?.community_hidden };
}
