// The refresh of the legacy library (3.7 part E): decides each candidate the
// Batch API wrote. For each one:
//   1. its test run in Node (src/sim/check.ts), with its element's promise
//      probe and, for an artifact, the five minute test: a failure keeps the old;
//   2. frames of the old and the new program on the same Spell Lab island,
//      at the same moments, saved to OUT (default refresh-frames/);
//   3. the judge on both (/api/admin/judge-trial, nothing stored): the new one
//      replaces the old only if it scores no lower, and its creatures look no
//      less alive. Votes then roll it back if players like it less.
//
//   MM_URL=... MM_TOKEN=<ADMIN_TOKEN> npx esbuild scripts/refresh-runner.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/refresh-runner.mjs --external:playwright && node node_modules/.cache/refresh-runner.mjs [limit]
//
// DRY=1: decides nothing, only prints what it would do and saves the frames
// (the dry run of 20 the owner looks at before the rest).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../src/sim/check";
import type { Tier } from "../shared/tiers";
// @ts-expect-error plain JavaScript, shared with the other lab scripts
import { factsOf, openLab } from "./lab-browser.mjs";
import { adminApi } from "./admin-api";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const dry = process.env.DRY === "1";
const out = process.env.OUT ?? "refresh-frames";
const limit = Number(process.argv[2]) || 20;
mkdirSync(out, { recursive: true });

const api = adminApi(url, token!);

interface Candidate {
  id: number;
  key: string;
  name: string;
  kind: "spell" | "artifact";
  // 4.6: written as this kind (shared/forms.ts), and said to be giant.
  form?: string;
  giant?: boolean;
  tier: Tier;
  intents: string[];
  model: string;
  code: string;
  oldId: number | null;
  oldCode: string;
  dry: boolean;
}

const shotsFor = (tier: Tier) => (tier === "legendary" || tier === "cosmic" ? [2, 6, 12] : [1, 3, 6]);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const list = ((await api(`/api/admin/refresh-candidates?limit=${limit}`)) as Candidate[]).filter((c) => !dry || c.dry);
console.log(`${list.length} candidates${dry ? " (dry run: nothing is decided)" : ""}`);
let lab = await openLab();
const summary: Record<string, unknown>[] = [];
try {
  for (const c of list) {
    // A cast that kills the browser (a page crash after many casts) leaves
    // this one undecided, and the next starts in a fresh browser.
    try {
      const req = { key: c.key, name: c.name, tier: c.tier, code: c.code, intents: c.intents, kind: c.kind, form: c.form, giant: c.giant };
      const check = runCheck(req);
      const old = c.oldCode ? runCheck({ ...req, code: c.oldCode }) : null;
      const shots = shotsFor(c.tier);
      const frames: Record<string, { png: string }[]> = {};
      const judged: Record<string, { score: number; alive: string; note: string } | null> = { old: null, new: null };
      for (const [which, code] of [
        ["old", c.oldCode],
        ["new", c.code],
      ] as const) {
        if (!code) continue;
        const r = await lab.cast(code, { tier: c.tier, shots, jpeg: true });
        frames[which] = r.frames;
        r.frames.forEach((f: { png: string }, i: number) =>
          writeFileSync(join(out, `${slug(c.name)}.${which}.${i}.jpg`), Buffer.from(f.png.split(",")[1], "base64")),
        );
        if (which === "new" && !check.ok) continue;
        judged[which] = await api("/api/admin/judge-trial", { name: c.name, frames: r.frames.map((f: { png: string }) => f.png), shots, facts: factsOf(r) });
      }
      const o = judged.old;
      const n = judged.new;
      let replace = false;
      let reason: string;
      // 4.6: an old program that is not the kind of thing its item is (a Serpent
      // of stone spheres, a Village that is a charm) fails the same test run;
      // the judge's score of it then decides nothing.
      const wrongKind = !!c.form && !!old && (old.problem === "kind" || old.problem === "size");
      if (!check.ok) reason = `its test run failed (${check.problem}): ${check.detail}`;
      else if (!n) reason = "the judge did not answer";
      else if (wrongKind) {
        replace = true;
        reason = `the old one is not ${c.form === "object" ? "an object" : `a ${c.form}`} of its size (${old!.problem}); the new one passed its test run, judged ${n.score}${o ? ` against ${o.score}` : ""}`;
      } else if (o && n.score < o.score) reason = `the judge scored it lower (${n.score} against ${o.score})`;
      else if (o && o.alive === "yes" && n.alive === "no") reason = "its creatures looked less alive";
      else {
        replace = true;
        reason = o ? `passed its test run, judged ${n.score} against ${o.score}` : `passed its test run, judged ${n.score}`;
      }
      const row = {
        name: c.name,
        tier: c.tier,
        model: c.model,
        replace,
        reason,
        oldScore: o?.score ?? null,
        newScore: n?.score ?? null,
        oldAlive: o?.alive,
        newAlive: n?.alive,
        oldTest: old ? (old.ok ? "pass" : old.problem) : "none",
        newTest: check.ok ? "pass" : check.problem,
        newNote: n?.note ?? "",
      };
      summary.push(row);
      console.log(`${c.name} (${c.tier}, ${c.model}): ${replace ? (dry ? "would replace" : "replaced") : "keeps the old"}: ${reason}`);
      if (!dry)
        await api("/api/admin/refresh-verdict", { id: c.id, replace, reason, oldScore: o?.score, newScore: n?.score, checked: { ...check, at: Date.now() } });
    } catch (err) {
      console.log(`${c.name}: skipped, undecided (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
      await lab.close().catch(() => {});
      lab = await openLab();
    }
  }
} finally {
  await lab.close();
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1));
}
