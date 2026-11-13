import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from "three";
import type { World } from "../world";
import type { Prop } from "../props";
import { heldScale } from "../held";
import { FAR_PARTS, isSoft, propLocal, propTriangles, type LocalMesh, type MeshArrays } from "./shapes";
import { columnTop } from "./terrain";

export type { MeshArrays } from "./shapes";

// The fine box models of items (4.6, props.ts), drawn like the wonders'
// models: every prop of the island merged into one mesh, and one more for
// what shines, rebuilt only when a prop is added or blown away. Each prop is
// turned about its center and stands on the ground under it as it was when
// the mesh was built. A look's own faces (voxel/shapes.ts, with its soft
// shadow) are made once and kept.
//
// The cost guard (looks revamp, phase 1): the props of an island draw
// PROP_TRIANGLE_BUDGET triangles at most in full, the nearest to where the
// camera looks first; past it a look made of fine voxels is drawn with voxels
// twice the side (FAR_COARSEN), and a stored look of boxes draws its largest
// FAR_PARTS parts. When
// some were drawn simpler, the mesh is made again once the camera has looked
// REFOCUS cells away.

export const PROP_TRIANGLE_BUDGET = 90_000;
const REFOCUS = 16;

export interface PropStats {
  triangles: number;
  // Of them, the looks drawn in full.
  full: number;
  simpler: number;
}

export class PropModels {
  private version = -1;
  private lit: Mesh | null = null;
  private glow: Mesh | null = null;
  // What hands hold (4.7, held.ts): rebuilt every frame while anything is held.
  private heldLit: Mesh | null = null;
  private heldGlow: Mesh | null = null;
  private full = new WeakMap<Prop, LocalMesh>();
  private simple = new WeakMap<Prop, LocalMesh>();
  private inHand = new WeakMap<Prop, LocalMesh>();
  // Where the camera looked when the mesh was made, while some looks are drawn simpler.
  private builtAt: { x: number; y: number } | null = null;
  stats: PropStats = { triangles: 0, full: 0, simpler: 0 };

  constructor(
    private scene: Scene,
    private litMaterial: Material,
    private glowMaterial: Material,
  ) {}

  update(world: World, groundAt?: (x: number, y: number) => number, focus?: { x: number; y: number }): void {
    this.updateHeld(world, groundAt);
    const refocus = this.builtAt && focus && Math.hypot(focus.x - this.builtAt.x, focus.y - this.builtAt.y) > REFOCUS;
    if (world.propsVersion === this.version && !refocus) return;
    this.version = world.propsVersion;
    this.disposeGround();
    const at = focus ?? { x: world.w / 2, y: world.h / 2 };
    const { lit, glow, stats } = buildGround(
      world,
      at,
      (p, simple) => this.local(p, simple),
      (p) => (isSoft(p) ? this.local(p, false).tris : propTriangles(p)),
    );
    this.stats = stats;
    this.builtAt = this.stats.simpler ? { x: at.x, y: at.y } : null;
    if (lit.pos.length) this.scene.add((this.lit = mesh(lit, this.litMaterial)));
    if (glow.pos.length) this.scene.add((this.glow = mesh(glow, this.glowMaterial)));
  }

  private local(p: Prop, simple: boolean): LocalMesh {
    const cache = simple ? this.simple : this.full;
    let m = cache.get(p);
    if (!m) cache.set(p, (m = propLocal(p, simple)));
    return m;
  }

  // A held object's own model, made HELD_SIZE tall at most, in its holder's
  // right hand, turned the way the holder faces.
  private updateHeld(world: World, groundAt?: (x: number, y: number) => number): void {
    this.disposeHeld();
    const held = world.props.filter((p) => p.heldBy != null);
    if (!held.length) return;
    const drawn: { m: LocalMesh; at: [number, number, number, number, number] }[] = [];
    for (const p of held) {
      const c = world.creatures.find((o) => o.id === p.heldBy);
      if (!c || c.dead) continue;
      let m = this.inHand.get(p);
      if (!m) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const b of p.boxes) {
          x0 = Math.min(x0, b.x);
          x1 = Math.max(x1, b.x + b.w);
          y0 = Math.min(y0, b.y);
          y1 = Math.max(y1, b.y + b.d);
        }
        this.inHand.set(p, (m = propLocal(p, false, heldScale(p.boxes), (x0 + x1) / 2, (y0 + y1) / 2)));
      }
      const side = c.hd - Math.PI / 2;
      const hx = c.x + 0.5 + Math.cos(c.hd) * 0.15 + Math.cos(side) * 0.3 - world.w / 2;
      const hz = c.y + 0.5 + Math.sin(c.hd) * 0.15 + Math.sin(side) * 0.3 - world.h / 2;
      const ground = (groundAt ? groundAt(c.x, c.y) : columnTop(world, Math.round(c.y) * world.w + Math.round(c.x))) + 0.35 + Math.max(0, c.z);
      drawn.push({ m, at: [Math.cos(c.hd), Math.sin(c.hd), hx, ground, hz] });
    }
    const lit = outFor(
      drawn.map((d) => d.m),
      false,
    );
    const glow = outFor(
      drawn.map((d) => d.m),
      true,
    );
    for (const d of drawn) append(d.m, ...d.at, lit, glow);
    if (lit.pos.length) this.scene.add((this.heldLit = mesh(lit, this.litMaterial)));
    if (glow.pos.length) this.scene.add((this.heldGlow = mesh(glow, this.glowMaterial)));
  }

  // How many meshes the props draw, for the HUD.
  meshes(): number {
    return (this.lit ? 1 : 0) + (this.glow ? 1 : 0) + (this.heldLit ? 1 : 0) + (this.heldGlow ? 1 : 0);
  }

  private disposeGround(): void {
    for (const m of [this.lit, this.glow]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.lit = null;
    this.glow = null;
  }

  private disposeHeld(): void {
    for (const m of [this.heldLit, this.heldGlow]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.heldLit = null;
    this.heldGlow = null;
  }

  dispose(): void {
    this.disposeGround();
    this.disposeHeld();
  }
}

// Where a mesh is written: floats, filled up to n.
export interface Out {
  pos: Float32Array;
  col: Float32Array;
  n: number;
}

const outFor = (meshes: LocalMesh[], glow: boolean): Out => {
  const n = meshes.reduce((t, m) => t + (glow ? m.glow : m.lit).pos.length, 0);
  return { pos: new Float32Array(n), col: new Float32Array(n), n: 0 };
};

// Every prop on the ground, nearest to `at` first, in full while the budget lasts.
export function buildGround(
  world: World,
  at: { x: number; y: number },
  local: (p: Prop, simple: boolean) => LocalMesh = (p, simple) => propLocal(p, simple),
  count: (p: Prop) => number = (p) => propTriangles(p),
  budget = PROP_TRIANGLE_BUDGET,
): { lit: Out; glow: Out; stats: PropStats } {
  const ground = world.props.filter((p) => p.heldBy == null);
  const order = ground.map((p, i) => ({ p, i, d: Math.hypot(p.x - at.x, p.y - at.y) })).sort((a, b) => a.d - b.d || a.i - b.i);
  const simpler = new Set<Prop>();
  let left = budget;
  for (const { p } of order) {
    const n = count(p);
    if (n > left && (isSoft(p) || p.boxes.length > FAR_PARTS)) simpler.add(p);
    else left -= n;
  }
  // Drawn in the island's own order, as before the budget.
  const meshes = ground.map((p) => local(p, simpler.has(p)));
  const lit = outFor(meshes, false);
  const glow = outFor(meshes, true);
  ground.forEach((p, i) => {
    const cx = Math.max(0, Math.min(world.w - 1, Math.round(p.x)));
    const cy = Math.max(0, Math.min(world.h - 1, Math.round(p.y)));
    append(meshes[i], Math.cos(p.turn), Math.sin(p.turn), p.x + 0.5 - world.w / 2, columnTop(world, cy * world.w + cx), p.y + 0.5 - world.h / 2, lit, glow);
  });
  const full = ground.reduce((t, p, i) => t + (simpler.has(p) ? 0 : meshes[i].tris), 0);
  return { lit, glow, stats: { triangles: meshes.reduce((t, m) => t + m.tris, 0), full, simpler: simpler.size } };
}

// One prop's faces, turned about its center and standing on `ground`, its
// center at (ox, oz) in the view: the lit parts in `lit`, what shines in `glow`.
export function propMesh(p: Prop, ground: number, ox: number, oz: number, lit: MeshArrays, glow: MeshArrays): void {
  const m = propLocal(p);
  const l = outFor([m], false);
  const g = outFor([m], true);
  append(m, Math.cos(p.turn), Math.sin(p.turn), ox, ground, oz, l, g);
  for (const [o, a] of [
    [l, lit],
    [g, glow],
  ] as const) {
    for (const v of o.pos) a.pos.push(v);
    for (const v of o.col) a.col.push(v);
  }
}

function append(m: LocalMesh, c: number, s: number, ox: number, oy: number, oz: number, lit: Out, glow: Out): void {
  for (const [src, out] of [
    [m.lit, lit],
    [m.glow, glow],
  ] as const) {
    const pos = src.pos;
    const col = src.col;
    let n = out.n;
    for (let k = 0; k < pos.length; k += 3, n += 3) {
      const x = pos[k];
      const z = pos[k + 2];
      out.pos[n] = ox + x * c - z * s;
      out.pos[n + 1] = pos[k + 1] + oy;
      out.pos[n + 2] = oz + x * s + z * c;
      out.col[n] = col[k];
      out.col[n + 1] = col[k + 1];
      out.col[n + 2] = col[k + 2];
    }
    out.n = n;
  }
}

function mesh(a: Out, material: Material): Mesh {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(a.pos, 3));
  g.setAttribute("color", new BufferAttribute(a.col, 3));
  g.computeBoundingSphere();
  const m = new Mesh(g, material);
  m.frustumCulled = false;
  return m;
}
