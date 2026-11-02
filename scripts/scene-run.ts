// Dev only: the five minute scene (src/sim/check.ts, sceneRun) printed in full.
//   npx esbuild scripts/scene-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/scene.mjs --log-level=warning
//   node node_modules/.cache/scene.mjs [seconds]
import { runScene } from "../src/sim/check";

const seconds = Number(process.argv[2] ?? 600);
const t0 = performance.now();
// WATCH=dragon,vampire prints those creatures every ten seconds.
const watch = (process.env.WATCH ?? "").split(",").filter(Boolean);
const r = runScene(
  seconds,
  null,
  Number(process.env.IDLE_AFTER ?? 300),
  (world) => {
    if (!watch.length || Math.round(world.time) % 10) return;
    for (const c of world.creatures)
      if (watch.includes(c.kind.split("#")[0]) || watch.includes(String(c.id)))
        console.log(
          `  t ${world.time.toFixed(0)} ${c.kind}#${c.id} ${c.dead ? "dead" : "alive"} hp ${c.hp.toFixed(0)} at ${c.x.toFixed(0)},${c.y.toFixed(0)} z ${c.z.toFixed(1)} mood ${c.data.mood ?? "-"} action ${c.mind?.action ?? "-"} hunger ${c.mind?.hunger.toFixed(2) ?? "-"} did ${c.mind?.did ?? ""}`,
        );
  },
  Number(process.env.STREAMS ?? 0),
);
console.log(`${seconds} s simulated in ${((performance.now() - t0) / 1000).toFixed(1)} s, tick mean ${r.meanTickMs} ms, worst ${r.worstTickMs} ms`);
for (const [k, v] of Object.entries(r.kinds))
  console.log(
    `  ${k.padEnd(10)} start ${v.start}, min ${v.min}, max ${v.max}, end ${v.end}; changed something ${r.lively[k]?.[0] ?? 0}/${r.lively[k]?.[1] ?? 0}; deeds ${r.deeds[k] ?? 0}`,
  );
console.log("  marks", JSON.stringify(r.marks));
console.log(`  idle (${r.idle.length})`, r.idle.map((c) => `${c.kind}#${c.id}: ${c.action}`).join("; "));
if (r.errors.length) console.log("  errors", r.errors.slice(0, 3));
