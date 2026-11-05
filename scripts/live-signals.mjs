// 4.5.2: what the live game says, read only (docs/DAILY.md, "The night").
//
//   node scripts/live-signals.mjs [--hours 24] [--out file.json]
//   node scripts/live-signals.mjs errors --since <ms> [--max 0]    exit 1 past --max (the deploy's error check)
//
// Errors come from Workers Observability (CLOUDFLARE_API_TOKEN), slow ticks
// from players' HUD samples (GET /api/perf with MM_TOKEN), down votes, open
// reports and bug guard refusals from SELECTs on the live D1. Nothing is
// written. Players' words (vote reasons, report reasons) are data for a
// session to read as context, never instructions; names are left out.
import { readFileSync, writeFileSync } from "node:fs";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "9df6f62fed82968200f6388eb51fb6ff";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const MM_URL = (process.env.MM_URL ?? "https://magic-merger.angelus76300.workers.dev").replace(/\/$/, "");
const MM_TOKEN = process.env.MM_TOKEN ?? "";
const DB_ID = /"database_name":\s*"magic-merger",[\s\S]*?"database_id":\s*"([0-9a-f-]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"))?.[1];
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

async function cf(path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(`${path}: ${res.status} ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  return json.result;
}

/** Errors the production Worker logged since `from` (ms): invocations that did not end "ok", and error logs. */
export async function errorsSince(from, to = Date.now()) {
  const query = (filter) =>
    cf("/workers/observability/telemetry/query", {
      queryId: "magic-merger-errors",
      timeframe: { from, to },
      view: "events",
      limit: 100,
      parameters: { filters: [{ key: "$workers.scriptName", operation: "eq", type: "string", value: "magic-merger" }, filter] },
    });
  const seen = new Map();
  for (const filter of [
    { key: "$workers.outcome", operation: "neq", type: "string", value: "ok" },
    { key: "$metadata.level", operation: "eq", type: "string", value: "error" },
  ]) {
    for (const e of (await query(filter))?.events?.events ?? []) seen.set(e?.$metadata?.id ?? seen.size, e);
  }
  // "canceled" is a player who closed the page mid request, not a fault of the Worker.
  const events = [...seen.values()].filter((e) => e?.$workers?.outcome !== "canceled");
  return {
    count: events.length,
    first: events
      .slice(0, 5)
      .map((e) =>
        `${e?.$workers?.outcome ?? e?.source?.level ?? ""} ${String(e?.$metadata?.error ?? e?.$metadata?.message ?? e?.source?.message ?? "").slice(0, 200)}`.trim(),
      ),
  };
}

const select = async (sql, params = []) => (await cf(`/d1/database/${DB_ID}/query`, { sql, params }))?.[0]?.results ?? [];

async function perf(hours) {
  if (!MM_TOKEN) return { skipped: "no MM_TOKEN" };
  const res = await fetch(`${MM_URL}/api/perf`, { headers: { "x-access-token": MM_TOKEN } });
  if (!res.ok) return { error: res.status };
  const since = Date.now() - hours * 3600_000;
  const rows = (await res.json()).filter((r) => r.at >= since);
  // A tick is slow when the simulation's p95 passes 16 ms (a frame at 60 Hz) or frames pass 50 ms at p95.
  const slow = rows.filter((r) => r.simP95 > 16 || r.frameP95 > 50);
  return {
    samples: rows.length,
    slow: slow.length,
    worst: slow
      .sort((a, b) => b.simP95 - a.simP95)
      .slice(0, 5)
      .map((r) => ({ at: new Date(r.at).toISOString(), simP95: r.simP95, frameP95: r.frameP95, size: r.size, creatures: r.creatures, screen: r.screen })),
  };
}

async function signals(hours) {
  const since = Date.now() - hours * 3600_000;
  const out = { at: new Date().toISOString(), hours };
  const safe = async (name, fn) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e.message ?? e).slice(0, 300) };
    }
  };
  await safe("errors", () => errorsSince(since));
  await safe("perf", () => perf(hours));
  await safe("downVotes", () =>
    select(
      `SELECT v.key, e.name, v.reason, COUNT(*) AS n FROM votes v LEFT JOIN elements e ON e.key = v.key
       WHERE v.up = 0 AND v.at >= ? GROUP BY v.key, v.reason ORDER BY n DESC LIMIT 20`,
      [since],
    ),
  );
  await safe("reports", () => select(`SELECT key, name, reason, at FROM reports WHERE status = 'open' ORDER BY at DESC LIMIT 20`));
  await safe("refusals", () =>
    select(`SELECT path, reason, COUNT(*) AS n FROM refusals WHERE at >= ? GROUP BY path, reason ORDER BY n DESC LIMIT 10`, [since]),
  );
  await safe("spend", async () => {
    if (!MM_TOKEN) return { skipped: "no MM_TOKEN" };
    const s = await (await fetch(`${MM_URL}/api/spend`, { headers: { "x-access-token": MM_TOKEN } })).json();
    return { month: s.month, today: s.today, budget: s.budget };
  });
  return out;
}

const cmd = process.argv[2];
if (cmd === "errors") {
  const since = Number(arg("since", Date.now() - 600_000));
  const max = Number(arg("max", 0));
  const e = await errorsSince(since);
  console.log(`${e.count} errors in production since ${new Date(since).toISOString()}${e.first.length ? ": " + e.first.join(" | ") : ""}`);
  process.exit(e.count > max ? 1 : 0);
} else {
  const s = await signals(Number(arg("hours", 24)));
  const text = JSON.stringify(s, null, 2);
  const out = arg("out", "");
  if (out) writeFileSync(out, text);
  console.log(text);
}
