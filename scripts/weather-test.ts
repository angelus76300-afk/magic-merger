// Weather that crosses the island (2026-11-11, src/sim/weather.ts): rain is a front that moves
// with the wind, falls where it is and nowhere else, never for long on one spot, and puts out
// what burns under it on the player's island only.
import { populate } from "../src/sim/creatures";
import { storyOn } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { startWildfire } from "../src/sim/troubles";
import { fallingAt, fronts, wetFires } from "../src/sim/weather";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

function island(seed: number) {
  Runtime.slowMs = Infinity;
  const world = generateWorld(152, 152, seed, resolveLand({ ...DEFAULT_LAND }, seed, 152));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  return { world, rt };
}

export function weatherChecks(check: Check): void {
  const { world, rt } = island(21);
  // 1. An hour of sky, looked at every five seconds: where it rains, how long, and how fronts move.
  let rainy = 0;
  let both = 0;
  let longest = 0;
  let run = 0;
  let wetShare = 0;
  let looks = 0;
  let moved = 0;
  let last: { x: number; y: number } | null = null;
  const spot = { x: 76, y: 76 };
  for (let t = 0; t < 3600; t += 5) {
    const list = fronts(world, t);
    const here = fallingAt(world, spot.x, spot.y, t, list).amount > 0.2;
    run = here ? run + 5 : 0;
    longest = Math.max(longest, run);
    if (here) rainy += 5;
    if (!list.length) {
      last = null;
      continue;
    }
    looks++;
    // A zone, not a sky: while a front is over the island, part of the island is dry.
    let wet = 0;
    for (let y = 4; y < 152; y += 8) for (let x = 4; x < 152; x += 8) if (fallingAt(world, x, y, t, list).amount > 0.2) wet++;
    wetShare += wet / 361;
    if (wet > 0 && wet < 361) both++;
    if (last && list.length === 1) moved += Math.hypot(list[0].x - last.x, list[0].y - last.y);
    last = list.length === 1 ? { x: list[0].x, y: list[0].y } : null;
  }
  check("weather: the same seed and time give the same fronts", JSON.stringify(fronts(world, 1234)) === JSON.stringify(fronts(world, 1234)));
  check("weather: fronts come in an hour on a temperate island", looks > 20, `${looks} looks with a front`);
  check(
    "weather: it rains on part of the island, never on all of it",
    looks > 0 && both / looks > 0.7 && wetShare / looks < 0.5,
    `${both} of ${looks} looks part wet; ${(wetShare / looks).toFixed(2)} of the island wet on average`,
  );
  check("weather: no spot is rained on for more than two minutes at a time", longest > 0 && longest <= 120, `${longest} s`);
  check("weather: a spot is dry most of the hour", rainy / 3600 < 0.35, `${rainy} s of rain`);
  check("weather: a front moves across the island", moved > 152, `${Math.round(moved)} cells`);

  // 2. Rain puts out what burns under it, on the player's island only.
  let at = -1;
  for (let t = 0; t < 3600 && at < 0; t += 5) if (fronts(world, t).some((f) => f.kind === "rain" && f.amount === 1)) at = t;
  const f = fronts(world, at).find((k) => k.kind === "rain")!;
  const under = Math.round(f.y) * world.w + Math.round(f.x);
  const far = ((Math.round(f.y) + 76) % 152) * world.w + ((Math.round(f.x) + 76) % 152);
  world.time = at;
  world.fire[under] = 1;
  world.fire[far] = 1;
  check("weather: off the player's island rain does nothing (a challenge, a test run)", wetFires(world, 3) === 0 && world.fire[under] === 1);
  world.weather = true;
  const out = wetFires(world, 3);
  check(
    "weather: rain puts out the fire under the front and not the one beside it",
    out === 1 && world.fire[under] === 0 && world.fire[far] === 1,
    `${out} out`,
  );
  world.fire.fill(0);

  // 3. A front over a wildfire is the island's own answer: the trouble ends, and says the rain did it.
  storyOn(world);
  world.time = 0;
  for (let k = 0; k < 60 * 30; k++) stepHeadless(world, rt);
  // Where the fire would start, then the moment a front in full rain is over that place.
  const spotOf = startWildfire(world, seeded(21))!;
  world.trouble = null;
  world.troubles = 0;
  world.fire.fill(0);
  let when = -1;
  for (let t = 200; t < 7200 && when < 0; t += 2) {
    const fall = fallingAt(world, spotOf.x, spotOf.y, t);
    const ahead = fallingAt(world, spotOf.x, spotOf.y, t + 25);
    if (fall.kind === "rain" && fall.amount > 0.9 && ahead.kind === "rain" && ahead.amount > 0.9) when = t;
  }
  world.time = when;
  const told = world.story.length;
  const again = startWildfire(world, seeded(21));
  let seconds = 0;
  while (world.trouble && seconds < 120) {
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    seconds++;
  }
  const line = world.story
    .slice(told)
    .find((l) => l.text.includes("put out the fire") || l.text.includes("burned itself out") || l.text.includes("fire is out"));
  check(
    "weather: a wildfire under a front is put out by the rain, and told so",
    when > 0 &&
      !!again &&
      Math.hypot(again.x - spotOf.x, again.y - spotOf.y) < 1 &&
      !!line &&
      line.text.startsWith("the rain put out the fire by") &&
      seconds < 60,
    `rain at ${when}, ${seconds} s, ${line?.text}`,
  );
  storyOn(null);
}
