// Sizes held at runtime (4.7 item 2), run by npm test (scripts/sim-test.ts).
// An item placed on any island has the size its test run gave it on the
// reference island; a spell that grows a creature keeps it within its kind;
// the view never draws a grown creature past the height cap.
import { castRequest } from "../src/cast-request";
import { body } from "../src/sim/body";
import { kindOf } from "../src/sim/creatures";
import { GROW_MAX, GROW_MAX_BIG, Runtime, castReach } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { MAX_HEIGHT, buildRig, drawScale, villagerUnits } from "../src/sim/voxel/rigs";
import { generateWorld, type World } from "../src/sim/world";
import { REFERENCE_SIDE, TIER_REACH, tierFromDepth, type Tier } from "../shared/tiers";

type Check = (name: string, ok: boolean, detail?: string) => void;

// Where a cast puts a body "at w.r" east of its center: what an item drawn
// within w.r spans, on an island of this side.
function reachOnIsland(world: World, tier: Tier, form: string | undefined): number {
  const rt = new Runtime(world, () => {});
  const [x, y] = [Math.floor(world.w / 2), Math.floor(world.h / 2)];
  rt.cast(
    {
      key: `reach-${form}`,
      name: "Reach",
      tier,
      form,
      code: `const spell = { *cast(w) { w.body({ x: w.x + w.r, y: w.y, z: 0, r: 0.5, life: 30, look: "orb" }); } };`,
    },
    x,
    y,
  );
  stepHeadless(world, rt);
  const b = rt.visuals.bodies.find((v) => v.alive);
  return b ? Math.round(b.x - x) : -1;
}

export function sizeChecks(check: Check): void {
  const small = generateWorld(REFERENCE_SIDE, REFERENCE_SIDE, 3);
  const big = generateWorld(384, 384, 3);

  // 1. The same item, the same reach: an object, a creature, a building, a
  // settlement and a place keep the reach of the 112 cell island; a spell
  // and land are a share of the island they fall on.
  for (const form of ["object", "creature", "building", "settlement", "place"]) {
    const a = reachOnIsland(small, "major", form);
    const b = reachOnIsland(big, "major", form);
    check(`sizes: a major ${form} has the same reach on a 384 cell island as on the test's ${REFERENCE_SIDE}`, a > 0 && a === b, `${a} cells and ${b} cells`);
  }
  {
    const a = reachOnIsland(small, "major", "spell");
    const b = reachOnIsland(big, "major", "spell");
    const want = Math.round(TIER_REACH.major * 384);
    check("sizes: a major spell still covers its share of a big island", b === want && b > a * 3, `${a} on 112, ${b} on 384 (want ${want})`);
    check("sizes: land reaches as far as its tier on the island it shapes", castReach({ tier: "major", form: "land" }, 384, 384) === want);
  }
  check("sizes: a wonder's own reach wins over its form", castReach({ tier: "legendary", form: "place", reach: 9 }, 384, 384) === 9);
  check("sizes: an item with no form (a library spell) scales as a spell", castReach({ tier: "minor" }, 384, 288) === Math.round(TIER_REACH.minor * 288));

  // 2. The cast carries the form: the program's, else the element's own,
  // else a guess from its name (an artifact with none is an object).
  {
    const staff = castRequest("staff", { name: "Ember Staff", kind: "artifact", depth: 3, tier: "minor" }, { version: 1, summary: "", code: "x" });
    const tower = castRequest(
      "tower",
      { name: "Moon Spire", kind: "artifact", depth: 4, form: "building" },
      { version: 1, summary: "", code: "x", form: "building", giant: true },
    );
    const storm = castRequest("storm", { name: "Storm", kind: "spell", depth: 2 }, { version: 1, summary: "", code: "x" });
    check(
      "sizes: a cast carries the item's form and whether it is giant",
      staff.form === "object" &&
        staff.giant === false &&
        tower.form === "building" &&
        tower.giant === true &&
        storm.form === "spell" &&
        storm.tier === tierFromDepth(2),
      JSON.stringify([staff.form, tower.form, tower.giant, storm.form, storm.tier]),
    );
  }

  // 3. Grown within its kind: a villager grown five times over stays at most
  // 1.6 times its size, a dragon at most 3.2; a shrink still works.
  {
    const world = generateWorld(96, 96, 5);
    const rt = new Runtime(world, () => {});
    rt.cast(
      {
        key: "grow",
        name: "Growth",
        tier: "grand",
        code: `const spell = {
  creatures: [{ name: "Ember Dragon", base: "beast", color: "#c03020", speed: 2, hp: 300 }, { name: "Field Mouse", base: "beast", color: "#806040", speed: 2, hp: 20 }],
  *cast(w) {
    const d = w.spawn("Ember Dragon", w.x + 3, w.y);
    const m = w.spawn("Field Mouse", w.x - 3, w.y);
    const p = w.spawn("villager", w.x, w.y + 3);
    for (let k = 0; k < 5; k++) { d.resize(2); m.resize(2); p.resize(3); }
  } };`,
      },
      48,
      48,
    );
    stepHeadless(world, rt);
    const size = (kind: string) => world.creatures.find((c) => c.kind.toLowerCase().includes(kind))?.size ?? -1;
    const [dragon, mouse, person] = [
      size("dragon"),
      size("mouse"),
      world.creatures.filter((c) => c.kind === "villager").reduce((m, c) => Math.max(m, c.size), 0),
    ];
    check(
      "sizes: a spell grows a dragon to 3.2 times at most, a mouse and a villager to 1.6",
      Math.abs(dragon - GROW_MAX_BIG) < 1e-9 && Math.abs(mouse - GROW_MAX) < 1e-9 && person > 1 && person <= GROW_MAX + 1e-9,
      `dragon ${dragon}, mouse ${mouse}, villager ${person}`,
    );
    const shrunk = world.creatures.find((c) => c.kind.toLowerCase().includes("mouse"));
    if (shrunk) {
      rt.cast(
        { key: "shrink", name: "Shrink", tier: "minor", code: `const spell = { *cast(w) { for (const c of w.creatures(w.x, w.y, 6)) c.resize(0.25); } };` },
        Math.round(shrunk.x),
        Math.round(shrunk.y),
      );
      stepHeadless(world, rt);
    }
    check("sizes: a shrink still works", !!shrunk && shrunk.size < 0.5, `${shrunk?.size}`);
    const d = world.creatures.find((c) => c.kind.toLowerCase().includes("dragon"));
    if (d) {
      const k = kindOf(d);
      const rig = buildRig(k.body, d.look);
      const tall = drawScale(k.body, k.radius, rig, d.size) * rig.height;
      check(
        "sizes: a grown dragon is drawn within the height cap",
        tall <= MAX_HEIGHT * villagerUnits() + 1e-6,
        `${(tall / villagerUnits()).toFixed(2)} villagers`,
      );
    }
  }

  // 4. The view's cap holds after the size: a size of 6 (a program from
  // before this check, or a save) never draws a giant.
  {
    const spec = body("dragon");
    const rig = buildRig(spec, 0);
    const V = villagerUnits();
    const at1 = drawScale(spec, 1.1, rig, 1) * rig.height;
    const at6 = drawScale(spec, 1.1, rig, 6) * rig.height;
    const child = drawScale(spec, 1.1, rig, 0.68) * rig.height;
    check(
      "sizes: a figure of size 6 is drawn at the height cap at most, and a smaller size still draws smaller",
      at6 <= MAX_HEIGHT * V + 1e-6 && child < at1,
      `${(at1 / V).toFixed(2)}, ${(at6 / V).toFixed(2)} and ${(child / V).toFixed(2)} villagers`,
    );
  }
}
