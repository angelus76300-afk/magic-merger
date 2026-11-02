import { BoxGeometry, BufferAttribute, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, type Material, type Scene } from "three";
import { A, R, ROLES, type Part, type Rig } from "./rigs";

// Draws creatures (3.5): every part of every figure is one instance of the
// same unit cube, in two draw calls whatever the mix of bodies: one for what
// the day and spell darkness dim, one for what shines (glowing eyes, spirits,
// torches). A hundred creatures of twelve plans are still those two calls.
//
// The cube's faces are shaded in the shader from the instance's own normal,
// with the same light per side as the baked models (models.ts), so a deer
// that turns keeps the sun on the right side.

export interface Pose {
  // Feet, in scene units.
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  // Walk cycle in radians, and how much it walks (0 to 1).
  phase: number;
  moving: number;
  // Seconds, for what moves on its own (wings, tails, motes).
  time: number;
  flying: boolean;
  // Wings, tail, head and the rest stop.
  still: boolean;
  nod: number;
  // Draw small parts (eyes, ears, buckles): false from far away.
  detail: boolean;
  // Every part shines (spirits).
  glowAll: boolean;
  // Status color over everything: dead, frozen, burning; 0 for none.
  tint: number;
  tintAmount: number;
  // A delay so a flock does not beat its wings as one.
  offset: number;
}

// The light of each side, as in models.ts: top, east (+x), south (+z), west, north, bottom.
function withFaceLight<T extends MeshBasicMaterial>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <color_vertex>",
      `#include <color_vertex>
vec3 faceN = normal;
#ifdef USE_INSTANCING
faceN = mat3(instanceMatrix) * faceN;
#endif
faceN = normalize(mat3(modelMatrix) * faceN);
vec3 faceP = max(faceN, 0.0);
vec3 faceM = max(-faceN, 0.0);
float faceLight = (faceP.y + faceP.x * 0.84 + faceP.z * 0.74 + faceM.x * 0.66 + faceM.z * 0.58 + faceM.y * 0.45) / max(1e-3, faceP.x + faceP.y + faceP.z + faceM.x + faceM.y + faceM.z);
vColor.rgb *= faceLight;`,
    );
  };
  material.customProgramCacheKey = () => "figure-face-light";
  return material;
}

export function figureMaterials(): { lit: MeshBasicMaterial; glow: MeshBasicMaterial } {
  return { lit: withFaceLight(new MeshBasicMaterial({ vertexColors: true })), glow: withFaceLight(new MeshBasicMaterial({ vertexColors: true })) };
}

// Per rig, what does not change, as flat arrays: each part's box in its
// pivot's frame (a 3 by 4 affine matrix, row by row), its pivot, motion,
// color role, segment, glow, detail level and fixed color.
// Parts that turn about the same pivot with the same motion (a head, its
// hair, eyes and hat) share a channel, whose matrix is made once per figure.
interface Baked {
  n: number;
  base: Float64Array;
  channel: Uint8Array;
  role: Uint8Array;
  glow: Uint8Array;
  lod: Uint8Array;
  fixed: Float32Array;
  // Per channel: motion, segment, pivot. Channel 0 does not move.
  channels: { anim: number; seg: number; px: number; py: number; pz: number }[];
}

const MAX_CHANNELS = 48;

const START = 2048;
const MAX = 16384;

// 3 by 4 affine matrices, row by row, inside larger arrays at offsets:
// out = a * b.
function mul(out: Float64Array, oo: number, a: Float64Array, ao: number, b: Float64Array, bo: number): void {
  const b0 = b[bo];
  const b1 = b[bo + 1];
  const b2 = b[bo + 2];
  const b3 = b[bo + 3];
  const b4 = b[bo + 4];
  const b5 = b[bo + 5];
  const b6 = b[bo + 6];
  const b7 = b[bo + 7];
  const b8 = b[bo + 8];
  const b9 = b[bo + 9];
  const b10 = b[bo + 10];
  const b11 = b[bo + 11];
  for (let r = 0; r < 12; r += 4) {
    const a0 = a[ao + r];
    const a1 = a[ao + r + 1];
    const a2 = a[ao + r + 2];
    out[oo + r] = a0 * b0 + a1 * b4 + a2 * b8;
    out[oo + r + 1] = a0 * b1 + a1 * b5 + a2 * b9;
    out[oo + r + 2] = a0 * b2 + a1 * b6 + a2 * b10;
    out[oo + r + 3] = a0 * b3 + a1 * b7 + a2 * b11 + a[ao + r + 3];
  }
}

// Into an instance matrix (column major, 16 floats).
function write(arr: Float32Array, i: number, m: Float64Array): void {
  const o = i * 16;
  arr[o] = m[0];
  arr[o + 1] = m[4];
  arr[o + 2] = m[8];
  arr[o + 3] = 0;
  arr[o + 4] = m[1];
  arr[o + 5] = m[5];
  arr[o + 6] = m[9];
  arr[o + 7] = 0;
  arr[o + 8] = m[2];
  arr[o + 9] = m[6];
  arr[o + 10] = m[10];
  arr[o + 11] = 0;
  arr[o + 12] = m[3];
  arr[o + 13] = m[7];
  arr[o + 14] = m[11];
  arr[o + 15] = 1;
}

// A turn about one axis (cosine and sine given), around the pivot.
function turn(out: Float64Array, axis: 0 | 1 | 2, c: number, s: number, px: number, py: number, pz: number): void {
  if (axis === 0) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[4] = 0;
    out[5] = c;
    out[6] = -s;
    out[8] = 0;
    out[9] = s;
    out[10] = c;
  } else if (axis === 1) {
    out[0] = c;
    out[1] = 0;
    out[2] = s;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[8] = -s;
    out[9] = 0;
    out[10] = c;
  } else {
    out[0] = c;
    out[1] = -s;
    out[2] = 0;
    out[4] = s;
    out[5] = c;
    out[6] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
  }
  out[3] = px;
  out[7] = py;
  out[11] = pz;
}

export class Figures {
  private meshes: [InstancedMesh, InstancedMesh];
  private n = [0, 0];
  private want = [0, 0];
  private geometry: BoxGeometry;
  private root = new Float64Array(12);
  private anim = new Float64Array(12);
  private channelMatrices = new Float64Array(MAX_CHANNELS * 12);
  private m = new Float64Array(12);
  // The palette as floats, tinted, once per figure.
  private rgb = new Float32Array(ROLES * 3);
  private tint = new Color();
  // Parts drawn in the last frame, for the HUD.
  parts = 0;

  constructor(
    private scene: Scene,
    materials: { lit: Material; glow: Material },
  ) {
    const g = new BoxGeometry(1, 1, 1);
    g.translate(0.5, 0.5, 0.5);
    const white = new Float32Array(g.attributes.position.count * 3).fill(1);
    g.setAttribute("color", new BufferAttribute(white, 3));
    g.deleteAttribute("uv");
    this.geometry = g;
    this.meshes = [this.make(materials.lit, START), this.make(materials.glow, START)];
  }

  private make(material: Material, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, material, capacity);
    const white = new Color(0xffffff);
    for (let k = 0; k < capacity; k++) mesh.setColorAt(k, white);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  // Grows a mesh that ran out last frame, so the next one has room.
  begin(): void {
    for (const k of [0, 1] as const) {
      const mesh = this.meshes[k];
      if (this.want[k] > mesh.instanceMatrix.count && mesh.instanceMatrix.count < MAX) {
        const material = mesh.material as Material;
        this.scene.remove(mesh);
        mesh.dispose();
        this.meshes[k] = this.make(material, Math.min(MAX, Math.ceil(this.want[k] * 1.5)));
      }
      this.n[k] = 0;
      this.want[k] = 0;
    }
  }

  // A rig as flat arrays, once: the loop below reads numbers by index.
  private bake(rig: Rig): Baked {
    if (rig.baked) return rig.baked as Baked;
    const n = rig.parts.length;
    const b: Baked = {
      n,
      base: new Float64Array(n * 12),
      channel: new Uint8Array(n),
      role: new Uint8Array(n),
      glow: new Uint8Array(n),
      lod: new Uint8Array(n),
      fixed: new Float32Array(n * 3),
      channels: [{ anim: A.NONE, seg: 0, px: 0, py: 0, pz: 0 }],
    };
    rig.parts.forEach((part: Part, i) => {
      // base = T(q) R(rot) T(o) S(size); a part that never moves has its pivot in it.
      const m = new Matrix4().makeScale(part.s[0], part.s[1], part.s[2]);
      m.premultiply(new Matrix4().makeTranslation(part.o[0], part.o[1], part.o[2]));
      if (part.rot) m.premultiply(new Matrix4().makeRotationFromEuler(new Euler(part.rot[0], part.rot[1], part.rot[2])));
      m.premultiply(new Matrix4().makeTranslation(part.q[0], part.q[1], part.q[2]));
      if (part.anim === A.NONE) m.premultiply(new Matrix4().makeTranslation(part.p[0], part.p[1], part.p[2]));
      const e = m.elements;
      b.base.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], i * 12);
      if (part.anim !== A.NONE) {
        const [px, py, pz] = part.p;
        let ch = b.channels.findIndex((c) => c.anim === part.anim && c.seg === part.seg && c.px === px && c.py === py && c.pz === pz);
        if (ch < 0 && b.channels.length < MAX_CHANNELS) {
          ch = b.channels.length;
          b.channels.push({ anim: part.anim, seg: part.seg, px, py, pz });
        }
        b.channel[i] = Math.max(0, ch);
      }
      b.role[i] = part.role;
      b.glow[i] = part.glow ? 1 : 0;
      b.lod[i] = part.lod;
      const c = part.color;
      b.fixed.set([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255], i * 3);
    });
    rig.baked = b;
    return b;
  }

  // One figure; palette is indexed by role (rigs.ts R).
  add(rig: Rig, palette: number[], pose: Pose): void {
    const B = this.bake(rig);
    // The root: turned (yaw, then pitch, then roll), scaled, placed.
    const root = this.root;
    {
      const cx = Math.cos(pose.pitch);
      const sx = Math.sin(pose.pitch);
      const cy = Math.cos(pose.yaw);
      const sy = Math.sin(pose.yaw);
      const cz = Math.cos(pose.roll);
      const sz = Math.sin(pose.roll);
      const k = pose.scale;
      root[0] = (cy * cz + sy * sx * sz) * k;
      root[1] = (sy * sx * cz - cy * sz) * k;
      root[2] = cx * sy * k;
      root[3] = pose.x;
      root[4] = cx * sz * k;
      root[5] = cx * cz * k;
      root[6] = -sx * k;
      root[7] = pose.y;
      root[8] = (cy * sx * sz - sy * cz) * k;
      root[9] = (sy * sz + cy * sx * cz) * k;
      root[10] = cx * cy * k;
      root[11] = pose.z;
    }
    // Colors once per figure, tinted (dead, frozen, burning) here and not per part.
    const rgb = this.rgb;
    const ta = pose.tintAmount;
    this.tint.setHex(pose.tint);
    const tr = this.tint.r;
    const tg = this.tint.g;
    const tb = this.tint.b;
    for (let r = 0; r < ROLES; r++) {
      const c = palette[r];
      rgb[r * 3] = (((c >> 16) & 255) / 255) * (1 - ta) + tr * ta;
      rgb[r * 3 + 1] = (((c >> 8) & 255) / 255) * (1 - ta) + tg * ta;
      rgb[r * 3 + 2] = ((c & 255) / 255) * (1 - ta) + tb * ta;
    }

    const t = pose.time + pose.offset;
    const swing = Math.sin(pose.phase) * pose.moving;
    const live = pose.still ? 0 : 1;
    const flap = live * (pose.flying ? Math.sin(t * rig.flapRate * Math.PI * 2) * 0.85 : 0.12 + 0.06 * Math.sin(t * 2) + swing * 0.15);
    const sway = live * (Math.sin(t * 2.4) * 0.3 + Math.sin(pose.phase * 0.5) * 0.25 * pose.moving);
    const nod = pose.nod + live * (Math.sin(pose.phase * 2) * 0.05 * pose.moving + Math.sin(t * 0.7) * 0.04);
    const squash = live * (Math.abs(Math.sin(pose.phase)) * 0.22 * pose.moving + Math.sin(t * 3) * 0.04);
    const segPhase = pose.phase + t * 1.6 * live;
    const side = Math.sin(pose.phase * 1.6) * pose.moving * 0.45;
    // Each motion's cosine and sine once per figure: legs and arms swing in
    // opposite pairs, so the B side is the same cosine and the opposite sine.
    const legC = Math.cos(0.6 * swing);
    const legS = Math.sin(0.6 * swing);
    const armC = Math.cos(0.5 * swing);
    const armS = Math.sin(0.5 * swing);
    const flapC = Math.cos(flap);
    const flapS = Math.sin(flap);
    const nodC = Math.cos(nod);
    const nodS = Math.sin(nod);
    const sideC = Math.cos(side);
    const sideS = Math.sin(side);
    const hold = -0.3 + swing * 0.1;
    const holdC = Math.cos(hold);
    const holdS = Math.sin(hold);

    // Each channel's matrix: root * T(pivot) * motion.
    const a = this.anim;
    const chm = this.channelMatrices;
    for (let r = 0; r < 12; r++) chm[r] = root[r];
    const channels = B.channels;
    for (let c = 1; c < channels.length; c++) {
      const { anim, seg, px, py, pz } = channels[c];
      switch (anim) {
        case A.LEG_A:
          turn(a, 0, legC, legS, px, py, pz);
          break;
        case A.LEG_B:
          turn(a, 0, legC, -legS, px, py, pz);
          break;
        case A.ARM_A:
          turn(a, 0, armC, armS, px, py, pz);
          break;
        case A.ARM_B:
          turn(a, 0, armC, -armS, px, py, pz);
          break;
        case A.WING_L:
          turn(a, 2, flapC, flapS, px, py, pz);
          break;
        case A.WING_R:
          turn(a, 2, flapC, -flapS, px, py, pz);
          break;
        case A.TAIL: {
          const ang = sway * (1 + seg * 0.4);
          turn(a, 1, Math.cos(ang), Math.sin(ang), px, py, pz);
          break;
        }
        case A.HEAD:
          turn(a, 0, nodC, nodS, px, py, pz);
          break;
        case A.SEG: {
          const amp = 0.045 * (0.5 + seg * 0.4) * (0.4 * live + pose.moving);
          const ang = Math.cos(segPhase - seg * 0.9) * 0.18 * live;
          turn(a, 1, Math.cos(ang), Math.sin(ang), px + Math.sin(segPhase - seg * 0.9) * amp, py, pz);
          break;
        }
        case A.SIDE_A:
          turn(a, 1, sideC, sideS, px, py, pz);
          break;
        case A.SIDE_B:
          turn(a, 1, sideC, -sideS, px, py, pz);
          break;
        case A.SQUASH:
          turn(a, 0, 1, 0, px, py, pz);
          a[0] = 1 + squash * 0.5;
          a[5] = 1 - squash;
          a[10] = 1 + squash * 0.5;
          break;
        case A.ORBIT: {
          const ang = t * 2 + seg * 2.094;
          turn(a, 1, Math.cos(ang), Math.sin(ang), px, py, pz);
          break;
        }
        case A.HOLD:
          turn(a, 0, holdC, holdS, px, py, pz);
          break;
      }
      mul(chm, c * 12, root, 0, a, 0);
    }

    const m = this.m;
    const base = B.base;
    const meshes = this.meshes;
    const counts = this.n;
    const detail = pose.detail;
    const glowAll = pose.glowAll;
    const mats = [meshes[0].instanceMatrix.array as Float32Array, meshes[1].instanceMatrix.array as Float32Array];
    const cols = [meshes[0].instanceColor!.array as Float32Array, meshes[1].instanceColor!.array as Float32Array];
    const caps = [meshes[0].instanceMatrix.count, meshes[1].instanceMatrix.count];
    for (let j = 0; j < B.n; j++) {
      if (B.lod[j] && !detail) continue;
      const k = B.glow[j] || glowAll ? 1 : 0;
      if (counts[k] >= caps[k]) {
        this.want[k] = Math.max(this.want[k], counts[k] + 1);
        continue;
      }
      mul(m, 0, chm, B.channel[j] * 12, base, j * 12);
      const i = counts[k]++;
      write(mats[k], i, m);
      const col = cols[k];
      const role = B.role[j];
      if (role === R.FIXED) {
        const f = B.glow[j] ? 0 : ta;
        col[i * 3] = B.fixed[j * 3] * (1 - f) + tr * f;
        col[i * 3 + 1] = B.fixed[j * 3 + 1] * (1 - f) + tg * f;
        col[i * 3 + 2] = B.fixed[j * 3 + 2] * (1 - f) + tb * f;
      } else {
        col[i * 3] = rgb[role * 3];
        col[i * 3 + 1] = rgb[role * 3 + 1];
        col[i * 3 + 2] = rgb[role * 3 + 2];
      }
    }
  }

  // Uploads only what was written.
  end(): void {
    this.parts = 0;
    for (const k of [0, 1] as const) {
      const mesh = this.meshes[k];
      const n = this.n[k];
      mesh.count = n;
      this.parts += n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, Math.max(1, n) * 3);
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
