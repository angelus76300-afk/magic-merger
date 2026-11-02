// Verifies challenge solvers (3.7). Asks the Worker for spells worth trying
// on each challenge (reachable from its start set, strong enough, not tried
// for their current program), plays each challenge in Node with the spell
// cast at its spots over three seeds, and reports back: a challenge is shown
// to players once one spell solves it, and its par comes from those spells.
// A spell rewritten since it was verified comes back here first.
//
//   MM_URL=https://magic-merger.<you>.workers.dev MM_TOKEN=<ADMIN_TOKEN> npm run challenges [-- limit]
//
// No Claude call: the programs are stored, the simulation runs here.
import { challengeById } from "../shared/challenges";
import type { Tier } from "../shared/tiers";
import { solves } from "./challenge-replay";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const limit = Number(process.argv[2]) || 20;

async function api(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(new URL(path, url), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-access-token": token! },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${(data as { error?: string } | null)?.error ?? res.status}`);
  return data;
}

const list = (await api(`/api/admin/challenge-candidates?limit=${limit}`)) as {
  challenge: string;
  key: string;
  name: string;
  tier: Tier;
  pid: number;
  code: string;
}[];
console.log(`${list.length} spells to try`);
const solved = new Map<string, string[]>();
for (const c of list) {
  const def = challengeById(c.challenge);
  if (!def) continue;
  const t0 = Date.now();
  let r: { ok: boolean; wins: number; runs: number };
  try {
    r = solves(def, c.code, c.tier);
  } catch {
    r = { ok: false, wins: 0, runs: 1 };
  }
  await api("/api/admin/challenge-verify", { challenge: c.challenge, key: c.key, pid: c.pid, ok: r.ok, wins: r.wins, runs: r.runs });
  if (r.ok) solved.set(c.challenge, [...(solved.get(c.challenge) ?? []), c.name]);
  console.log(
    `${c.challenge}: ${c.name} (${c.tier}) ${r.ok ? "solves it" : "does not"} (${r.wins} wins, ${r.runs} runs, ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
}
for (const [id, names] of solved) console.log(`${id}: solved by ${names.join(", ")}`);
