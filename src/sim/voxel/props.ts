import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from "three";
import type { World } from "../world";
import type { Prop } from "../props";
import { heldScale } from "../held";
import { pushBox, type Box } from "./models";
import { columnTop } from "./terrain";

// The fine box models of items (4.6, props.ts), drawn like the wonders'
// models: every prop of the island merged into one mesh, and one more for
// what shines, rebuilt only when a prop is added or blown away. Each prop is
// turned about its center and stands on the ground under it as it was when
// the mesh was built.

export class PropModels {
  private version = -1;
  private lit: Mesh | null = null;
  private glow: Mesh | null = null;
  // What hands hold (4.7, held.ts): rebuilt every frame while anything is held.
  private heldLit: Mesh | null = null;
  private heldGlow: Mesh | null = null;

  constructor(
    private scene: Scene,
    private litMaterial: Material,
    private glowMaterial: Material,
  ) {}

  update(world: World, groundAt?: (x: number, y: number) => number): void {
    this.updateHeld(world, groundAt);
    if (world.propsVersion === this.version) return;
    this.version = world.propsVersion;
    this.disposeGround();
    const lit = { pos: [] as number[], col: [] as number[] };
    const glow = { pos: [] as number[], col: [] as number[] };
    for (const p of world.props) if (p.heldBy == null) place(world, p, lit, glow);
    if (lit.pos.length) this.scene.add((this.lit = mesh(lit, this.litMaterial)));
    if (glow.pos.length) this.scene.add((this.glow = mesh(glow, this.glowMaterial)));
  }

  // A held object's own model, made HELD_SIZE tall at most, in its holder's
  // right hand, turned the way the holder faces.
  private updateHeld(world: World, groundAt?: (x: number, y: number) => number): void {
    this.disposeHeld();
    const held = world.props.filter((p) => p.heldBy != null);
    if (!held.length) return;
    const lit = { pos: [] as number[], col: [] as number[] };
    const glow = { pos: [] as number[], col: [] as number[] };
    for (const p of held) {
      const c = world.creatures.find((o) => o.id === p.heldBy);
      if (!c || c.dead) continue;
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
      const k = heldScale(p.boxes);
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      const side = c.hd - Math.PI / 2;
      const hx = c.x + 0.5 + Math.cos(c.hd) * 0.15 + Math.cos(side) * 0.3 - world.w / 2;
      const hz = c.y + 0.5 + Math.sin(c.hd) * 0.15 + Math.sin(side) * 0.3 - world.h / 2;
      const ground = (groundAt ? groundAt(c.x, c.y) : columnTop(world, Math.round(c.y) * world.w + Math.round(c.x))) + 0.35 + Math.max(0, c.z);
      const cos = Math.cos(c.hd);
      const sin = Math.sin(c.hd);
      for (const b of p.boxes) {
        const out = b.glow ? glow : lit;
        const from = out.pos.length;
        pushBox(out.pos, out.col, { x: (b.x - mx) * k, y: b.z * k, z: (b.y - my) * k, w: b.w * k, h: b.h * k, d: b.d * k, color: b.color });
        for (let n = from; n < out.pos.length; n += 3) {
          const x = out.pos[n];
          const z = out.pos[n + 2];
          out.pos[n] = hx + x * cos - z * sin;
          out.pos[n + 1] += ground;
          out.pos[n + 2] = hz + x * sin + z * cos;
        }
      }
    }
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

function place(world: World, p: Prop, lit: { pos: number[]; col: number[] }, glow: { pos: number[]; col: number[] }): void {
  const cx = Math.max(0, Math.min(world.w - 1, Math.round(p.x)));
  const cy = Math.max(0, Math.min(world.h - 1, Math.round(p.y)));
  propMesh(p, columnTop(world, cy * world.w + cx), p.x + 0.5 - world.w / 2, p.y + 0.5 - world.h / 2, lit, glow);
}

export interface MeshArrays {
  pos: number[];
  col: number[];
}

// One prop's faces, turned about its center and standing on `ground`, its
// center at (ox, oz) in the view: the lit parts in `lit`, what shines in `glow`.
export function propMesh(p: Prop, ground: number, ox: number, oz: number, lit: MeshArrays, glow: MeshArrays): void {
  const c = Math.cos(p.turn);
  const s = Math.sin(p.turn);
  for (const b of p.boxes) {
    const out = b.glow ? glow : lit;
    const from = out.pos.length;
    // The model's x and y lie on the ground, z goes up: the view's x, z and y.
    const box: Box = { x: b.x, y: b.z, z: b.y, w: b.w, h: b.h, d: b.d, color: b.color };
    pushBox(out.pos, out.col, box);
    for (let k = from; k < out.pos.length; k += 3) {
      const x = out.pos[k];
      const z = out.pos[k + 2];
      out.pos[k] = ox + x * c - z * s;
      out.pos[k + 1] += ground;
      out.pos[k + 2] = oz + x * s + z * c;
    }
  }
}

function mesh(a: { pos: number[]; col: number[] }, material: Material): Mesh {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(a.pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(a.col), 3));
  g.computeBoundingSphere();
  const m = new Mesh(g, material);
  m.frustumCulled = false;
  return m;
}
