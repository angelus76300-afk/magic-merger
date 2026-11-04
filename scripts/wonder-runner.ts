// The nightly test of new wonders (4.4.5 part C, worker/wonders.ts): every
// trial wonder (the day's from the API, a player's discovery grown into the
// world) is built on three islands of its lands and watched for a whole day
// and night in Node (src/sim/wondercheck.ts), and its verdict goes back to
// /api/admin/wonder-check: live, in the pool new islands draw from, or
// rejected with the reason. Wonder code never runs in a player's browser
// before this (review M11).
//
//   npm run wonders       with MM_URL and MM_TOKEN (the ADMIN_TOKEN) set.
//
// A step of the daily "Judge" GitHub workflow. Costs nothing: no Claude call.
import { checkWonderDef } from "../src/sim/wondercheck";
import { readDef } from "../src/sim/wonders";
import { adminApi } from "./admin-api";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const api = adminApi(url, token, { retries: 2 });

const trials = await api<unknown[]>("/api/admin/wonders-trial");
console.log(`${trials.length} wonders to test`);
for (const raw of trials) {
  const def = readDef(raw);
  const id = (raw as { id?: number }).id;
  if (!def) {
    await api("/api/admin/wonder-check", {
      id,
      ok: false,
      problem: "answer",
      detail: "Its definition does not read (a built-in kind, or no rarity, spot or code).",
    });
    console.log(`#${id}: rejected, its definition does not read`);
    continue;
  }
  const t0 = Date.now();
  const v = checkWonderDef(def);
  const { status } = await api<{ status: string }>("/api/admin/wonder-check", { id: def.id, ok: v.ok, problem: v.problem, detail: v.detail });
  console.log(`${def.kind} (#${def.id}, ${def.rarity}, ${def.source}): ${status} in ${Math.round((Date.now() - t0) / 1000)} s. ${v.detail}`);
}
