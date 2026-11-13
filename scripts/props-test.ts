// Thin parts of a model (2026-11-13): a box with every side above zero is drawn, a side under
// FINE_BOX raised to FINE_BOX; a box with a side of zero, below zero or not a number is dropped.
// The looks revamp, phase 1 (2026-11-13): new shapes, turns, grain and soft shadow, all optional.
import { readFileSync } from "node:fs";
import { FINE_BOX, GRAIN, MAX_GRAIN, MAX_PROP_BOXES, SHAPES, propBounds, readBox, readProp, type Prop, type PropBox } from "../src/sim/props";
import { loadWorld, saveWorld } from "../src/sim/save";
import { generateWorld } from "../src/sim/world";
import { PROP_TRIANGLE_BUDGET, buildGround } from "../src/sim/voxel/props";
import { LOOK_VOXEL, propLocal, propTriangles, voxelize } from "../src/sim/voxel/shapes";
import { benchProps } from "./looks-bench";
import { lookMeshes, type Look } from "./looks-golden";

type Check = (name: string, ok: boolean, detail?: string) => void;

const prop = (boxes: unknown[]) => readProp({ key: "k", name: "book", x: 5, y: 5, turn: 0, boxes });

export function propChecks(check: Check): void {
  // A book: a cover, a spine and ten pages 0.02 thick.
  const book: unknown[] = [
    [0, 0, 0, 3, 4, 0.5, "#632"],
    [0, 0, 0, 0.3, 4, 0.5, "#421"],
  ];
  for (let i = 0; i < 10; i++) book.push([0.3, 0, 0.05 + i * 0.04, 2.6, 3.8, 0.02, "#eed"]);
  const p = prop(book);
  check("a book of 12 boxes with 0.02 thick pages keeps all 12", p?.boxes.length === 12, `${p?.boxes.length}`);
  check("a thin side is drawn at FINE_BOX, not thinner", !!p && p.boxes.slice(2).every((b) => b.h === FINE_BOX && b.w === 2.6), JSON.stringify(p?.boxes[2]));
  const t = prop([{ x: 0, y: 0, z: 0, w: 1, d: 0.001, h: 1, color: "#fff" }]);
  check("an object box 0.001 thick is drawn at FINE_BOX", t?.boxes[0]?.d === FINE_BOX, `${t?.boxes[0]?.d}`);
  const bad = prop([
    [0, 0, 0, 1, 1, 1, "#fff"],
    [0, 0, 0, 0, 1, 1, "#fff"],
    [0, 0, 0, 1, -1, 1, "#fff"],
    [0, 0, 0, 1, 1, NaN, "#fff"],
    [0, 0, 0, 1, 1, "x", "#fff"],
    [0, 0, 0, 1, 1, undefined, "#fff"],
  ]);
  check("boxes with a side of zero, negative or not a number are still dropped", bad?.boxes.length === 1, `${bad?.boxes.length}`);
  check("a prop of only zero-sided boxes is none", prop([[0, 0, 0, 0, 1, 1, "#fff"]]) === null);
  const many = prop(Array.from({ length: MAX_PROP_BOXES + 20 }, () => [0, 0, 0, 1, 1, 0.01, "#fff"]));
  check("a model still keeps MAX_PROP_BOXES at most", many?.boxes.length === MAX_PROP_BOXES, `${many?.boxes.length}`);
  check("a model keeps 160 parts (the looks revamp)", MAX_PROP_BOXES === 160);
  lookToolChecks(check);
}

const one = (b: PropBox | null, soft = true): Prop => ({ key: "k", name: "n", x: 0, y: 0, turn: 0, boxes: [b as PropBox], ...(soft ? { soft } : {}) });

function lookToolChecks(check: Check): void {
  // 20 stored looks draw byte for byte as main drew them before the new shapes (scripts/looks-golden.ts).
  const looks = JSON.parse(readFileSync("scripts/fixtures/looks-20.json", "utf8")) as Look[];
  const before = JSON.parse(readFileSync("scripts/fixtures/looks-20-mesh.json", "utf8")) as ReturnType<typeof lookMeshes>;
  const now = lookMeshes(looks);
  const changed = now.filter((m, i) => JSON.stringify(m) !== JSON.stringify(before[i])).map((m) => m.name);
  check(
    "20 stored looks give byte-identical meshes (positions and colours)",
    looks.length === 20 && before.length === 20 && changed.length === 0,
    changed.join(", "),
  );
  const read = looks.map((l) => readProp({ key: "k", name: l.name, x: 5, y: 5, turn: l.turn, boxes: l.boxes }));
  check(
    "a stored look reads with no new field and no soft shadow",
    read.every((p) => !!p && p.soft === undefined && p.boxes.every((b) => Object.keys(b).join() === "x,y,z,w,d,h,color,glow")),
  );

  // Each shape survives readBox, in an object and in a list, and fills its voxels (LOOK_VOXEL, a
  // quarter of a cell): a 1 by 1 by 1 part is 64 voxels as a box, fewer as a stepped wedge,
  // a round cyl, a stepped dome and a stepped spire.
  const want: Record<string, number> = { box: 64, wedge: 40, cyl: 48, dome: 32, cone: 20 };
  for (const [shape, voxels] of Object.entries(want)) {
    const o = readBox({ x: 0, y: 0, z: 0, w: 1, d: 1, h: 1, color: "#888", shape: shape.toUpperCase() });
    const a = readBox([0, 0, 2, 1, 1, 1, "#888", shape]);
    const g = voxelize([o as PropBox], LOOK_VOXEL);
    const m = propLocal(one(a));
    check(
      `a ${shape} survives readBox and is ${voxels} small cubes`,
      o?.shape === (shape === "box" ? undefined : shape) && a?.shape === o?.shape && g.count === voxels && m.tris > 0,
      `${o?.shape} ${a?.shape} ${g.count} voxels, ${m.tris} triangles`,
    );
  }
  const turned = voxelize([readBox({ x: 0, y: 0, z: 0, w: 2, d: 1, h: 1, rz: 45 }) as PropBox], LOOK_VOXEL);
  check("a turned box is a staircased block of about its volume", Math.abs(turned.count * LOOK_VOXEL ** 3 - 2) < 0.4, `${turned.count} voxels`);
  const thin = voxelize([readBox([0, 0, 0, 1, 0.05, 1, "#fff"]) as PropBox], LOOK_VOXEL);
  check("a part thinner than a voxel is drawn one voxel thick, not lost", thin.count === 16, `${thin.count}`);
  const over = voxelize(
    [readBox([0, 0, 0, 1, 1, 1, "#ffffff"]) as PropBox, readBox([0.25, 0, 0.25, 0.5, 0.05, 0.5, "#ff0000", "glow"]) as PropBox],
    LOOK_VOXEL,
  );
  check(
    "a later part paints over an earlier one (a window over its wall)",
    over.count === 64 && [...over.color].filter((c) => c === 0xff0000).length === 4 && [...over.glow].filter((x) => x).length === 4,
  );
  const turn = (v: unknown) => readBox({ x: 0, y: 0, z: 0, w: 1, d: 1, h: 1, rx: v, ry: v, rz: v });
  check(
    "turns wrap to -180..180 in degrees, and a turn that is not a number is none",
    turn(405)?.rz === 45 &&
      turn(-190)?.rx === 170 &&
      turn(180)?.ry === 180 &&
      turn(-180)?.ry === 180 &&
      turn(NaN)?.rz === undefined &&
      turn("45")?.rz === undefined &&
      turn(360)?.rz === undefined,
    JSON.stringify([turn(405), turn(-190), turn(-180)]),
  );
  const grain = (v: unknown) => readBox({ x: 0, y: 0, z: 0, w: 1, d: 1, h: 1, grain: v })?.grain;
  check(
    "grain is 0 to 0.3: true or the word is 0.08, more is 0.3, less or junk is none",
    grain(true) === GRAIN &&
      grain(5) === MAX_GRAIN &&
      grain(0.1) === 0.1 &&
      grain(-1) === undefined &&
      grain("lots") === undefined &&
      readBox([0, 0, 0, 1, 1, 1, "#fff", "grain"])?.grain === GRAIN,
  );
  const junk = readBox([0, 0, 0, 1, 1, 1, "#fff", "sphere", { shape: "blob", rx: "x" }, 7]);
  check("an unknown shape or junk after the colour is ignored", !!junk && Object.keys(junk).join() === "x,y,z,w,d,h,color,glow", JSON.stringify(junk));
  const listed = readBox([0, 0, 0, 1, 1, 1, "#fff", "glow", "cone", { rz: 30, grain: 0.1 }]);
  check(
    "a list can carry glow, a shape and an object of fields after the colour",
    listed?.glow === true && listed.shape === "cone" && listed.rz === 30 && listed.grain === 0.1,
    JSON.stringify(listed),
  );
  const mixed = readProp({
    key: "k",
    name: "n",
    x: 0,
    y: 0,
    turn: 0,
    boxes: [
      [0, 0, 0, 1, 1, 1, "#fff"],
      [0, 0, 1, 1, 1, 1, "#fff", "cone"],
    ],
  });
  check("a look with one new part is soft-shadowed", mixed?.soft === true);

  // Every face of every shape, turned any way, looks outward: just behind it is a voxel, just in front none.
  let inward = 0;
  let faces = 0;
  for (const shape of SHAPES)
    for (const [rx, ry, rz] of [
      [0, 0, 0],
      [30, 0, 0],
      [0, -50, 20],
      [170, 45, -90],
    ]) {
      const b = readBox({ x: 0.2, y: -0.3, z: 0.5, w: 1.3, d: 0.7, h: 2, color: "#888", shape, rx, ry, rz }) as PropBox;
      const g = voxelize([b], LOOK_VOXEL);
      const m = propLocal(one(b));
      // The view's x, up, south back to the model's x, y (south), z (up).
      const filled = (vx: number, vy: number, vz: number) => {
        const [x, y, z] = [vx, vz, vy].map((v, i) => Math.floor((v - g.o[i]) / g.s));
        if (z < Math.round(-g.o[2] / g.s)) return true;
        if (x < 0 || y < 0 || z < 0 || x >= g.n[0] || y >= g.n[1] || z >= g.n[2]) return false;
        return g.color[(z * g.n[1] + y) * g.n[0] + x] >= 0;
      };
      for (let t = 0; t < m.lit.pos.length; t += 9) {
        const p = [0, 1, 2].map((v) => m.lit.pos.slice(t + v * 3, t + v * 3 + 3));
        const e1 = p[1].map((x, i) => x - p[0][i]);
        const e2 = p[2].map((x, i) => x - p[0][i]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(n[0], n[1], n[2]);
        const mid = [0, 1, 2].map((i) => (p[0][i] + p[1][i] + p[2][i]) / 3);
        const at = (k: number) => mid.map((v, i) => v + (n[i] / l) * k) as [number, number, number];
        faces++;
        if (!filled(...at(-0.01)) || filled(...at(0.01))) inward++;
      }
    }
  check("every face of every shape, turned any way, faces outward from its voxels", faces > 300 && inward === 0, `${inward} of ${faces}`);
  const flat = readProp({ key: "k", name: "n", x: 0, y: 0, turn: 0, boxes: [{ x: -2, y: -0.1, z: 0, w: 4, d: 0.2, h: 0.2, rz: 90 }] });
  const fb = flat ? propBounds(flat) : null;
  check(
    "a part turned a quarter about the up line spans the other way",
    !!fb && Math.abs(fb.y1 - fb.y0 - 4) < 1e-6 && Math.abs(fb.x1 - fb.x0 - 0.2) < 1e-6,
    JSON.stringify(fb),
  );

  // Light: a soft box in the air is as bright on top as a plain one; soft shadow darkens where parts meet.
  const lone = propLocal(one(readBox([0, 0, 1, 1, 1, 1, "#808080"])));
  const plain = propLocal(one(readBox([0, 0, 1, 1, 1, 1, "#808080"]), false));
  const top = (a: number[]) => Math.max(...a);
  check(
    "a soft box in the air is lit as a plain one (no shadow, top as bright)",
    Math.abs(top(lone.lit.col) - top(plain.lit.col)) < 1e-6,
    `${top(lone.lit.col)} ${top(plain.lit.col)}`,
  );
  // A floor 3 by 3 (one voxel thick) with a wall on its west edge: the floor by the wall is darker than away from it.
  const room = propLocal({
    key: "k",
    name: "n",
    x: 0,
    y: 0,
    turn: 0,
    boxes: [readBox([0, 0, 0, 3, 3, 0.25, "#808080"]) as PropBox, readBox([0, 0, 0.25, 0.25, 3, 2, "#808080"]) as PropBox],
    soft: true,
  });
  let byWall = 1;
  let away = 0;
  for (let i = 0; i < room.lit.pos.length; i += 3) {
    if (Math.abs(room.lit.pos[i + 1] - 0.25) > 1e-6) continue;
    const x = room.lit.pos[i];
    if (Math.abs(x - 0.25) < 1e-6) byWall = Math.min(byWall, room.lit.col[i]);
    if (Math.abs(x - 3) < 1e-6) away = Math.max(away, room.lit.col[i]);
  }
  check("soft shadow: the floor by a wall is darker than the floor away from it", byWall < away * 0.9, `${byWall} ${away}`);
  const stand = propLocal(one(readBox([0, 0, 0, 1, 1, 2, "#808080"])));
  let foot = 1;
  let head = 0;
  // Its east face only (every corner at x = 1): the same light, so only the shadow differs.
  for (let t = 0; t < stand.lit.pos.length; t += 9) {
    if (![0, 3, 6].every((v) => Math.abs(stand.lit.pos[t + v] - 1) < 1e-9)) continue;
    for (const v of [0, 3, 6]) {
      const y = stand.lit.pos[t + v + 1];
      if (y < 1e-6) foot = Math.min(foot, stand.lit.col[t + v]);
      else if (y > 1.99) head = Math.max(head, stand.lit.col[t + v]);
    }
  }
  check("soft shadow: a pillar is darker at its foot, where it meets the ground", foot < head * 0.95, `${foot} ${head}`);
  const flatTop = propLocal(one(readBox([0, 0, 1, 2, 2, 1, "#808080"])));
  check("faces that match are merged: a lone block in the air is 6 quads", flatTop.tris === 12, `${flatTop.tris}`);

  // Grain: a tone per voxel; the same look draws the same tones.
  const slab = () => propLocal(one(readBox([0, 0, 0, 2, 2, 2, "#808080", "grain"]), false));
  const g1 = slab();
  const tones = new Set<number>();
  for (let i = 0; i < g1.lit.pos.length; i += 9)
    if (g1.lit.pos[i + 1] > 1.99 && g1.lit.pos[i + 4] > 1.99 && g1.lit.pos[i + 7] > 1.99) tones.add(Math.round(g1.lit.col[i + 3] * 1000));
  check("grain gives the 8 by 8 voxels on top of a 2-cell block many tones", tones.size >= 20, `${g1.tris} triangles, ${tones.size} tones`);
  check("grain is the same every time (seeded by the part)", JSON.stringify(slab().lit.col) === JSON.stringify(g1.lit.col));

  // The cost guard: 60 looks of 160 parts, the nearest drawn in full within the budget, the rest with coarser voxels.
  const world = generateWorld(96, 96, 5);
  world.props = benchProps(true, true);
  const t0 = performance.now();
  const { lit, glow, stats } = buildGround(world, { x: 8, y: 8 });
  const ms = performance.now() - t0;
  const drawn = (lit.pos.length + glow.pos.length) / 9;
  const near = propLocal(world.props[0]).tris;
  const far = propLocal(world.props[0], true).tris;
  check(
    "60 looks of 160 parts: the looks drawn in full stay within the triangle budget, the far ones coarser",
    drawn === stats.triangles && stats.full <= PROP_TRIANGLE_BUDGET && far < near && world.props.every((p) => p.boxes.length === MAX_PROP_BOXES),
    `${drawn} triangles (${stats.full} in full), ${stats.simpler} coarser, a look ${near} near and ${far} far, built in ${Math.round(ms)} ms`,
  );
  check("the budget counts a look's triangles as the mesh draws them", propTriangles(world.props[3]) === propLocal(world.props[3]).tris);
  const few = generateWorld(64, 64, 5);
  few.props = looks.map(
    (l, i) => readProp({ key: `f${i}`, name: l.name, x: 6 + (i % 5) * 12, y: 6 + Math.floor(i / 5) * 12, turn: l.turn, boxes: l.boxes }) as Prop,
  );
  const fewStats = buildGround(few, { x: 32, y: 32 }).stats;
  check("the 20 stored looks together stay under the budget: none drawn simpler", fewStats.simpler === 0, `${fewStats.triangles} triangles`);

  // A save keeps the new fields and the soft shadow.
  const kept = generateWorld(32, 32, 3);
  kept.props = [
    readProp({
      key: "k",
      name: "Tower",
      x: 10,
      y: 10,
      turn: 0,
      boxes: [
        [0, 0, 0, 1, 1, 3, "#999", "cyl", "grain"],
        [0, 0, 3, 1.2, 1.2, 1, "#c55", "cone", { rz: 22.5 }],
      ],
    }) as Prop,
  ];
  const back = loadWorld(JSON.parse(JSON.stringify(saveWorld(kept, new Map()))), () => {});
  const bp = back?.props[0];
  check(
    "a save keeps shapes, turns, grain and soft shadow",
    !!bp && bp.soft === true && bp.boxes[0].shape === "cyl" && bp.boxes[0].grain === GRAIN && bp.boxes[1].shape === "cone" && bp.boxes[1].rz === 22.5,
    JSON.stringify(bp?.boxes),
  );
}
