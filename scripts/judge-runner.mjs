// The judge's eyes (3.3). Asks the Worker for live programs the judge has not
// seen, casts each one in the Spell Lab, and sends three frames with what
// changed to /api/admin/judge, where Haiku scores it, calibrated on the
// player's votes. A trusted judge (it agreed with ten votes or more, 70% of
// the time) also asks for the rewrite of a bad program nobody voted on yet.
//
//   MM_URL=https://magic-merger.<you>.workers.dev MM_TOKEN=<ADMIN_TOKEN> node scripts/judge-runner.mjs [limit]
//
// Runs on a computer with Playwright (Vite is started for the lab), or from
// the "Judge" GitHub workflow. About $0.0004 per program.
import { factsOf, openLab } from "./lab-browser.mjs";

const url = process.env.MM_URL;
const token = process.env.MM_TOKEN;
if (!url || !token) {
  console.error("Set MM_URL (the game's address) and MM_TOKEN (its ADMIN_TOKEN).");
  process.exit(1);
}
const limit = Number(process.argv[2]) || 20;
// MM_CREATURES=1 (3.7): live programs that bring creatures, asked again
// whether their creatures look alive, judged before or not.
const creatures = process.env.MM_CREATURES === "1";
// Big spells build up longer: at 1, 3 and 6 s a legendary meteor was still a
// glow in the sky (docs/measurements/spell-quality-2026-11.md).
const shotsFor = (tier) => (tier === "legendary" || tier === "cosmic" ? [2, 6, 12] : [1, 3, 6]);

async function api(path, body) {
  const res = await fetch(new URL(path, url), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${data?.error ?? res.status}`);
  return data;
}

const programs = await api(`/api/admin/programs?limit=${limit}${creatures ? "&creatures=1" : ""}`);
console.log(`${programs.length} programs to judge`);
if (programs.length) {
  const lab = await openLab();
  try {
    for (const p of programs) {
      const shots = shotsFor(p.tier);
      const result = await lab.cast(p.code, { tier: p.tier, shots, jpeg: true });
      const judged = await api("/api/admin/judge", { id: p.id, frames: result.frames.map((f) => f.png), shots, facts: factsOf(result) });
      console.log(
        `${p.name} (#${p.id}, ${p.tier}): ${judged.score}/5 ${judged.reason}, ${judged.verdict}, alive ${judged.alive}; ${judged.note} [${judged.action}]`,
      );
    }
  } finally {
    await lab.close();
  }
}
const stats = await api("/api/admin/judge-stats");
console.log(
  `calibration: threshold ${stats.threshold}, ${stats.voted} voted programs, agreement ${stats.agreement ?? "n/a"}, ${stats.trusted ? "trusted" : "advice only"}`,
);
