// 4.5.2: rewrite ONE spell's program, as the admin card's "Rewrite this spell" does, so a
// session can fix a broken promise without the owner (docs/DAILY.md, "One spell at a time").
//
//   node scripts/rewrite-one.mjs "<spell name>" "<why, one line>"     (MM_TOKEN or ADMIN_TOKEN)
//
// One name per run, never a list: spells are never rewritten in bulk (ROADMAP, "What the
// money taught us"). It refuses when the month's spend has passed 80% of the budget. The new
// program is stored as a trial; the next person who casts it tests it before it goes live,
// and the live one stays until then.
const URL_BASE = (process.env.MM_URL ?? "https://magic-merger.angelus76300.workers.dev").replace(/\/$/, "");
const TOKEN = process.env.MM_TOKEN ?? process.env.ADMIN_TOKEN ?? "";
const [name, why, ...rest] = process.argv.slice(2);
if (!name || !why || rest.length || name.includes(",")) {
  console.error('usage: node scripts/rewrite-one.mjs "<spell name>" "<why, one line>"   (one spell per run)');
  process.exit(2);
}
if (!TOKEN) {
  console.error("needs MM_TOKEN or ADMIN_TOKEN");
  process.exit(2);
}
const headers = { "x-access-token": TOKEN, "content-type": "application/json" };
const spend = await (await fetch(`${URL_BASE}/api/spend`, { headers })).json();
if (!(spend.budget > 0) || spend.month > 0.8 * spend.budget) {
  console.error(`refused: $${spend.month} spent of $${spend.budget} this month (over 80%)`);
  process.exit(1);
}
const res = await fetch(`${URL_BASE}/api/spell`, { method: "POST", headers, body: JSON.stringify({ name, regenerate: true }) });
const body = await res.json().catch(() => ({}));
if (!res.ok || body.error) {
  console.error(`failed: ${res.status} ${body.error ?? ""}`);
  process.exit(1);
}
const p = body.program ?? {};
console.log(
  JSON.stringify(
    { name: body.name, tier: body.tier, model: p.model, trial: p.id ?? null, why, summary: (p.summary ?? "").slice(0, 240), spentBefore: spend.month },
    null,
    2,
  ),
);
