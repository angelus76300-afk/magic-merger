// Gathers what the Magic Merger glance dashboard shows, as one JSON object on stdout.
// Read-only: GitHub (gh), the live game's spend endpoint, Cloudflare D1 analytics,
// and planner.json, which the planner session writes when it wakes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "angelus76300-afk/magic-merger";
const GAME = "https://magic-merger.angelus76300.workers.dev";
const ACCOUNT = "9df6f62fed82968200f6388eb51fb6ff";
const DBS = { "2faca013-6f31-4c46-8bf1-08d5691d89ff": "live", "d1024ed3-1c00-4fd4-a1b4-3a54c211e616": "test" };

const out = { at: new Date().toISOString(), errors: [] };
const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", timeout: 20000 }));
const safe = async (name, fn) => {
  try {
    out[name] = await fn();
  } catch (e) {
    out.errors.push(
      `${name}: ${String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 120)}`,
    );
  }
};

await safe("planner", () => JSON.parse(readFileSync(join(HERE, "planner.json"), "utf8")));

await safe("prs", () =>
  gh(`repos/${REPO}/pulls?state=open&per_page=30`).map((p) => ({
    n: p.number,
    title: p.title,
    draft: p.draft,
    labels: p.labels.map((l) => l.name),
    updated: p.updated_at,
  })),
);

await safe("live", () =>
  gh(`repos/${REPO}/commits?per_page=8`).map((c) => ({
    title: c.commit.message.split("\n")[0].replace(/\s*\(#\d+\)$/, ""),
    at: c.commit.committer.date,
  })),
);

await safe("deploy", () => {
  const r = gh(`repos/${REPO}/actions/workflows/deploy.yml/runs?per_page=1`).workflow_runs[0];
  return r ? { status: r.status, conclusion: r.conclusion, at: r.updated_at } : null;
});

await safe("paused", () => gh(`repos/${REPO}/issues?labels=pause&state=open`).length > 0);

await safe("choices", () => {
  const body = gh(`repos/${REPO}/issues/51`).body ?? "";
  const open = body.split("## Open")[1]?.split("\n## ")[0] ?? "";
  const items = [];
  for (const l of open.split("\n")) {
    if (l.startsWith("- **")) items.push(l);
    else if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += " " + l.trim();
  }
  return items.map((l) =>
    l
      .replace(/^- \*\*([^*]+)\*\*:?\s*/, "$1: ")
      .replace(/\*\*/g, "")
      .slice(0, 1400),
  );
});

await safe("spend", async () => {
  const r = await fetch(`${GAME}/api/spend`, { headers: { "x-access-token": process.env.ADMIN_TOKEN ?? "" } });
  const j = await r.json();
  const by = {};
  for (const c of j.calls ?? []) by[c.call] = (by[c.call] ?? 0) + c.usd;
  return {
    month: j.month,
    today: j.today,
    budget: j.budget,
    calls: Object.entries(by)
      .map(([call, usd]) => ({ call, usd }))
      .sort((a, b) => b.usd - a.usd),
  };
});

await safe("rebuild", async () => {
  const r = await fetch(`${GAME}/api/admin/refresh-report`, { headers: { "x-access-token": process.env.ADMIN_TOKEN ?? "" } });
  const j = await r.json();
  return { spent: j.cost?.usd ?? 0, budget: j.budget ?? 0, replaced: j.replaced ?? 0, kept: j.kept ?? 0 };
});

await safe("d1", async () => {
  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const q = `{viewer{accounts(filter:{accountTag:"${ACCOUNT}"}){d1AnalyticsAdaptiveGroups(limit:20,filter:{date_geq:"${since}"},orderBy:[date_ASC]){sum{rowsRead rowsWritten} dimensions{date databaseId}}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const rows = (await r.json()).data.viewer.accounts[0].d1AnalyticsAdaptiveGroups;
  const days = {};
  for (const g of rows) {
    const d = (days[g.dimensions.date] ??= { read: 0, written: 0, live: 0, test: 0 });
    d.read += g.sum.rowsRead;
    d.written += g.sum.rowsWritten;
    d[DBS[g.dimensions.databaseId] ?? "other"] = (d[DBS[g.dimensions.databaseId] ?? "other"] ?? 0) + g.sum.rowsRead;
  }
  return { days, readLimit: 5000000, writeLimit: 100000 };
});

process.stdout.write(JSON.stringify(out));
