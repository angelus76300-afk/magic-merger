import { elementKey } from "../shared/elements";
import { FORMS, formOf, isForm, kindOfForm, type Form } from "../shared/forms";
import { parseIntents, type Intent } from "../shared/promises";
import type { Oracle } from "./oracle";

// The library sorted again (4.6, ROADMAP 4.6 item 5). Every element is
// given one of the seven kinds by the small model from its name alone (the
// entries written before the kinds often made a person a trinket: Warlock
// "a slender black-iron cage"), a page of names at a time,
// and the answers are stored as proposals (`forms`): nothing about an element
// changes until the owner has seen the list. Applying a proposal sets
// `elements.form` where it was never set, and only when the kind it implies
// is the element's own (spell or artifact); one that would turn a spell into
// an artifact, or back, is listed apart and applied only by name, with flip.
// The rewrites by form then go through the refresh (startRefresh, forms: true),
// a capped batch at a time, never all at once.

export const FORMS_PAGE = 60;

// A key asked again by name after its rewrite for its kind: kept out (its
// test run failed it, or the judge), or used and found wrong since (the
// owner's Serpent raised a shield, 7 November; startRefresh asks a reason
// for that one). Only while its live program
// is still the one that verdict left (the kept one, or the one it put live),
// nothing was asked for it since, and it was written for its kind fewer than
// three times (mayAskAgain decides; the review of #63: a retry's rewrite is
// older than the verdict it leads to). Bound to a JSON list of keys. Read by
// startRefresh (worker/index.ts).
export const AGAIN_BY_FORM_SQL = `SELECT s.key, s.pid, v.reason, v.replaced,
    (SELECT COUNT(*) FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh' AND r.at >= f.applied_at AND r.status NOT IN ('failed', 'superseded')) AS n
  FROM spells s JOIN forms f ON f.key = s.key
  JOIN refresh_verdicts v ON v.key = s.key AND v.at = (SELECT MAX(at) FROM refresh_verdicts WHERE key = s.key)
  WHERE s.key IN (SELECT value FROM json_each(?)) AND f.status = 'applied' AND v.at >= f.applied_at
    AND ((v.replaced = 0 AND v.from_pid = s.pid) OR (v.replaced = 1 AND v.to_pid = s.pid))
    AND NOT EXISTS (SELECT 1 FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh' AND r.at > v.at AND r.status NOT IN ('failed', 'superseded'))
    AND (SELECT COUNT(*) FROM rewrites r WHERE r.key = s.key AND r.cause = 'refresh' AND r.at >= f.applied_at AND r.status NOT IN ('failed', 'superseded')) < 4`;

// Whether a key AGAIN_BY_FORM_SQL found is written once more. Written for its
// kind once (n = 1): a kept one is retried, told why it was kept; one put live
// only for a reason given (`why`). Twice (n = 2): only as a fix with a reason
// (the owner's Serpent kept a shield after both). A fourth time only with a
// new entry given by name: the item itself changes (the owner chose a hunting
// Serpent over the garden one its entry described). Never a fifth.
export function mayAskAgain(found: { replaced: number; n: number }, why: string | null, entry = false): boolean {
  if (entry) return found.n < 4;
  if (found.n < 2) return !found.replaced || !!why;
  return found.n < 3 && !!why;
}

// An entry given by name for a rewrite by form (`entries`): plain text the
// grimoire shows, 40 to 600 characters, or nothing.
export function givenEntry(entries: unknown, key: string): string | null {
  const v = entries && typeof entries === "object" ? (entries as Record<string, unknown>)[key] : undefined;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 40 && t.length <= 600 ? t : null;
}

// The promise a rewrite by form was written for, when it was read again from
// its new entry (`newIntents`): its test run holds the candidate to it
// (refreshCandidates), and it goes live with the program (refreshVerdict).
// Null when the request kept the stored promise, cannot be read, or carries
// no promise at all: an empty one never replaces the stored one (the review
// of #65: a failed read would have cleared the live item's promise).
export function requestIntents(request: string | null): Intent[] | null {
  try {
    const req = JSON.parse(request ?? "{}") as { newIntents?: unknown; intents?: unknown };
    const intents = req.newIntents === true && Array.isArray(req.intents) ? parseIntents(req.intents) : [];
    return intents.length ? intents : null;
  } catch {
    return null;
  }
}

interface ElementRow {
  key: string;
  name: string;
  kind: string;
  form: string | null;
  description: string | null;
}

// Sorts up to `limit` elements that have no proposal yet, 180 at most: three
// calls, about a minute, so the answer comes back before the edge's 100 s. `hold` holds the
// budget for one page before its call.
export async function proposeForms(
  db: D1Database,
  oracle: Oracle,
  hold: () => Promise<void>,
  limit = 240,
): Promise<{ asked: number; stored: number; left: number }> {
  const rows = (
    await db
      .prepare(
        "SELECT e.key, e.name, e.kind, e.form, e.description FROM elements e WHERE NOT EXISTS (SELECT 1 FROM forms f WHERE f.key = e.key) ORDER BY e.depth, e.key LIMIT ?",
      )
      .bind(Math.max(1, Math.min(180, limit)))
      .all<ElementRow>()
  ).results;
  let stored = 0;
  const now = Date.now();
  for (let k = 0; k < rows.length; k += FORMS_PAGE) {
    const page = rows.slice(k, k + FORMS_PAGE);
    await hold();
    const answers = await oracle.forms(page.map((r) => ({ name: r.name, kind: r.kind === "spell" ? "spell" : "artifact", description: r.description ?? "" })));
    const byKey = new Map(answers.map((a) => [elementKey(a.name), a]));
    for (const r of page) {
      const a = byKey.get(r.key);
      if (!a) continue;
      const was = formOf({ name: r.name, kind: r.kind, form: r.form });
      await db
        .prepare("INSERT OR IGNORE INTO forms (key, form, was, reason, model, at, status) VALUES (?, ?, ?, ?, ?, ?, 'proposed')")
        .bind(r.key, a.form, r.form ? r.form : `guess:${was}`, a.why, oracle.mock ? "mock" : "small", now)
        .run();
      stored++;
    }
  }
  const left = (await db.prepare("SELECT COUNT(*) AS n FROM elements e WHERE NOT EXISTS (SELECT 1 FROM forms f WHERE f.key = e.key)").first<{ n: number }>())
    ?.n;
  return { asked: rows.length, stored, left: left ?? 0 };
}

export interface FormRow {
  key: string;
  name: string;
  kind: string;
  form: Form;
  was: string | null;
  why: string;
  status: string;
  // The kind it is written as now: its live program's, or none.
  written: string | null;
  casts: number;
  // Spell to artifact, or back: applied only by name, with flip.
  flips: boolean;
}

// Every proposal, with what its live program was written as and how often it
// is cast, the ones that flip between spell and artifact first, then by kind.
export async function formList(db: D1Database): Promise<{ counts: Record<string, number>; flips: FormRow[]; rows: FormRow[] }> {
  const rows = (
    await db
      .prepare(
        `SELECT f.key, e.name, e.kind, f.form, f.was, f.reason, f.status,
           (SELECT p.spec FROM spells s JOIN programs p ON p.id = s.pid WHERE s.key = f.key) AS spec,
           (SELECT COUNT(*) FROM casts c JOIN programs p ON p.id = c.pid WHERE p.key = f.key) AS casts
         FROM forms f JOIN elements e ON e.key = f.key ORDER BY f.form, casts DESC, e.name`,
      )
      .all<{
        key: string;
        name: string;
        kind: string;
        form: string;
        was: string | null;
        reason: string | null;
        status: string;
        spec: string | null;
        casts: number;
      }>()
  ).results;
  const out: FormRow[] = [];
  const counts: Record<string, number> = Object.fromEntries(FORMS.map((f) => [f, 0]));
  for (const r of rows) {
    if (!isForm(r.form)) continue;
    let written: string | null = null;
    try {
      const v = JSON.parse(r.spec ?? "null") as { form?: unknown } | null;
      written = v ? (isForm(v.form) ? v.form : "unsorted") : null;
    } catch {
      written = null;
    }
    counts[r.form]++;
    out.push({
      key: r.key,
      name: r.name,
      kind: r.kind,
      form: r.form,
      was: r.was,
      why: r.reason ?? "",
      status: r.status,
      written,
      casts: r.casts,
      flips: kindOfForm(r.form) !== r.kind,
    });
  }
  return { counts, flips: out.filter((r) => r.flips), rows: out };
}

// Applies proposals the owner approved: by key, or every one that does not
// flip. A flip needs its key and flip: true, and changes the element's kind too.
export async function applyForms(
  db: D1Database,
  body: { keys?: unknown; all?: unknown; flip?: unknown; decline?: unknown },
): Promise<{ applied: string[]; declined: string[]; skipped: string[] }> {
  const asked = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string").map(elementKey) : null;
  if (!asked && body.all !== true) throw new Error("keys or all: true");
  const rows = (
    await db
      .prepare("SELECT f.key, f.form, e.kind, e.form AS stored FROM forms f JOIN elements e ON e.key = f.key WHERE f.status = 'proposed'")
      .all<{ key: string; form: string; kind: string; stored: string | null }>()
  ).results.filter((r) => !asked || asked.includes(r.key));
  const out = { applied: [] as string[], declined: [] as string[], skipped: [] as string[] };
  const now = Date.now();
  for (const r of rows) {
    if (body.decline === true) {
      await db.prepare("UPDATE forms SET status = 'declined' WHERE key = ? AND status = 'proposed'").bind(r.key).run();
      out.declined.push(r.key);
      continue;
    }
    if (!isForm(r.form) || r.stored) {
      out.skipped.push(r.key);
      continue;
    }
    const kind = kindOfForm(r.form);
    const flips = kind !== r.kind;
    if (flips && !(asked && body.flip === true)) {
      out.skipped.push(r.key);
      continue;
    }
    await db.batch([
      flips
        ? db.prepare("UPDATE elements SET form = ?, kind = ? WHERE key = ? AND form IS NULL").bind(r.form, kind, r.key)
        : db.prepare("UPDATE elements SET form = ? WHERE key = ? AND form IS NULL").bind(r.form, r.key),
      db.prepare("UPDATE forms SET status = 'applied', applied_at = ? WHERE key = ?").bind(now, r.key),
    ]);
    out.applied.push(r.key);
  }
  return out;
}
