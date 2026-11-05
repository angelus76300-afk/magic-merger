import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from "three";
import type { World } from "../world";
import type { Prop } from "../props";
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

  constructor(
    private scene: Scene,
    private litMaterial: Material,
    private glowMaterial: Material,
  ) {}

  update(world: World): void {
    if (world.propsVersion === this.version) return;
    this.version = world.propsVersion;
    this.dispose();
    const lit = { pos: [] as number[], col: [] as number[] };
    const glow = { pos: [] as number[], col: [] as number[] };
    for (const p of world.props) place(world, p, lit, glow);
    if (lit.pos.length) this.scene.add((this.lit = mesh(lit, this.litMaterial)));
    if (glow.pos.length) this.scene.add((this.glow = mesh(glow, this.glowMaterial)));
  }

  // How many meshes the props draw, for the HUD.
  meshes(): number {
    return (this.lit ? 1 : 0) + (this.glow ? 1 : 0);
  }

  dispose(): void {
    for (const m of [this.lit, this.glow]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.lit = null;
    this.glow = null;
  }
}

function place(world: World, p: Prop, lit: { pos: number[]; col: number[] }, glow: { pos: number[]; col: number[] }): void {
  const cx = Math.max(0, Math.min(world.w - 1, Math.round(p.x)));
  const cy = Math.max(0, Math.min(world.h - 1, Math.round(p.y)));
  const ground = columnTop(world, cy * world.w + cx);
  const ox = p.x + 0.5 - world.w / 2;
  const oz = p.y + 0.5 - world.h / 2;
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
