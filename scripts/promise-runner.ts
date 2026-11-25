// The promise check's runner (worker/promise.ts): asks the Worker to check items in batches,
// most cast first, waits for each batch, and writes every verdict to a report. Nothing is
// rewritten: the lead session reads the report and decides what goes to the refresh.
//
//   MM_URL=... MM_TOKEN=<ADMIN_TOKEN> npx esbuild scripts/promise-runner.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/promise-runner.mjs && node node_modules/.cache/promise-runner.mjs run [options]
//
//   run      batches of --batch items (100) of --kinds (spell; or object, creature, building, settlement,
//            place, land, wonder, comma separated, or all) from --from (where the report
//            stopped), until --max items (500), the budget (CHECK_BUDGET_USD) or the library ends
//   resume   collects the batches the report still waits for, then stops
//   report   writes the report again from its JSON, and prints the Worker's spend
//   --dry    with run: lists what would be sent, sends nothing
//
// The report: OUT (docs/measurements/promise-check-2026-11-25), as .json (every verdict, the
// batches and where each kind stopped) and .md (the items flagged "no" and "partly", most cast
// first, with what is missing and the fix). It is written after every batch, so a stop loses
// nothing: `resume` and `run` start from it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { adminApi } from "./admin-api";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const api = adminApi(url, token, { retries: 2 });
const [mode = "report", ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};
const out = process.env.OUT ?? "docs/measurements/promise-check-2026-11-25";
const kindsArg = opt("kinds", "spell");
const kinds = kindsArg === "all" ? [] : kindsArg.split(",").map((k) => k.trim());
const batchSize = Math.min(200, Number(opt("batch", "100")) || 100);
const max = Number(opt("max", "500")) || 500;
const dry = rest.includes("--dry");
const POLL_MS = Number(process.env.POLL_MS) || 60_000;

interface Item {
  id: string;
  key: string | null;
  name: string;
  kind: string;
  tier: string;
  casts: number;
}
interface Verdict {
  verdict: "yes" | "partly" | "no";
  promise: string;
  does: string;
  missing: string;
  fix: string;
}
interface Row extends Item {
  batch: string;
  verdict: Verdict["verdict"] | null;
  promise?: string;
  does?: string;
  missing?: string;
  fix?: string;
  error?: string;
  usd: number;
}
interface Report {
  started: string;
  // Where each selection of kinds stopped, in the most-cast order.
  offsets: Record<string, number>;
  pending: { batch: string; items: Item[] }[];
  rows: Row[];
  billed: number;
}

const file = `${out}.json`;
const report: Report = existsSync(file)
  ? (JSON.parse(readFileSync(file, "utf8")) as Report)
  : { started: new Date().toISOString(), offsets: {}, pending: [], rows: [], billed: 0 };

function save(): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 1));
  writeFileSync(`${out}.md`, markdown());
}

const esc = (s: string | undefined) => (s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");

function markdown(): string {
  const rows = report.rows;
  const count = (v: string | null) => rows.filter((r) => r.verdict === v).length;
  const flagged = rows.filter((r) => r.verdict === "no" || r.verdict === "partly").sort((a, b) => b.casts - a.casts || a.name.localeCompare(b.name));
  const lines = [
    `# Promise check, ${report.started.slice(0, 10)}`,
    "",
    "Opus 5.5 read each item's name, entry, tier, kind, the writer's summary, its last test run and its program, and said whether the program does what the name promises (worker/promise.ts, scripts/promise-runner.ts). Nothing was rewritten: the lead session decides what goes to the refresh.",
    "",
    `Checked: ${rows.length} (${count("yes")} yes, ${count("partly")} partly, ${count("no")} no, ${count(null)} without an answer). Billed: $${report.billed.toFixed(2)}.`,
    "",
    "## Flagged, most cast first",
    "",
    "| Item | Kind | Tier | Casts | Verdict | Promise | Does | Missing | Fix |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...flagged.map(
      (r) => `| ${esc(r.name)} | ${r.kind} | ${r.tier} | ${r.casts} | ${r.verdict} | ${esc(r.promise)} | ${esc(r.does)} | ${esc(r.missing)} | ${esc(r.fix)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Waits for one batch and adds its verdicts.
async function collect(p: { batch: string; items: Item[] }): Promise<void> {
  for (;;) {
    const r = (await api("/api/admin/promise-check-poll", { batch: p.batch })) as {
      ended: boolean;
      billed: number;
      outcomes: { id: string; verdict: Verdict | null; error?: string; usd: number }[];
    };
    if (r.ended) {
      const byId = new Map(r.outcomes.map((o) => [o.id, o]));
      for (const it of p.items) {
        const o = byId.get(it.id);
        report.rows.push({ ...it, batch: p.batch, verdict: o?.verdict?.verdict ?? null, ...(o?.verdict ?? {}), error: o?.error, usd: o?.usd ?? 0 });
      }
      report.billed += r.billed;
      report.pending = report.pending.filter((q) => q.batch !== p.batch);
      save();
      const flagged = p.items.filter((it) => ["no", "partly"].includes(byId.get(it.id)?.verdict?.verdict ?? "")).length;
      console.log(`batch ${p.batch}: ${p.items.length} answered, ${flagged} flagged, $${r.billed.toFixed(3)} billed`);
      return;
    }
    console.log(`batch ${p.batch}: still running`);
    await wait(POLL_MS);
  }
}

async function run(): Promise<void> {
  for (const p of [...report.pending]) await collect(p);
  const sel = kinds.length ? kinds.join(",") : "all";
  let offset = Number(opt("from", String(report.offsets[sel] ?? 0)));
  let sent = 0;
  while (sent < max) {
    const limit = Math.min(batchSize, max - sent);
    const r = (await api("/api/admin/promise-check", { kinds, offset, limit, dry })) as {
      picked: number;
      fit: number;
      batch: string | null;
      items: Item[];
      room: number;
      estimate?: number;
    };
    if (dry) {
      console.log(`picked ${r.picked} from ${offset}; the $${r.room} left in the check's month sends the first ${r.fit}:`);
      for (const it of r.items) console.log(`  ${it.name} (${it.kind}, ${it.tier}, ${it.casts} casts)`);
      return;
    }
    if (!r.picked) {
      console.log(`no more ${sel} items from ${offset}`);
      return;
    }
    if (!r.batch) {
      console.log(`the check's budget is spent: $${r.room} left`);
      return;
    }
    console.log(`sent ${r.items.length} (${offset} to ${offset + r.items.length - 1}) as ${r.batch}, held $${r.estimate}`);
    report.pending.push({ batch: r.batch, items: r.items });
    offset += r.items.length;
    report.offsets[sel] = offset;
    save();
    sent += r.items.length;
    await collect({ batch: r.batch, items: r.items });
  }
}

if (mode === "run") await run();
else if (mode === "resume") for (const p of [...report.pending]) await collect(p);
else if (mode === "report") {
  save();
  console.log(JSON.stringify(await api("/api/admin/promise-check-report")));
} else {
  console.error("run | resume | report");
  process.exit(1);
}
