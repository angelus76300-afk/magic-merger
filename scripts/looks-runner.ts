// The looks revamp's runner (roadmap 5.2.5, worker/looks.ts). Talks to a deployed Worker with the
// admin token; every paid call is the Worker's, billed to LOOKS_BUDGET_USD, which stops it.
//
//   start --pilot [measure.json]  the pilot: the 20 plainest items that draw a w.model in phase 0's
//                                 measure (docs/measurements/looks-<date>.json), plus 10 wonders
//   start                         the next ones in the bulk order, up to the night's $3 (LOOKS=bulk)
//   decide [limit]                for each candidate: its test run, frames of the old look and the
//                                 new at medium quality, the Worker's judge, and the verdict
//   report                        what the revamp spent and decided
//
//   MM_URL=... MM_TOKEN=<ADMIN_TOKEN> npx esbuild scripts/looks-runner.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/looks-runner.mjs --external:playwright && node node_modules/.cache/looks-runner.mjs decide
//
// DRY=1 with decide: frames only, no judge and no verdict (nothing is paid or decided).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../src/sim/check";
import { checkWonderDef } from "../src/sim/wondercheck";
import { readDef } from "../src/sim/wonders";
import type { Tier } from "../shared/tiers";
// @ts-expect-error plain JavaScript, shared with the other lab scripts
import { openLab } from "./lab-browser.mjs";
import { adminApi } from "./admin-api";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const api = adminApi(url, token, { retries: 2 });
const [mode = "report", ...rest] = process.argv.slice(2);
const dry = process.env.DRY === "1";
const out = process.env.OUT ?? "looks-frames";

interface Candidate {
  id: number;
  target: "program" | "wonder";
  key: string | null;
  name: string;
  kind: "spell" | "artifact";
  form: string | null;
  tier: Tier;
  intents: string[];
  reach: number | null;
  model: string;
  plan: string | null;
  oldCode: string;
  code: string;
  wonder?: Record<string, unknown>;
}

// The pilot's items: the plainest that draw a w.model of their own (a creature's body is not a
// w.model call, so the look-only writer has nothing to redraw there).
function pilotKeys(file: string | undefined): string[] {
  const dir = "docs/measurements";
  const path =
    file ??
    join(
      dir,
      readdirSync(dir)
        .filter((f) => /^looks-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .at(-1) ?? "",
    );
  const m = JSON.parse(readFileSync(path, "utf8")) as { plainest100: { key: string; models: number; kind: string }[] };
  console.log(`pilot from ${path}`);
  return m.plainest100
    .filter((r) => r.models > 0 && r.kind !== "wonder")
    .slice(0, 20)
    .map((r) => r.key);
}

async function start(): Promise<void> {
  const pilot = rest[0] === "--pilot";
  const body = pilot ? { keys: pilotKeys(rest[1]), wonders: 10 } : {};
  const r = await api("/api/admin/looks", body);
  console.log(
    `queued ${r.queued.length} (${r.queued.join(", ")}); skipped ${r.skipped.length} with nothing to redraw; held $${r.estimate}; $${r.room} left tonight`,
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function decide(): Promise<void> {
  const limit = Number(rest[0]) || 20;
  const list = (await api(`/api/admin/looks-candidates?limit=${limit}`)) as Candidate[];
  console.log(`${list.length} candidates${dry ? " (dry: frames only, nothing paid or decided)" : ""}`);
  mkdirSync(out, { recursive: true });
  let lab = await openLab({ width: 700, height: 830 });
  const summary: Record<string, unknown>[] = [];
  try {
    for (const c of list) {
      try {
        // The usual test: a wonder's island test, or the program's test run with its promise and kind.
        let tested: boolean;
        let detail: string;
        if (c.target === "wonder") {
          const def = readDef({ ...c.wonder, code: c.code });
          const v = def ? checkWonderDef(def) : null;
          tested = !!v?.ok;
          detail = v ? v.detail : "its definition does not read";
        } else {
          const req = { key: c.key ?? c.name, name: c.name, tier: c.tier, code: c.code, intents: c.intents, kind: c.kind, form: c.form ?? undefined };
          const now = runCheck(req as Parameters<typeof runCheck>[0]);
          tested = now.ok;
          detail = now.ok ? "passed" : `${now.problem}: ${now.detail}`;
        }
        // Frames of the old look and the new, alike: medium quality (a phone's start), the camera on the newest model.
        const shots = c.tier === "legendary" || c.tier === "cosmic" ? [2, 6] : [1, 3];
        const frames: Record<string, string[]> = {};
        for (const [which, code] of [
          ["old", c.oldCode],
          ["new", c.code],
        ] as const) {
          const r = await lab.cast(code, {
            tier: c.target === "wonder" ? "grand" : c.tier,
            shots,
            jpeg: true,
            quality: "medium",
            focusMade: true,
            kind: c.kind,
            ...(c.form ? { form: c.form } : {}),
            ...(c.reach ? { reach: c.reach } : {}),
          });
          frames[which] = r.frames.map((f: { png: string }) => f.png);
          frames[which].forEach((png, i) => writeFileSync(join(out, `${slug(c.name)}.${which}.${i}.jpg`), Buffer.from(png.split(",")[1], "base64")));
        }
        let verdict: { old: number; new: number; better: string; note: string; usd: number } | null = null;
        let decided: { replaced: boolean; reason: string } | null = null;
        if (!dry) {
          // No judgment for a look whose test failed: it cannot be used, so it is not paid for.
          if (tested) verdict = await api("/api/admin/looks-judge", { id: c.id, old: frames.old, new: frames.new });
          decided = await api("/api/admin/looks-verdict", { id: c.id, tested, reason: tested ? undefined : `its test run failed (${detail})` });
        }
        const row = { name: c.name, target: c.target, model: c.model, tested, detail, verdict, decided, plan: c.plan };
        summary.push(row);
        console.log(
          `${c.name} (${c.target}, ${c.model}): ${dry ? "framed" : decided?.replaced ? "new look live" : "kept the old"}; test ${tested ? "passed" : detail}${verdict ? `; judged ${verdict.new} against ${verdict.old} ($${verdict.usd.toFixed(4)})` : ""}`,
        );
      } catch (err) {
        console.log(`${c.name}: skipped, undecided (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
        await lab.close().catch(() => {});
        lab = await openLab({ width: 700, height: 830 });
      }
    }
  } finally {
    await lab.close();
    writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 1));
  }
}

async function report(): Promise<void> {
  const r = await api("/api/admin/looks-report");
  console.log(JSON.stringify(r, null, 1));
}

if (mode === "start") await start();
else if (mode === "decide") await decide();
else await report();
