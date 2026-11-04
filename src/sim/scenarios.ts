import { makeCreature, populate } from "./creatures";
import { C, F, G, S } from "./materials";
import { Rng } from "./noise";
import { addGas } from "./cells";
import { forDisc } from "./physics";
import { TICK, buildVillage, plainWorld, plantForest, type World } from "./world";

// Challenges: hand-made islands with one problem and a way to win. They run
// in their own world, never in the player's sandbox, and cost no API calls.
// Each can be solved in several ways, so discovery becomes a hunt for a spell
// that does the right thing.

export type ScenarioStatus = "playing" | "won" | "lost";

export interface ScenarioRun {
  // Runs every tick: the ongoing hazard (a vent, a rising sea, the sun).
  tick(world: World): void;
  // What to show, and whether it is over.
  check(world: World): { text: string; status: ScenarioStatus };
}

export interface Scenario {
  id: string;
  build(): { world: World; run: ScenarioRun; focus: { x: number; y: number; dist: number } };
}

const SIZE = 112;
// Animals that cannot change a challenge's outcome: birds fly over fire and
// fish stay in the water. Deer, boars and the rest would carry fire.
const CHALLENGE_WILD = ["bird", "fish"];

function villagers(world: World, test: (c: World["creatures"][number]) => boolean = () => true): number {
  return world.creatures.filter((c) => !c.dead && c.kind === "villager" && test(c)).length;
}

function count(world: World, test: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < world.n; i++) if (test(i)) n++;
  return n;
}

const houses = (world: World) => count(world, (i) => world.cover[i] === C.HOUSE);

export const SCENARIOS: Scenario[] = [
  {
    id: "wildfire",
    build() {
      const world = plainWorld(SIZE, SIZE, 101, 12, 2);
      const rng = new Rng(101);
      buildVillage(world, 86, 70, rng);
      plantForest(world, 6, 12, 72, 104, 0.82);
      // Orchards and hedges reach the houses, so the fire has a road to the village.
      plantForest(world, 72, 46, 84, 96, 0.72);
      populate(world, CHALLENGE_WILD);
      world.wind.x = 1.3;
      world.wind.y = 0.2;
      // It starts small, deep in the forest: there is time to act.
      forDisc(world, 12, 56, 5, (i) => (world.fire[i] = 1));
      const v0 = villagers(world);
      const h0 = houses(world);
      let calm = 0;
      // House cells burnt so far, whatever was rebuilt since (4.3).
      let burnt = 0;
      let lastH = h0;
      return {
        world,
        focus: { x: 50, y: 60, dist: 120 },
        run: {
          tick() {},
          check(w) {
            const fire = count(w, (i) => w.fire[i] > 0.05);
            const v = villagers(w);
            const h = houses(w);
            calm = fire === 0 ? calm + 0.5 : 0;
            // A house is 4 cells; one partly burnt still stands.
            const text = `Burning: ${fire} · villagers ${v}/${v0} · houses ${Math.ceil(h / 4)}/${Math.ceil(h0 / 4)}, lose 2 and it falls`;
            // Decided the moment it happens. Villagers rebuild ruins, so a
            // village that burned and was rebuilt while the fire died down
            // used to count as saved: doing nothing won 1 time in 5. Burnt
            // houses add up (4.3): villagers who get about better rebuilt
            // each house as the next one burned, and doing nothing won again,
            // 1 time in 24, without two houses ever down at once.
            burnt += Math.max(0, lastH - h);
            lastH = h;
            if (burnt >= 8) return { text: "The fire took the village.", status: "lost" };
            if (v < v0 * 0.6) return { text: "The fire took too many villagers.", status: "lost" };
            if (calm >= 3) return { text: "The fire is out and the village stands!", status: "won" };
            return { text, status: "playing" };
          },
        },
      };
    },
  },
  {
    id: "lava",
    build() {
      const world = plainWorld(SIZE, SIZE, 202, 10, 1.5);
      const rng = new Rng(202);
      // The land slopes from the volcano down to the village.
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) world.height[y * SIZE + x] += (SIZE * 2 - x - y) * 0.05;
      forDisc(world, 24, 24, 24, (i, k) => {
        world.height[i] += 18 * k * k;
        world.ground[i] = k > 0.5 ? G.BASALT : k > 0.2 ? G.ROCK : world.ground[i];
      });
      forDisc(world, 24, 24, 3, (i) => (world.height[i] -= 3));
      buildVillage(world, 78, 78, rng);
      plantForest(world, 40, 50, 64, 70, 0.4);
      populate(world, CHALLENGE_WILD);
      for (let i = 0; i < world.n; i++) world.temp[i] = world.ambient(i);
      const h0 = houses(world);
      const ERUPTION = 70;
      return {
        world,
        focus: { x: 52, y: 52, dist: 125 },
        run: {
          tick(w) {
            if (w.time > ERUPTION) return;
            forDisc(w, 24, 24, 3, (i) => w.place(i, "lava", 0.2));
            if (w.tick % 3 === 0) {
              addGas(w, 24 * SIZE + 24, S.SMOKE, 0.8);
              w.particles.add({
                x: 24 + w.rng.next() * 4 - 2,
                y: 24 + w.rng.next() * 4 - 2,
                z: 2,
                vz: 10 + w.rng.next() * 10,
                vx: w.rng.next() * 6 - 3,
                vy: w.rng.next() * 6 - 3,
                life: 1.6,
                color: 0xff8a2a,
                size: 1.4,
                glow: true,
                gravity: 12,
              });
            }
            if (w.tick % 60 === 0) w.emit({ kind: "shake", amount: 2, seconds: 0.4 });
          },
          check(w) {
            const h = houses(w);
            const left = Math.max(0, Math.ceil(ERUPTION + 8 - w.time));
            if (h < h0 * 0.75) return { text: "The lava reached the village.", status: "lost" };
            if (left === 0) return { text: "The mountain sleeps again, and the village stands!", status: "won" };
            return { text: `${w.time < ERUPTION ? "Erupting" : "Cooling"}: ${left}s · houses ${Math.round(h / 4)}/${Math.round(h0 / 4)}`, status: "playing" };
          },
        },
      };
    },
  },
  {
    id: "river",
    build() {
      const world = plainWorld(SIZE, SIZE, 303, 12, 1);
      const rng = new Rng(303);
      // A wide river with gentle sandy banks.
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const i = y * SIZE + x;
          const d = Math.abs(y - 54 - Math.sin(x / 14) * 3) / 12;
          if (d < 1) {
            const k = 1 - d;
            world.height[i] -= 8.5 * k * k * (3 - 2 * k);
            if (world.height[i] < 9.5) world.ground[i] = G.SAND;
          }
          if (world.height[i] < world.seaLevel) world.setFluid(i, F.WATER, world.seaLevel - world.height[i]);
        }
      }
      buildVillage(world, 56, 90, rng);
      plantForest(world, 4, 4, 40, 30, 0.45);
      plantForest(world, 76, 4, 108, 30, 0.45);
      populate(world, CHALLENGE_WILD);
      for (let k = 0; k < 8; k++) {
        const c = makeCreature("villager", 44 + k * 3, 30 + (k % 3));
        c.homeX = 56;
        c.homeY = 92;
        c.data.traveler = true;
        world.creatures.push(c);
      }
      const home = (c: World["creatures"][number]) => c.data.traveler === true && c.y > 70;
      return {
        world,
        focus: { x: 56, y: 56, dist: 105 },
        run: {
          tick() {},
          check(w) {
            const alive = villagers(w, (c) => c.data.traveler === true);
            const done = villagers(w, home);
            if (done >= 4) return { text: `${done} travelers are home!`, status: "won" };
            if (alive < 4) return { text: "Too many travelers were lost.", status: "lost" };
            return { text: `Travelers home: ${done}/4 · alive ${alive}/8`, status: "playing" };
          },
        },
      };
    },
  },
  {
    id: "drought",
    build() {
      const world = plainWorld(SIZE, SIZE, 404, 12, 1.5);
      const rng = new Rng(404);
      buildVillage(world, 56, 56, rng);
      populate(world, CHALLENGE_WILD);
      const farm: number[] = [];
      forDisc(world, 56, 56, 34, (i, k) => {
        const d = (1 - k) * 34;
        if (d < 12 || world.cover[i] === C.HOUSE) return;
        world.ground[i] = G.SAND;
        world.setCover(i, world.rng.next() < 0.04 ? C.STUMP : C.NONE);
        farm.push(i);
      });
      for (let i = 0; i < world.n; i++) {
        if (world.ground[i] === G.GRASS && world.rng.next() < 0.5) world.ground[i] = G.DIRT;
      }
      const wet = new Float32Array(world.n);
      const green = (w: World, i: number) =>
        w.ground[i] === G.GRASS || w.ground[i] === G.FIELD || w.cover[i] === C.CROP || w.cover[i] === C.TREE || w.cover[i] === C.BUSH;
      let held = 0;
      return {
        world,
        focus: { x: 56, y: 56, dist: 110 },
        run: {
          tick(w) {
            // The sun: dry fields stay dust and green ones wither, unless watered.
            if (w.tick % 10 !== 0) return;
            const dt = TICK * 10;
            for (const i of farm) {
              if (w.depth[i] > 0.05 && w.fluid[i] === F.WATER) wet[i] = 40;
              else wet[i] = Math.max(0, wet[i] - dt);
              if (wet[i] > 0) {
                if (w.ground[i] === G.SAND && w.rng.next() < 0.05) {
                  w.ground[i] = G.FIELD;
                  if (w.cover[i] === C.NONE) w.setCover(i, C.CROP);
                }
              } else if (green(w, i) && w.rng.next() < 0.004) {
                w.ground[i] = G.SAND;
                if (w.cover[i] === C.CROP) w.setCover(i, C.NONE);
              }
            }
          },
          check(w) {
            const g = farm.filter((i) => green(w, i)).length;
            const share = g / farm.length;
            held = share >= 0.65 ? held + 0.5 : 0;
            if (held >= 5) return { text: "The fields are green again!", status: "won" };
            return { text: `Green farmland: ${Math.round(share * 100)}% of 65%${held > 0 ? " · hold it…" : ""}`, status: "playing" };
          },
        },
      };
    },
  },
  {
    id: "flood",
    build() {
      const world = plainWorld(SIZE, SIZE, 505, 10, 2);
      const rng = new Rng(505);
      // Low to the north, where the sea comes from.
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) world.height[y * SIZE + x] += (y / SIZE) * 6 - 2;
      for (let i = 0; i < world.n; i++) if (world.height[i] < world.seaLevel) world.setFluid(i, F.WATER, world.seaLevel - world.height[i]);
      buildVillage(world, 56, 50, rng);
      plantForest(world, 4, 70, 108, 108, 0.35);
      populate(world, CHALLENGE_WILD);
      const v0 = villagers(world);
      const RISE = 50;
      return {
        world,
        focus: { x: 56, y: 45, dist: 110 },
        run: {
          tick(w) {
            if (w.time > RISE) return;
            // Like a bathtub: every cell below the waterline that touches the
            // sea floods, one cell further each tick. Walls above it hold.
            const sea = 8 + (w.time / RISE) * 6.5;
            const wet = (j: number) => w.fluid[j] === F.WATER && w.depth[j] > 0.05;
            for (let y = 0; y < SIZE; y++) {
              for (let x = 0; x < SIZE; x++) {
                const i = y * SIZE + x;
                if (w.height[i] >= sea || (w.fluid[i] !== F.WATER && w.fluid[i] !== F.NONE)) continue;
                const touches =
                  y === 0 || wet(i) || (x > 0 && wet(i - 1)) || (x < SIZE - 1 && wet(i + 1)) || (y > 0 && wet(i - SIZE)) || (y < SIZE - 1 && wet(i + SIZE));
                if (touches && w.depth[i] < sea - w.height[i]) w.setFluid(i, F.WATER, sea - w.height[i]);
              }
            }
          },
          check(w) {
            const v = villagers(w);
            const left = Math.max(0, Math.ceil(RISE + 10 - w.time));
            if (v < v0 * 0.5) return { text: "The sea took the village.", status: "lost" };
            if (left === 0) return { text: "The sea falls back, and the village survived!", status: "won" };
            return { text: `${w.time < RISE ? "Rising" : "Holding"}: ${left}s · villagers ${v}/${v0}`, status: "playing" };
          },
        },
      };
    },
  },
];
