// Turns collect.mjs output into the one JSON file the Magic Merger Glance dashboard reads.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(execFileSync("node", [join(HERE, "collect.mjs")], { encoding: "utf8" }));
const p = g.planner ?? {};
const lim = (s) => (s === "ok" ? "ok" : s === "warning" ? "warn" : s ? "bad" : "unknown");
const out = {
  at: g.at,
  status: [
    { item: "Snapshot", value: g.at, state: "ok" },
    { item: "Work", value: p.mode ?? "Running", state: (p.mode ?? "").startsWith("Paused") ? "warn" : "ok" },
    { item: "Claude 5-hour limit", value: p.usage?.fiveHour ?? "unknown", state: lim(p.usage?.fiveHour) },
    { item: "Claude weekly limit", value: p.usage?.weekly ?? "unknown", state: lim(p.usage?.weekly) },
    { item: "Weekly limit resets", value: p.usage?.weeklyResets ?? "", state: "ok" },
    {
      item: "Last deploy",
      value: g.deploy ? `${g.deploy.conclusion ?? g.deploy.status}` : "unknown",
      state: g.deploy?.conclusion === "success" ? "ok" : "bad",
    },
    { item: "Last deploy at", value: g.deploy?.at ?? "", state: "ok" },
  ],
  spend: g.spend ? [{ month: g.spend.month, budget: g.spend.budget, today: g.spend.today }] : [],
  d1: Object.entries(g.d1?.days ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, d]) => ({ day, live: d.live, test: d.test, read: d.read, written: d.written, limit: g.d1.readLimit })),
  queue: [
    ...(p.working ?? []).map((t) => ({ status: "Being built", item: t })),
    ...(g.prs ?? []).filter((x) => !x.draft).map((x) => ({ status: x.labels.some((l) => l.startsWith("owner")) ? "Ready, approved" : "Ready", item: x.title })),
    ...(g.prs ?? []).filter((x) => x.draft).map((x) => ({ status: "Parked draft", item: x.title })),
    ...(p.parked ?? []).map((t) => ({ status: "Parked", item: t })),
  ],
  calls: (() => {
    const NAMES = {
      spell: "New spells",
      refresh: "Old items rebuilt",
      "batch-spell": "Spells written ahead",
      merge: "Crafting merges",
      design: "Daily wonder",
      rewrite: "Spell fixes",
      "batch-rewrite": "Spell fixes",
      judge: "Judge",
      describe: "Descriptions",
      intent: "Intents",
      tier: "Tiers",
    };
    const by = {};
    for (const c of g.spend?.calls ?? []) {
      const n = NAMES[c.call] ?? "Other";
      by[n] = (by[n] ?? 0) + c.usd;
    }
    const rows = Object.entries(by)
      .map(([what, usd]) => ({ what, usd: Math.round(usd * 100) / 100 }))
      .sort((a, b) => b.usd - a.usd);
    const top = rows.slice(0, 6),
      rest = rows.slice(6).reduce((a, r) => a + r.usd, 0);
    return rest > 0 ? [...top, { what: "Other", usd: Math.round(rest * 100) / 100 }] : top;
  })(),
  rebuild: g.rebuild ? [g.rebuild] : [],
  roadmap: (p.roadmap ?? []).map((r) => ({ version: r.v, name: r.name, state: r.state, done: r.done, total: r.total, eta: r.eta })),
  updates: (p.updates ?? []).map((u) => ({ update: u.name, done: u.done, total: u.total })),
  live: (g.live ?? []).slice(0, 8).map((x) => ({ item: x.title, at: x.at })),
  next: (p.next ?? []).map((t, i) => ({ step: i + 1, item: t })),
  choices: (g.choices ?? []).map((c) => {
    const i = c.indexOf(":");
    const answers = [...c.matchAll(/"([^"]{2,40})"/g)].map((m) => m[1]).filter((a) => a.includes(":"));
    return {
      choice: i > 0 ? c.slice(0, i) : c,
      detail:
        i > 0
          ? c
              .slice(i + 1)
              .trim()
              .replace(/\s*Answer .*$/, "")
          : "",
      answers: answers.join("  ·  "),
    };
  }),
};
const file = join(process.argv[2] ?? HERE, "glance.json");
writeFileSync(file, JSON.stringify(out));
console.log(file);
