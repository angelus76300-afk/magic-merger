// The island needs you (2026-11-11, src/sim/troubles.ts): a wildfire by a
// village, paced so it can be answered, capped in what it takes, judged by
// what is left of the village, kept in the save, and first for the director.
import { populate } from "../src/sim/creatures";
import { Director } from "../src/sim/director";
import { storyOn, tell } from "../src/sim/kin";
import { DEFAULT_LAND, resolveLand } from "../src/sim/land";
import { C, F } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { Runtime } from "../src/sim/runtime";
import { loadWorld, saveWorld } from "../src/sim/save";
import { stepHeadless } from "../src/sim/tick";
import { fireOf, noteCast, readTroubles, startWildfire, stoneAt, stoneLine, troubleLine, type TroubleEnd } from "../src/sim/troubles";
import { raiseWonders } from "../src/sim/wonderbuild";
import { generateWorld, World } from "../src/sim/world";

type Check = (name: string, ok: boolean, detail?: string) => void;

function island(seed: number) {
  Runtime.slowMs = Infinity;
  const world = generateWorld(152, 152, seed, resolveLand({ ...DEFAULT_LAND }, seed, 152));
  populate(world);
  const rt = new Runtime(world, () => undefined);
  raiseWonders(world, rt);
  storyOn(world);
  for (let k = 0; k < 60 * 30; k++) stepHeadless(world, rt);
  return { world, rt };
}

// Runs a wildfire to its end. `answerAt`: seconds in, every fire is put out and an item is cast at it.
function burn(
  seed: number,
  answerAt: number | null,
  before?: (world: World) => void,
): { end: TroubleEnd | null; world: World; seconds: number; stage: number; lines: string[] } {
  const { world, rt } = island(seed);
  before?.(world);
  const told = world.story.length;
  const t = startWildfire(world, seeded(seed));
  let seconds = 0;
  while (t && world.trouble && seconds < 400) {
    for (let k = 0; k < 30; k++) stepHeadless(world, rt);
    seconds++;
    if (answerAt !== null && seconds === answerAt) {
      // The item is cast, and then does its work as rain would: every fire out, and the ground
      // between the fire and the houses under water, so the front finds nothing to burn.
      noteCast(world, "rain", "Rain", "", t.x, t.y);
      world.fire.fill(0);
      for (let i = 0; i < world.n; i++) {
        world.temp[i] = Math.min(world.temp[i], 20);
        const cx = i % world.w;
        const cy = Math.floor(i / world.w);
        if (Math.hypot(cx - t.x, cy - t.y) < 40 && world.cover[i] !== C.HOUSE) world.setFluid(i, F.WATER, 0.6);
      }
    }
  }
  storyOn(null);
  return { end: world.troubleEnd, world, seconds, stage: t?.stage ?? 0, lines: world.story.slice(told).map((l) => l.text) };
}

export function troubleChecks(check: Check): void {
  // 1. Left alone: it reaches the village, takes one house and no more, and ends by itself.
  {
    const r = burn(21, null);
    const text = `${r.seconds} s, ${r.end?.outcome}, ${r.end?.housesLost} houses: ${r.lines.join(" / ")}`;
    check("troubles: a wildfire left alone ends by itself within five minutes", !!r.end && r.seconds >= 40 && r.seconds < 300, text);
    check(
      "troubles: it is told as it starts, as it comes and as it arrives, never what to do",
      r.lines.some((l) => l.startsWith("fire in the woods")) &&
        r.lines.some((l) => l.includes("is burning")) &&
        !/\b(water|rain|use|cast|try)\b/i.test(r.lines.filter((l) => l.includes("fire")).join(" ")),
      text,
    );
    check("troubles: an island's first troubles take one house at most", r.end?.outcome === "scarred" && r.end.housesLost === 1, text);
    check("troubles: no stone for a village nobody saved", r.world.stones.length === 0 && r.world.trouble === null && r.world.troubleNext > r.world.time);
  }
  // 2. Answered in time: unharmed, the item named, a stone by the village that a tap reads.
  {
    const r = burn(2026, 30);
    const s = r.world.stones[0];
    check(
      "troubles: answered in time, the village is saved by the item cast",
      r.end?.outcome === "saved" && r.end.by?.key === "rain" && r.end.housesLost === 0,
      `${r.end?.outcome}: ${r.end?.line}`,
    );
    check(
      "troubles: the village raises one stone to it",
      r.world.stones.length === 1 && !!s && stoneLine(s).startsWith("Rain saved ") && stoneAt(r.world, s.x + 0.5, s.y + 0.5) === s,
      s && stoneLine(s),
    );
    // The save keeps the stone and the count, and reads them back.
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(r.world, new Map()))), () => undefined);
    check(
      "troubles: the stone and the count of troubles come back with the save",
      back?.stones.length === 1 && back.stones[0].item === "Rain" && back.troubles === 1 && back.trouble === null,
    );
  }
  // 2b. A cast that does not reduce the fire earns nothing: Fire thrown at the fire is no answer (the playtest saw it thanked).
  {
    const { world, rt } = island(2026);
    const t = startWildfire(world, seeded(2026))!;
    let seconds = 0;
    while (world.trouble && seconds < 400) {
      for (let k = 0; k < 30; k++) stepHeadless(world, rt);
      seconds++;
      // Every ten seconds an item is cast at it that changes nothing.
      if (seconds % 10 === 0 && world.trouble) noteCast(world, "fire", "Fire", "", t.x, t.y);
    }
    const end = world.troubleEnd;
    check(
      "troubles: an item that did not reduce the fire gets no thanks and no stone",
      !!end && end.by === null && end.outcome !== "saved" && world.stones.length === 0 && !/Fire (put out|stopped)/.test(end.line),
      `${end?.outcome}: ${end?.line}`,
    );
    check(
      "troubles: such casts were noted, and the fire went on to the houses",
      t.casts.length > 0 && t.stage === 3,
      `${t.casts.length} casts, stage ${t.stage}`,
    );
    storyOn(null);
  }
  // 3. A trouble running is saved and goes on after a reload; what is not a trouble in a save is dropped.
  {
    const { world, rt } = island(21);
    const t = startWildfire(world, seeded(21))!;
    for (let k = 0; k < 20 * 30; k++) stepHeadless(world, rt);
    const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(world, new Map()))), () => undefined);
    check(
      "troubles: a trouble running comes back with the save, where it was",
      !!back?.trouble && back.trouble.name === t.name && back.trouble.stage === world.trouble?.stage && back.trouble.cap === t.cap,
    );
    check(
      "troubles: a save's troubles are read field by field",
      readTroubles({ n: 2, next: 900, now: { kind: "flood" }, stones: [{ x: "1" }] })?.now === null &&
        readTroubles({ n: 2, next: 900, now: null, stones: [{ x: "1" }] })?.stones.length === 0 &&
        readTroubles("x") === null,
    );
    // The director goes to it first, and says only what is seen.
    const d = new Director(() => 0.5);
    const shot = d.update(world).shot;
    check("troubles: the director's camera goes to the trouble first", shot?.sort === "trouble" && shot.caption === troubleLine(world.trouble!), shot?.caption);
    // While it lasts the watch shows nothing else, whatever happens elsewhere, and leaves it when it is over.
    tell(world, "a child was born in the village", { x: 5, y: 5 });
    world.time += 30;
    check("troubles: the watch stays on the trouble while it lasts", d.update(world).shot?.sort === "trouble");
    const was = world.trouble;
    world.trouble = null;
    check("troubles: and goes back to the island's stories when it is over", d.update(world).shot?.sort !== "trouble");
    world.trouble = was;
    storyOn(null);
  }
  // 4. Its size follows the island's history: from the fourth trouble it may take a third of the village.
  {
    const r = burn(99, null, (w) => {
      w.troubles = 3;
    });
    const cap = r.end ? r.end.trouble.cap / 4 : 0;
    check(
      "troubles: later troubles may take up to a third of a village, never more",
      !!r.end && cap >= 1 && cap <= Math.ceil(r.end.trouble.houses0 / 12) && r.end.housesLost <= cap,
      `${r.end?.housesLost} of ${r.end && r.end.trouble.houses0 / 4}, cap ${cap}`,
    );
  }
  // 5. No woods with a way to the houses: no wildfire. A cast far away is not its answer.
  {
    const { world } = island(7);
    check("troubles: an island of sand has no wildfire", startWildfire(world, seeded(7)) === null && world.trouble === null && world.troubles === 0);
    const w2 = island(21).world;
    const t = startWildfire(w2, seeded(21))!;
    noteCast(w2, "far", "Far", "", (t.vx + 76) % 152, (t.vy + 76) % 152);
    const f = fireOf(w2, t);
    check("troubles: a cast far from the fire and the village is not noted", t.casts.length === 0 && f.cells > 0);
    let trees = 0;
    for (let i = 0; i < w2.n; i++) if (w2.cover[i] === C.TREE && w2.fire[i] > 0) trees++;
    check("troubles: it starts in the woods", trees > 0, String(trees));
    let nearest = Infinity;
    for (let i = 0; i < w2.n; i++) if (w2.cover[i] === C.HOUSE) nearest = Math.min(nearest, Math.hypot((i % w2.w) - t.x, Math.floor(i / w2.w) - t.y));
    check("troubles: and at least sixteen cells from every house", nearest >= 16, nearest.toFixed(1));
    storyOn(null);
  }
}
