// Bestiary (3.5): every body plan, feature, wild animal and villager look,
// drawn by the game's own figure code (src/sim/voxel/figures.ts) so what is
// seen here is what the island draws. Dev only, like the Spell Lab.
//
//   npx vite --port 5174, then http://localhost:5174/lab/bestiary.html
//   ?pose=walk|idle|fly|dead|frozen  &t=<seconds> freezes the clock  &far=1  &only=<section>
//
// scripts/bestiary.mjs takes the screenshots in docs/visual-checks.
import { BoxGeometry, Color, ColorManagement, LinearSRGBColorSpace, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from "three";
import { body, bodyFrom, FEATURES, ITEMS, PLANS, type BodySpec, type Feature, type ModelBox } from "../src/sim/body";
import { KINDS } from "../src/sim/creatures";
import { JOBS, packLook, STYLES, type Look } from "../src/sim/villagers";
import { Figures, figureMaterials, type Pose } from "../src/sim/voxel/figures";
import { buildRig, paletteOf, ROLES, type Rig } from "../src/sim/voxel/rigs";

ColorManagement.enabled = false;

interface Entry {
  label: string;
  spec: BodySpec;
  color: number;
  look?: number;
  radius?: number;
  glow?: boolean;
}

const kind = (name: string) => KINDS.get(name)!;
const PLAN_LOOK: Record<string, { color: number; radius: number; color2?: number; glow?: boolean }> = {
  "two legs": { color: 0x6a7fd0, radius: 0.55 },
  "four legs": { color: 0xe8e2d0, radius: 0.75 },
  bird: { color: 0x3b6ea8, radius: 0.45 },
  fish: { color: 0xe67e22, radius: 0.5 },
  serpent: { color: 0x4f9136, radius: 0.7, color2: 0xd8c040 },
  insect: { color: 0x2b2b2b, radius: 0.5, color2: 0xe6b422 },
  spider: { color: 0x3a2a2a, radius: 0.6, color2: 0xc0392b },
  slime: { color: 0x5ad15a, radius: 0.6 },
  spirit: { color: 0xc9f6ff, radius: 0.6, glow: true },
  golem: { color: 0x8d8d96, radius: 1, color2: 0x9dfcff },
  dragon: { color: 0xb03a2e, radius: 1.1, color2: 0xe0a030 },
  "tree folk": { color: 0x6b4a2b, radius: 0.8 },
};

const look = (l: Partial<Look>) => packLook({ age: "adult", job: "none", style: 0, skin: 0, hair: 1, long: false, ...l });
const villager = kind("villager").body;
const shirt = (style: number, n = 0) => STYLES[style].shirts[n % STYLES[style].shirts.length];

// Models as Claude would write them: integer boxes, y up, facing +z.
const MODELS: { label: string; color: number; boxes: [number, number, number, number, number, number, string, string?][] }[] = [
  {
    label: "model: walking eye",
    color: 0xffffff,
    boxes: [
      [-3, 3, -3, 6, 6, 6, "#f2efe6"],
      [-2, 4, 3, 4, 4, 1, "#3a7fd0", "glow"],
      [-1, 5, 4, 2, 2, 1, "#111111"],
      [-3, 0, -1, 1, 3, 1, "#c05050", "leg"],
      [2, 0, -1, 1, 3, 1, "#c05050", "leg2"],
      [-1, 9, -1, 2, 2, 2, "#c05050"],
    ],
  },
  {
    label: "model: mimic chest",
    color: 0xffffff,
    boxes: [
      [-4, 0, -3, 8, 4, 6, "#8a5a2b"],
      [-4, 4, -3, 8, 2, 6, "#7a4a22", "head"],
      [-4, 3, 3, 8, 1, 1, "#f2f2f2"],
      [-3, 2, 3, 1, 2, 1, "#f2f2f2"],
      [2, 2, 3, 1, 2, 1, "#f2f2f2"],
      [-1, 3, 3, 2, 1, 1, "#e0c040"],
      [-2, 5, 3, 1, 1, 1, "#ffd84a", "glow"],
      [1, 5, 3, 1, 1, 1, "#ffd84a", "glow"],
    ],
  },
  {
    label: "model: mushroom folk",
    color: 0xffffff,
    boxes: [
      [-2, 0, -1, 1, 3, 2, "#e8dcc0", "leg"],
      [1, 0, -1, 1, 3, 2, "#e8dcc0", "leg2"],
      [-2, 3, -2, 4, 5, 4, "#f0e6d0"],
      [-5, 8, -5, 10, 3, 10, "#c0392b", "head"],
      [-3, 11, -3, 6, 1, 6, "#c0392b", "head"],
      [-3, 10, 5, 2, 1, 1, "#ffffff", "head"],
      [2, 10, 4, 1, 1, 1, "#ffffff", "head"],
      [-1, 6, 2, 1, 1, 1, "#222222"],
      [1, 6, 2, 1, 1, 1, "#222222"],
      [-3, 4, -1, 1, 3, 1, "#f0e6d0", "arm"],
      [2, 4, -1, 1, 3, 1, "#f0e6d0", "arm2"],
    ],
  },
  {
    label: "model: storm cloud",
    color: 0xffffff,
    boxes: [
      [-5, 4, -3, 10, 4, 6, "#9aa4b0"],
      [-3, 8, -2, 7, 3, 4, "#b0b8c4"],
      [-6, 3, -2, 3, 3, 4, "#8a94a0", "wing"],
      [3, 3, -2, 3, 3, 4, "#8a94a0", "wing"],
      [-1, 0, 0, 1, 4, 1, "#fff27a", "glow"],
      [1, 1, 1, 1, 3, 1, "#fff27a", "glow"],
      [-2, 6, 3, 1, 1, 1, "#ffffff", "glow"],
      [1, 6, 3, 1, 1, 1, "#ffffff", "glow"],
    ],
  },
];

const asModel = (m: (typeof MODELS)[number]): ModelBox[] =>
  m.boxes.map(([x, y, z, w, h, d, color, part]) => ({ x, y, z, w, h, d, color: parseInt(color.slice(1), 16), part: (part ?? null) as ModelBox["part"] }));

const SECTIONS: { title: string; entries: Entry[] }[] = [
  {
    title: "Body plans",
    entries: PLANS.map((plan) => {
      const l = PLAN_LOOK[plan];
      return { label: plan, spec: body(plan, [], { color2: l.color2 ?? null }), color: l.color, radius: l.radius, glow: l.glow };
    }),
  },
  {
    title: "Features, on two legs",
    entries: ([...FEATURES, ...ITEMS] as Feature[]).map((f) => ({ label: f, spec: body("two legs", [f]), color: 0x7a6ab0 })),
  },
  {
    title: "Features on any body",
    entries: [
      { label: "four legs: wings, horns", spec: body("four legs", ["wings", "horns"], { color2: 0xf2f2f2 }), color: 0xd8d0c0, radius: 0.75 },
      { label: "four legs: horn, mane", spec: body("four legs", ["horn", "mane"], { color2: 0xd0a0f0 }), color: 0xf4f4f4, radius: 0.8 },
      { label: "serpent: wings, crown", spec: body("serpent", ["wings", "crown"]), color: 0x2e86c1, radius: 0.7 },
      { label: "slime: hat, glowing eyes", spec: body("slime", ["hat", "glowing eyes"], { color2: 0x5b2d8a }), color: 0x7ad0f0, radius: 0.6 },
      { label: "spider: armor, glowing eyes", spec: body("spider", ["armor", "glowing eyes"], { color2: 0xff3030 }), color: 0x2a2a2a, radius: 0.6 },
      { label: "fish: crown", spec: body("fish", ["crown"]), color: 0xe0b030, radius: 0.5 },
      { label: "bird: hood, staff", spec: body("bird", ["hood", "staff"], { color2: 0x3a2a5a }), color: 0x222222, radius: 0.5 },
      { label: "golem: armor, hammer", spec: body("golem", ["armor", "hammer"], { color2: 0xff8a2a }), color: 0x6a5a50, radius: 1 },
      { label: "tree folk: crown, lantern", spec: body("tree folk", ["crown", "lantern"]), color: 0x5b3d24, radius: 0.8 },
      { label: "spirit: hood, torch", spec: body("spirit", ["hood", "torch"], { color2: 0x4a3b5c }), color: 0xb8a0ff, radius: 0.6, glow: true },
      { label: "insect: wings", spec: body("insect", ["wings"], { color2: 0xe6b422 }), color: 0x2b2b2b, radius: 0.45 },
      { label: "two legs: armor, shield", spec: body("two legs", ["armor", "shield"], { color2: 0x2e6fbf }), color: 0x8a8a90 },
    ],
  },
  {
    title: "Wildlife",
    entries: [
      { label: "deer (stag)", spec: kind("deer").body, color: 0xa0703c, look: 1, radius: kind("deer").radius },
      { label: "deer (doe)", spec: kind("deer").body, color: 0xb88450, look: 0, radius: kind("deer").radius },
      { label: "rabbit", spec: kind("rabbit").body, color: 0xb8a48c, radius: kind("rabbit").radius },
      { label: "wolf", spec: kind("wolf").body, color: 0x7a7a80, radius: kind("wolf").radius },
      { label: "boar", spec: kind("boar").body, color: 0x5a4636, radius: kind("boar").radius },
      { label: "bear", spec: kind("bear").body, color: 0x5b3a24, radius: kind("bear").radius },
      { label: "bird", spec: kind("bird").body, color: 0xc0392b, radius: kind("bird").radius },
      { label: "bird", spec: kind("bird").body, color: 0x2e86c1, radius: kind("bird").radius },
      { label: "fish", spec: kind("fish").body, color: 0x8fa3ad, radius: kind("fish").radius },
      { label: "fish", spec: kind("fish").body, color: 0xe67e22, radius: kind("fish").radius },
      { label: "beast (2.x base)", spec: kind("beast").body, color: 0xe8e2d0, radius: kind("beast").radius },
      { label: "golem (base)", spec: kind("golem").body, color: 0x8d8d96, radius: kind("golem").radius },
    ],
  },
  {
    title: "Villagers: jobs, ages",
    entries: [
      ...JOBS.map((job, n) => ({
        label: job === "none" ? "villager" : job,
        spec: villager,
        color: shirt(n % 6),
        look: look({ job, style: n % 6, skin: n % 6, hair: n % 6, long: n % 2 === 1 }),
      })),
      { label: "child", spec: villager, color: shirt(1, 1), look: look({ age: "child", style: 1, skin: 4, hair: 3 }), radius: 0.55 * 0.68 },
      { label: "child", spec: villager, color: shirt(2, 2), look: look({ age: "child", style: 2, skin: 3, hair: 0, long: true }), radius: 0.55 * 0.68 },
      { label: "elder", spec: villager, color: shirt(3, 1), look: look({ age: "elder", style: 3, skin: 1 }), radius: 0.55 * 0.95 },
      {
        label: "elder priest",
        spec: villager,
        color: shirt(4),
        look: look({ age: "elder", job: "priest", style: 4, skin: 2, long: true }),
        radius: 0.55 * 0.95,
      },
    ],
  },
  {
    title: "Clothes per village",
    entries: STYLES.flatMap((st, n) => [
      { label: st.name, spec: villager, color: st.shirts[0], look: look({ job: "farmer", style: n, skin: n, hair: n }) },
      { label: "", spec: villager, color: st.shirts[1], look: look({ job: "merchant", style: n, skin: (n + 2) % 6, hair: (n + 3) % 6, long: true }) },
    ]),
  },
  {
    title: "Spells from before 3.5: a body from the name",
    entries: [
      ["Fire Wolf", 0xd0541a],
      ["Lich King", 0x6a7a6a],
      ["Vampire", 0x3a0d1e],
      ["Dragonfly", 0x2ea0a0],
      ["Stone Golem", 0x8a8a80],
      ["Swamp Witch", 0x4a6a3a],
      ["Unicorn", 0xf4f4f4],
      ["Wolf Spirit", 0xa0d0ff],
      ["Holy Knight", 0xd8d8e0],
      ["Plague Rat", 0x5a5a3a],
      ["Phoenix", 0xff7a1a],
      ["Kraken", 0x7a3a6a],
    ].map(([name, color]) => ({ label: String(name), spec: bodyFrom({}, String(name).toLowerCase(), kind("beast").body), color: color as number })),
  },
  {
    title: "Models Claude designs (up to 16 boxes)",
    entries: MODELS.map((m) => ({ label: m.label, spec: body("two legs", [], { model: asModel(m) }), color: m.color, radius: 0.7 })),
  },
];

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new Scene();
scene.background = new Color(0xcfe8f7);
const figures = new Figures(scene, figureMaterials());

// Layout: rows of at most 12 (or ?cols), a gap between sections. x across, z down the page.
const COLS = Math.max(1, Math.min(12, Number(new URLSearchParams(location.search).get("cols")) || 12));
const STEP = 3.2;
interface Placed {
  e: Entry;
  rig: Rig;
  x: number;
  z: number;
  id: number;
}
const placed: Placed[] = [];
const titles: { text: string; x: number; z: number }[] = [];
let row = 0;
// ?only=2 draws one section, larger.
const only = params.has("only") ? Number(params.get("only")) : null;
for (const section of SECTIONS.filter((_, n) => only === null || n === only)) {
  titles.push({ text: section.title, x: -STEP * 0.6, z: row * STEP - STEP * 0.62 });
  section.entries.forEach((e, n) => {
    if (n && n % COLS === 0) row++;
    placed.push({ e, rig: buildRig(e.spec, e.look ?? 0), x: (n % COLS) * STEP, z: row * STEP, id: placed.length });
  });
  row += 1.45;
}
const width = (COLS - 1) * STEP;
const depth = row * STEP;

// A light slab under the figures, so the dead can sink into something.
const tile = new Mesh(new BoxGeometry(width + STEP * 1.6, 0.4, depth + STEP), new MeshBasicMaterial({ color: 0x9cc77a }));
tile.position.set(width / 2, -0.2, depth / 2 - STEP * 0.9);
scene.add(tile);

const camera = new OrthographicCamera(-1, 1, 1, -1, -200, 400);
function frameCamera(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  // Looking down at 50 degrees from the south: the page reads top to bottom.
  const tilt = (50 * Math.PI) / 180;
  const seenDepth = depth * Math.sin(tilt) + 3;
  const halfW = Math.max((width + STEP * 2) / 2, ((seenDepth + 2) / 2) * (w / h));
  const halfH = halfW * (h / w);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.position.set(width / 2, Math.sin(tilt) * 100, depth / 2 - STEP * 0.4 + Math.cos(tilt) * 100);
  camera.lookAt(width / 2, 0, depth / 2 - STEP * 0.4);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  placeLabels();
}

const labels = document.getElementById("labels")!;
function placeLabels(): void {
  labels.innerHTML = "";
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const at = (x: number, z: number) => {
    const v = new Vector3(x, 0, z).project(camera);
    return { left: ((v.x + 1) / 2) * w, top: ((1 - v.y) / 2) * h };
  };
  for (const p of placed) {
    if (!p.e.label) continue;
    const div = document.createElement("div");
    const { left, top } = at(p.x, p.z + 0.9);
    div.style.left = `${left}px`;
    div.style.top = `${top}px`;
    div.textContent = p.e.label;
    labels.append(div);
  }
  for (const t of titles) {
    const div = document.createElement("div");
    div.className = "section";
    const { left, top } = at(t.x, t.z);
    div.style.left = `${left}px`;
    div.style.top = `${top - 18}px`;
    div.textContent = t.text;
    labels.append(div);
  }
}

const radio = (v: string) => document.querySelector<HTMLInputElement>(`input[name=pose][value=${v}]`);
radio(params.get("pose") ?? "walk")!.checked = true;
const far = document.getElementById("far") as HTMLInputElement;
far.checked = params.get("far") === "1";
const spin = document.getElementById("spin") as HTMLInputElement;
const fixedTime = params.has("t") ? Number(params.get("t")) : null;
const stats = document.getElementById("stats")!;
const palette = new Array(ROLES).fill(0);
const pose: Pose = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  scale: 1,
  phase: 0,
  moving: 0,
  time: 0,
  flying: false,
  still: false,
  nod: 0,
  detail: true,
  glowAll: false,
  tint: 0,
  tintAmount: 0,
  offset: 0,
};

const started = performance.now();
let addMs = 0;
function draw(): void {
  const t = fixedTime ?? (performance.now() - started) / 1000;
  const mode = document.querySelector<HTMLInputElement>("input[name=pose]:checked")!.value;
  const t0 = performance.now();
  figures.begin();
  for (const p of placed) {
    const size = (p.e.radius ?? 0.55) * 1.85;
    const dead = mode === "dead";
    pose.x = p.x;
    pose.z = p.z;
    pose.y = 0;
    pose.scale = size;
    // Facing the viewer, three quarters, unless turning.
    pose.yaw = spin.checked ? t * 0.8 + p.id : 0.6;
    pose.moving = mode === "walk" || mode === "fly" ? 1 : 0;
    pose.phase = t * 9 + p.id;
    pose.time = t;
    pose.flying = mode === "fly";
    pose.still = dead || mode === "frozen";
    pose.nod = 0;
    pose.detail = !far.checked;
    pose.glowAll = !!p.e.glow && !dead;
    pose.pitch = p.rig.lean;
    pose.roll = dead ? Math.PI / 2 : 0;
    pose.offset = p.id * 0.37;
    pose.tint = dead ? 0x5a5560 : 0xbfe6ff;
    pose.tintAmount = dead ? 0.55 : mode === "frozen" ? 0.6 : 0;
    // Fallen on its side, a few seconds before it starts to sink.
    if (dead) pose.y += p.rig.halfWidth * size;
    if (mode === "fly") pose.y += 0.6;
    figures.add(p.rig, paletteOf(palette, p.rig, p.e.spec, p.e.color, p.e.look ?? 0), pose);
  }
  figures.end();
  addMs = addMs * 0.9 + (performance.now() - t0) * 0.1;
  renderer.render(scene, camera);
  const info = renderer.info.render;
  stats.textContent = `${placed.length} figures · ${figures.parts} parts · ${info.calls} draw calls · ${Math.round(info.triangles / 1000)}k triangles · ${addMs.toFixed(2)} ms to pose`;
  if (fixedTime === null) requestAnimationFrame(draw);
}

window.addEventListener("resize", () => {
  frameCamera();
  if (fixedTime !== null) draw();
});
for (const input of document.querySelectorAll("input")) input.addEventListener("change", () => fixedTime !== null && draw());
frameCamera();
draw();
(window as unknown as { bestiaryReady: boolean }).bestiaryReady = true;
