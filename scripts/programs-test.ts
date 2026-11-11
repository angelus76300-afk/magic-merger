// Today's program shapes (World API versions 4 to 6), cast on the current
// runtime with what each one visibly does checked, not only "no error"
// (docs/REVIEW-2026-11-10.md, section 2: 446 of 483 live programs are
// version 6, and the old fixtures were versions 2 and 3). The programs are
// lab/programs (written for this), lab/creatures and the examples the spell
// writer is shown in worker/prompts.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateWorld, type World } from "../src/sim/world";
import { kindOf, populate } from "../src/sim/creatures";
import { Runtime } from "../src/sim/runtime";
import { C, F } from "../src/sim/materials";
import { mindOf } from "../src/sim/kin";
import { callingOf } from "../src/sim/villagers";
import { isArtifact } from "../src/sim/artifacts";
import { keyX, keyY } from "../src/sim/voxelkey";
import { FORM_EXAMPLES, FOX_SPIRIT_EXAMPLE, PERSON_EXAMPLE } from "../worker/prompts";
import { seed, step } from "./challenge-replay";

type Check = (name: string, ok: boolean, detail?: string) => void;
type Tier = "cantrip" | "minor" | "major" | "grand" | "legendary" | "cosmic";

interface Cast {
  world: World;
  rt: Runtime;
  x: number;
  y: number;
  errors: string[];
  before: Snapshot;
}
interface Snapshot {
  houses: number;
  villages: number;
  voxels: number;
  height: Float32Array;
}

const snap = (w: World): Snapshot => {
  let houses = 0;
  for (let i = 0; i < w.n; i++) if (w.cover[i] === C.HOUSE) houses++;
  return { houses, villages: w.villages.length, voxels: w.decor.size, height: Float32Array.from(w.height) };
};

// A dry, bare cell near the middle, so a program has room to act.
function spotOf(w: World): { x: number; y: number } {
  const cx = w.w >> 1;
  const cy = w.h >> 1;
  for (let r = 0; r < cx; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const i = w.idx(cx + dx, cy + dy);
        if (w.fluid[i] === F.NONE && w.cover[i] === C.NONE && w.height[i] > 2) return { x: cx + dx, y: cy + dy };
      }
  return { x: cx, y: cy };
}

function cast(name: string, code: string, tier: Tier, seconds: number): Cast & { ok: boolean } {
  const world = generateWorld(112, 112, 9);
  populate(world);
  const errors: string[] = [];
  const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
  const { x, y } = spotOf(world);
  const before = snap(world);
  const ok = rt.cast({ key: name, name, tier, code }, x, y);
  for (let k = 0; k < Math.round(seconds * 30) && !errors.length; k++) step(world, rt);
  return { world, rt, x, y, errors, before, ok };
}

const alive = (w: World, kind: (k: string) => boolean) => w.creatures.filter((c) => !c.dead && kind(c.kind));
const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => Math.hypot(a.x - b.x, a.y - b.y) <= r;
const artifactsNamed = (w: World, name: string) => w.landmarks.filter((l) => isArtifact(l) && l.name.toLowerCase() === name.toLowerCase());
const voxelsWithin = (w: World, x: number, y: number, r: number) => {
  let n = 0;
  for (const key of w.decor.keys()) if ((keyX(key) - x) ** 2 + (keyY(key) - y) ** 2 <= r * r) n++;
  return n;
};
const rise = (c: Cast, r: number) => {
  let most = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (!c.world.inside(c.x + dx, c.y + dy)) continue;
      const i = c.world.idx(c.x + dx, c.y + dy);
      most = Math.max(most, c.world.height[i] - c.before.height[i]);
    }
  return most;
};

// A person made by w.person: a villager near the spot with this title, and the calling when one is asked.
function person(c: Cast, title: string, calling?: string): [boolean, string] {
  const p = alive(c.world, (k) => k === "villager").find((v) => mindOf(v).title === title);
  if (!p) return [false, `no villager titled ${title}`];
  const has = callingOf(p.look ?? 0);
  return [calling === undefined || has === calling, `${title}, calling ${has}`];
}

// What each program visibly does. Returns [kept, what was seen].
const EXPECT: Record<string, { tier: Tier; seconds: number; see: (c: Cast) => [boolean, string] }> = {
  // lab/programs, written for this test.
  "v4-honey-shrine": {
    tier: "minor",
    seconds: 1,
    see: (c) => {
      const shrine = c.world.landmarks.find((l) => l.name === "Honey Shrine");
      let honey = 0;
      const id = c.world.materials.id("cover", "honeycomb");
      for (let i = 0; i < c.world.n; i++) if (id >= 0 && c.world.cover[i] === id) honey++;
      return [!!shrine && shrine.lures.includes("bear") && shrine.scares.includes("wolf") && honey >= 6, `shrine ${!!shrine}, ${honey} honeycomb cells`];
    },
  },
  "v5-glass-heron": {
    tier: "minor",
    seconds: 2,
    see: (c) => {
      const herons = alive(c.world, (k) => k === "glass heron");
      const body = herons[0] ? kindOf(herons[0]).body : undefined;
      return [herons.length === 2 && body?.plan === "bird" && !!body?.features.includes("wings"), `${herons.length} herons, plan ${body?.plan}`];
    },
  },
  "v6-ember-hoarder": {
    tier: "minor",
    seconds: 1,
    see: (c) => {
      const h = alive(c.world, (k) => k === "ember hoarder")[0];
      if (!h) return [false, "no hoarder"];
      const k = kindOf(h);
      // Hurt it below three quarters of its life: its own "flare" ability answers.
      h.hp = k.hp * 0.5;
      let flared = 0;
      for (let t = 0; t < 30 * 6 && !flared; t++) {
        step(c.world, c.rt);
        flared = Number(h.data.flared ?? 0);
      }
      return [k.goal === "keep the embers" && !!k.abilities?.some((a) => a.do === "flare") && flared > 0, `goal ${k.goal}, flared ${flared}`];
    },
  },
  "v6-tower-keep": {
    tier: "major",
    seconds: 1,
    see: (c) => {
      const tower = voxelsWithin(c.world, c.x, c.y, 3);
      const island = voxelsWithin(c.world, c.x + 12, c.y - 10, 5);
      const wall = voxelsWithin(c.world, c.x + 4, c.y + 6, 2);
      const cleared = voxelsWithin(c.world, c.x - 8, c.y + 6, 1.5);
      return [tower > 50 && island > 20 && wall > 4 && cleared === 0, `tower ${tower}, island ${island}, wall ${wall}, cleared corner ${cleared}`];
    },
  },
  "v6-tide-pull": {
    tier: "minor",
    seconds: 0.5,
    see: (c) => {
      let middle = 0;
      let pools = 0;
      for (let dy = -14; dy <= 14; dy++)
        for (let dx = -14; dx <= 14; dx++) {
          if (!c.world.inside(c.x + dx, c.y + dy)) continue;
          const wet = c.world.fluid[c.world.idx(c.x + dx, c.y + dy)] === F.WATER;
          const d = Math.hypot(dx, dy);
          if (wet && d <= 3) middle++;
          if (wet && d >= 8) pools++;
        }
      return [middle === 0 && pools > 10, `${pools} wet cells in the pools, ${middle} in the drained middle`];
    },
  },
  "v6-lamplighter": {
    tier: "minor",
    seconds: 0.6,
    see: (c) => {
      const lamps = artifactsNamed(c.world, "Road Lamp");
      const full = lamps.filter((l) => isArtifact(l) && l.art.charges === 5).length;
      const drawing = c.rt.visuals.drawings.find((d) => d.owner !== undefined);
      const calls: string[] = [];
      const ctx = new Proxy(
        {},
        { get: (_t, p) => (typeof p === "string" && p !== "then" ? (..._a: unknown[]) => void calls.push(p) : undefined), set: () => true },
      );
      drawing?.fn(ctx as unknown as CanvasRenderingContext2D, 0.5);
      return [
        lamps.length === 2 && full === 2 && calls.includes("arc"),
        `${lamps.length} lamps, ${full} with 5 charges, drawing calls ${calls.join(" ") || "none"}`,
      ];
    },
  },
  // lab/creatures and the prompt's examples (the same programs, by name).
  serpent: { tier: "minor", seconds: 2, see: (c) => serpent(c) },
  "serpent-a": { tier: "minor", seconds: 2, see: (c) => serpent(c) },
  Serpent: { tier: "minor", seconds: 2, see: (c) => serpent(c) },
  "fox-spirit": { tier: "minor", seconds: 2, see: (c) => fox(c) },
  "Fox Spirit": { tier: "minor", seconds: 2, see: (c) => fox(c) },
  "human-kind": {
    tier: "minor",
    seconds: 1,
    see: (c) => {
      const h = alive(c.world, (k) => k.startsWith("human") && k !== "villager")[0];
      return [!!h && kindOf(h).body?.plan === "two legs", h ? `${h.kind}, ${kindOf(h).body?.plan}` : "no human"];
    },
  },
  human: { tier: "minor", seconds: 1, see: (c) => person(c, "Human") },
  blacksmith: { tier: "minor", seconds: 1, see: (c) => person(c, "Blacksmith", "blacksmith") },
  Blacksmith: { tier: "minor", seconds: 1, see: (c) => person(c, "Blacksmith", "blacksmith") },
  knight: { tier: "minor", seconds: 1, see: (c) => person(c, "Knight", "knight") },
  necromancer: { tier: "minor", seconds: 1, see: (c) => person(c, "Necromancer", "necromancer") },
  forge: { tier: "minor", seconds: 1, see: (c) => forge(c) },
  Forge: { tier: "minor", seconds: 1, see: (c) => forge(c) },
  "storm-lantern": { tier: "minor", seconds: 1, see: (c) => lantern(c) },
  "Storm Lantern": { tier: "minor", seconds: 1, see: (c) => lantern(c) },
  village: { tier: "major", seconds: 1, see: (c) => village(c) },
  Village: { tier: "major", seconds: 1, see: (c) => village(c) },
  "healing-spring": { tier: "minor", seconds: 1, see: (c) => spring(c) },
  "Healing Spring": { tier: "minor", seconds: 1, see: (c) => spring(c) },
  volcano: { tier: "grand", seconds: 2, see: (c) => volcano(c) },
  Volcano: { tier: "grand", seconds: 2, see: (c) => volcano(c) },
  // A body that flies in and lands: fire where it hit.
  fireball: {
    tier: "major",
    seconds: 3,
    see: (c) => {
      let burning = 0;
      let dug = 0;
      for (let i = 0; i < c.world.n; i++) {
        if (c.world.fire[i] > 0) burning++;
        if (c.before.height[i] - c.world.height[i] > 0.3) dug++;
      }
      return [burning + dug > 3, `${burning} cells on fire, ${dug} dug`];
    },
  },
};

function serpent(c: Cast): [boolean, string] {
  const s = alive(c.world, (k) => k.startsWith("serpent"))[0];
  if (!s) return [false, "no serpent"];
  const k = kindOf(s);
  return [
    k.body?.plan === "serpent" && k.goal === "hunt" && !!k.abilities?.length,
    `${s.kind}, ${k.body?.plan}, goal ${k.goal}, ${k.abilities?.length ?? 0} abilities`,
  ];
}
function fox(c: Cast): [boolean, string] {
  const f = alive(c.world, (k) => k.startsWith("fox spirit"))[0];
  if (!f) return [false, "no fox spirit"];
  const k = kindOf(f);
  return [k.goal === "tend" && !!k.body?.features.includes("tail") && (k.abilities?.length ?? 0) >= 2, `goal ${k.goal}, ${k.abilities?.length ?? 0} abilities`];
}
function forge(c: Cast): [boolean, string] {
  const a = artifactsNamed(c.world, "Forge")[0];
  let smithy = 0;
  for (let i = 0; i < c.world.n; i++) if (c.world.cover[i] === C.SMITHY) smithy++;
  const model = c.world.props.some((p) => p.name === "Forge");
  return [!!a && smithy > 0 && model, `forge artifact ${!!a}, ${smithy} smithy cells, model ${model}`];
}
function lantern(c: Cast): [boolean, string] {
  const a = artifactsNamed(c.world, "Storm Lantern")[0];
  const model = c.world.props.some((p) => p.name === "Storm Lantern");
  return [
    !!a && isArtifact(a) && a.art.fuel !== null && a.art.fuel > 0 && model,
    `lantern ${!!a}, fuel ${a && isArtifact(a) ? a.art.fuel : "none"}, model ${model}`,
  ];
}
function village(c: Cast): [boolean, string] {
  let houses = 0;
  for (let i = 0; i < c.world.n; i++) if (c.world.cover[i] === C.HOUSE) houses++;
  const added = (houses - c.before.houses) / 4;
  return [c.world.villages.length > c.before.villages && added >= 3, `${c.world.villages.length - c.before.villages} new village, ${added} new houses`];
}
function spring(c: Cast): [boolean, string] {
  const wonder = c.world.wonders.find((w) => w.kind === "hot spring" && near(w, c, 20));
  let flowers = 0;
  for (let i = 0; i < c.world.n; i++) if (c.world.cover[i] === C.FLOWER) flowers++;
  return [!!wonder, `hot spring ${!!wonder}, ${flowers} flower cells`];
}
function volcano(c: Cast): [boolean, string] {
  const up = rise(c, 18);
  return [up > 4, `rose ${up.toFixed(1)} at most`];
}

export function programChecks(check: Check): void {
  const shared = Math.random;
  seed(3);
  const started = Date.now();
  const programs: { name: string; code: string }[] = [];
  for (const dir of ["lab/programs", "lab/creatures"])
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .sort())
      programs.push({ name: f.replace(/\.js$/, ""), code: readFileSync(join(dir, f), "utf8") });
  for (const ex of [...Object.values(FORM_EXAMPLES), FOX_SPIRIT_EXAMPLE, PERSON_EXAMPLE]) programs.push({ name: ex.name, code: ex.code });
  for (const p of programs) {
    const want = EXPECT[p.name];
    if (!want) {
      check(`program "${p.name}" says what it visibly does`, false, "no expectation: add one to EXPECT in scripts/programs-test.ts");
      continue;
    }
    const c = cast(p.name, p.code, want.tier, want.seconds);
    const [kept, seen] = c.ok && !c.errors.length ? want.see(c) : [false, c.errors[0] ?? "did not start"];
    check(`program "${p.name}" does what it says on today's runtime`, kept && !c.errors.length, seen);
  }
  // The 11 members no fixture touched before (review of 10 November).
  const used = ["tier", "dt", "angle", "noise", "drain", "unvoxel", "tower", "wall", "island", "artifacts", "draw"];
  const all = programs.map((p) => p.code).join("\n");
  const missing = used.filter((m) => !new RegExp(`\\bw\\.${m}\\b`).test(all));
  check(
    "today's fixtures call the 11 members no test touched",
    missing.length === 0,
    missing.length ? `not called: ${missing.join(", ")}` : `${programs.length} programs, ${Date.now() - started} ms`,
  );
  Math.random = shared;
}
