import { parseIntents, type Intent } from "../shared/promises";
import { syntaxError } from "../shared/spellcode";
import type { DesignAnswer } from "./oracle";
import type { LibraryDoc } from "./prompts";

// An API that grows from what spells lacked (3.4.1).
//
// 1. Every program's writer says, in one line, what the World API lacked for
//    it (`missing` in the spell answer). Each such line is a gap.
// 2. Once a day at most, when gaps from enough different spells are open, the
//    big model reads them, finds the ability most of them lacked (three spells
//    at least) and decides how the API grows:
//    helper   a function built from the API as it is, which spells call as
//             lib.name(w, ...). Sandboxed like any spell code. Its example
//             program goes through the test run (scripts/evolve-runner.ts) and
//             the helper goes live only if it passes.
//    hint     the API could already do it: one line joins the writers' prompt.
//    engine   the simulation itself must change: a proposal a developer
//             reviews (the runner opens a GitHub issue for it).
// 3. Live helpers and hints are listed in the prompt of every program written
//    after. A program that calls lib.name gets the helper's code appended to
//    it when it is stored, so it stays the program that was tested: changing
//    or retiring a helper never touches programs already written.
//
// Wards (src/sim/wards.ts) are what an engine proposal looks like: protection
// spells lacked a barrier that physics respects and a dome that does not hide
// the village, and no helper could have given them either.

export type ExtensionKind = "helper" | "hint" | "engine";
export type ExtensionStatus = "trial" | "live" | "retired" | "rejected" | "open" | "done";

export interface ExtensionRow {
  id: number;
  kind: ExtensionKind;
  name: string;
  signature: string;
  doc: string;
  code: string;
  example: string;
  spec: string;
  status: ExtensionStatus;
  intents: string | null;
  model: string;
  created_at: number;
  checked: string | null;
  issue: string | null;
}

export interface Library {
  docs: LibraryDoc[];
  helpers: { name: string; code: string }[];
}

const MAX_HELPERS = 30;
const MAX_HINTS = 12;
// A design is asked when open gaps come from at least this many spells, and at most this often.
export const DESIGN_MIN_SPELLS = 3;
export const DESIGN_EVERY_MS = 20 * 3600_000;
const NAME = /^[a-z][a-zA-Z0-9]{1,30}$/;

export async function liveLibrary(db: D1Database): Promise<Library> {
  const rows = await db
    .prepare("SELECT kind, name, signature, doc, code FROM extensions WHERE status = 'live' AND kind IN ('helper', 'hint') ORDER BY id DESC LIMIT ?")
    .bind(MAX_HELPERS + MAX_HINTS)
    .all<{ kind: "helper" | "hint"; name: string; signature: string; doc: string; code: string }>();
  const helpers = rows.results.filter((r) => r.kind === "helper").slice(0, MAX_HELPERS);
  const hints = rows.results.filter((r) => r.kind === "hint").slice(0, MAX_HINTS);
  return {
    docs: [...helpers, ...hints].map((r) => ({ kind: r.kind, name: r.name, signature: r.signature, doc: r.doc })),
    helpers: helpers.map((r) => ({ name: r.name, code: r.code })),
  };
}

// Appends the helpers a program calls, so it carries everything it was tested with.
export function withLibrary(code: string, helpers: { name: string; code: string }[]): string {
  if (/\b(?:const|let|var|function)\s+lib\b/.test(code)) return code;
  const used = helpers.filter((h) => new RegExp(`\\blib\\.${h.name}\\b`).test(code));
  if (!used.length) return code;
  return `${code}\n;const lib = {\n${used.map((h) => `${h.name}: ${h.code}`).join(",\n")},\n};\n`;
}

export async function recordGap(db: D1Database, key: string, pid: number | null, missing: string | undefined, now = Date.now()): Promise<void> {
  const text = (missing ?? "").trim();
  // "none", "nothing", "n/a": the model saying there was no gap.
  if (text.length < 8 || /^(none|nothing|n\/?a|no gap)\b/i.test(text)) return;
  await db.prepare("INSERT INTO gaps (key, pid, missing, at) VALUES (?, ?, ?, ?)").bind(key, pid, text.slice(0, 300), now).run();
}

export interface OpenGap {
  id: number;
  key: string;
  spell: string;
  tier: string;
  intents: string | null;
  missing: string;
}

// Unanswered gaps, the latest of each spell, newest spells first.
export async function openGaps(db: D1Database, limit = 80): Promise<OpenGap[]> {
  const rows = await db
    .prepare(
      `SELECT g.id, g.key, g.missing, e.name, e.tier, e.intents FROM gaps g LEFT JOIN elements e ON e.key = g.key
       WHERE g.extension IS NULL AND g.id = (SELECT MAX(id) FROM gaps h WHERE h.key = g.key AND h.extension IS NULL)
       ORDER BY g.id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; key: string; missing: string; name: string | null; tier: string | null; intents: string | null }>();
  return rows.results.map((r) => ({ id: r.id, key: r.key, spell: r.name ?? r.key, tier: r.tier ?? "major", intents: r.intents, missing: r.missing }));
}

export async function designDue(db: D1Database, now = Date.now()): Promise<boolean> {
  const last = await db.prepare("SELECT MAX(created_at) AS at FROM extensions").first<{ at: number | null }>();
  if (last?.at && now - last.at < DESIGN_EVERY_MS) return false;
  const spells = await db.prepare("SELECT COUNT(DISTINCT key) AS n FROM gaps WHERE extension IS NULL").first<{ n: number }>();
  return (spells?.n ?? 0) >= DESIGN_MIN_SPELLS;
}

// Checks what the designer wrote and stores it. Returns why it was refused, or the new row's id.
export async function storeDesign(
  db: D1Database,
  answer: DesignAnswer,
  gaps: OpenGap[],
  model: string,
  now = Date.now(),
): Promise<{ id: number; kind: ExtensionKind; status: ExtensionStatus } | { refused: string }> {
  if (answer.decision === "none") return { refused: "no ability was shared by three spells" };
  const answered = gaps.filter((g) => answer.answers.includes(g.id));
  if (new Set(answered.map((g) => g.key)).size < DESIGN_MIN_SPELLS) return { refused: `it answers ${answered.length} spells, fewer than ${DESIGN_MIN_SPELLS}` };
  const name = answer.name.trim();
  if (!NAME.test(name)) return { refused: `"${name}" is not a usable name` };
  const taken = await db
    .prepare("SELECT 1 AS x FROM extensions WHERE name = ? AND kind = ? AND status IN ('trial', 'live', 'open')")
    .bind(name, answer.decision === "exists" ? "hint" : answer.decision)
    .first();
  if (taken) return { refused: `${name} exists already` };
  let kind: ExtensionKind;
  let status: ExtensionStatus;
  if (answer.decision === "helper") {
    const problem = helperProblem(name, answer.code, answer.example);
    if (problem) return { refused: problem };
    kind = "helper";
    status = "trial";
  } else if (answer.decision === "exists") {
    if (answer.doc.trim().length < 10) return { refused: "the hint is empty" };
    kind = "hint";
    status = "live";
  } else {
    if (answer.spec.trim().length < 20) return { refused: "the proposal is empty" };
    kind = "engine";
    status = "open";
  }
  const intents = mostCommon(answered.flatMap((g) => parseIntents(g.intents)));
  const r = await db
    .prepare(
      `INSERT INTO extensions (kind, name, signature, doc, code, example, spec, status, intents, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(kind, name, answer.signature.trim(), answer.doc.trim(), answer.code.trim(), answer.example.trim(), answer.spec.trim(), status, intents, model, now)
    .run();
  const id = Number(r.meta.last_row_id);
  const marks = answered.map(() => "?").join(", ");
  // Every open gap of the answered spells, not only the latest of each.
  await db
    .prepare(`UPDATE gaps SET extension = ? WHERE extension IS NULL AND key IN (${marks})`)
    .bind(id, ...answered.map((g) => g.key))
    .run();
  return { id, kind, status };
}

// Why a helper cannot be stored: it does not parse, its example does not
// call it, or it reaches for what spell code may not use.
export function helperProblem(name: string, code: string, example: string): string | null {
  if (!/^\s*function\s*\*?\s*\(/.test(code)) return "the helper is not a function expression";
  const err = syntaxError(`const f = ${code};`);
  if (err) return `the helper does not parse: ${err}`;
  if (/\byield\b/.test(code)) return "the helper yields; it must return at once";
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts|eval|Function|globalThis|window|document|self|localStorage|setTimeout|setInterval)\b/.test(code))
    return "the helper uses something spell code may not";
  if (!new RegExp(`\\blib\\.${name}\\b`).test(example)) return "the example does not call the helper";
  const exampleErr = syntaxError(example);
  if (exampleErr) return `the example does not parse: ${exampleErr}`;
  return null;
}

function mostCommon(list: Intent[]): string | null {
  const counts = new Map<Intent, number>();
  for (const i of list) counts.set(i, (counts.get(i) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// Helpers waiting for their test run, with their example ready to cast.
export async function trialHelpers(db: D1Database): Promise<{ id: number; name: string; code: string; intents: string[] }[]> {
  const rows = await db.prepare("SELECT * FROM extensions WHERE kind = 'helper' AND status = 'trial' ORDER BY id").all<ExtensionRow>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    code: withLibrary(r.example, [{ name: r.name, code: r.code }]),
    intents: parseIntents(r.intents),
  }));
}

// The test run of a helper's example came back: live if it passed.
export async function settleHelper(db: D1Database, id: number, ok: boolean, detail: string, now = Date.now()): Promise<ExtensionStatus | null> {
  const row = await db.prepare("SELECT status FROM extensions WHERE id = ? AND kind = 'helper'").bind(id).first<{ status: ExtensionStatus }>();
  if (!row || row.status !== "trial") return row?.status ?? null;
  const status: ExtensionStatus = ok ? "live" : "rejected";
  await db
    .prepare("UPDATE extensions SET status = ?, checked = ? WHERE id = ?")
    .bind(status, JSON.stringify({ ok, detail: detail.slice(0, 400), at: now }), id)
    .run();
  // A rejected helper leaves its gaps open, for the next design to try again.
  if (!ok) await db.prepare("UPDATE gaps SET extension = NULL WHERE extension = ?").bind(id).run();
  return status;
}

export async function evolution(db: D1Database) {
  const extensions = await db
    .prepare("SELECT e.*, (SELECT COUNT(DISTINCT key) FROM gaps g WHERE g.extension = e.id) AS spells FROM extensions e ORDER BY id DESC LIMIT 100")
    .all<ExtensionRow & { spells: number }>();
  return { open: await openGaps(db, 200), extensions: extensions.results };
}
