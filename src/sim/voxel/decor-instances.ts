import { Color, Matrix4, type InstancedMesh } from "three";
import type { DecorStore } from "../decor";
import { keyLevel, keyX, keyY } from "../voxelkey";
import { shines, voxelColor, voxelKind } from "../voxels";

const FLAME = [0xffd36a, 0xffa43a, 0xff6a1a, 0xe8420f];
const LOOK = 0; // plain voxels, tinted by the time of day
const GLOW = 1; // burning or shining voxels, never darkened

// Keeps the two decor meshes in step with the world's voxels by touching only
// the instances whose voxel changed. A burning forest used to rewrite all its
// 16,000 instances five times a second for the flame flicker; now a change of
// one voxel writes one instance, and the upload covers only the touched range.
export class DecorInstances {
  // Key to where its instance is: mesh * 65536 + index.
  private where = new Map<number, number>();
  private keyAt: [Uint32Array, Uint32Array];
  private count = [0, 0];
  private touched = [
    [Infinity, -1],
    [Infinity, -1],
  ];
  private burningShown = new Set<number>();
  // A view that starts on a world someone else already looked at reads all.
  private fresh = true;
  private m = new Matrix4();
  private col = new Color();

  constructor(
    private meshes: [InstancedMesh, InstancedMesh],
    private capacity: number,
    private halfW: number,
    private halfH: number,
  ) {
    this.keyAt = [new Uint32Array(capacity), new Uint32Array(capacity)];
  }

  // Applies what changed since the last call. `burning` maps burning keys to
  // their time left; their color flickers with `time`.
  update(decor: DecorStore, burning: Map<number, number>, time: number): void {
    const taken = decor.takeChanges();
    const changes = this.fresh ? "all" : taken;
    this.fresh = false;
    if (changes === "all") this.rebuild(decor, burning, time);
    else {
      for (const key of changes) this.refresh(decor, burning, key, time);
      // Voxels that stopped burning go back to their own color and mesh.
      for (const key of this.burningShown) if (!burning.has(key) && !changes.has(key)) this.refresh(decor, burning, key, time);
      for (const key of burning.keys()) {
        if (changes.has(key)) continue;
        const at = this.where.get(key);
        if (at === undefined) {
          if (decor.has(key)) this.refresh(decor, burning, key, time);
        } else if (at >>> 16 !== GLOW) this.refresh(decor, burning, key, time);
        else this.paint(GLOW, at & 0xffff, flame(key, time));
      }
    }
    this.burningShown.clear();
    for (const key of burning.keys()) if (this.where.has(key)) this.burningShown.add(key);
    this.flush();
  }

  private rebuild(decor: DecorStore, burning: Map<number, number>, time: number): void {
    this.where.clear();
    this.count[LOOK] = 0;
    this.count[GLOW] = 0;
    for (let slot = 0; slot < decor.slots; slot++) {
      if (!decor.isLive(slot)) continue;
      const key = decor.keyOf(slot);
      this.add(key, decor.valueOf(slot), burning, time);
    }
    for (const t of this.touched) {
      t[0] = 0;
      t[1] = this.capacity - 1;
    }
  }

  // Puts one voxel where it belongs now: removed, added or moved between meshes.
  private refresh(decor: DecorStore, burning: Map<number, number>, key: number, time: number): void {
    this.remove(key);
    const v = decor.get(key);
    if (v !== undefined) this.add(key, v, burning, time);
  }

  private add(key: number, v: number, burning: Map<number, number>, time: number): void {
    const fire = burning.has(key);
    const mesh = fire || shines(voxelKind(v)) ? GLOW : LOOK;
    const index = this.count[mesh];
    if (index >= this.capacity) return;
    this.count[mesh]++;
    this.keyAt[mesh][index] = key;
    this.where.set(key, mesh * 65536 + index);
    this.m.makeTranslation(keyX(key) - this.halfW + 0.5, keyLevel(key) + 0.5, keyY(key) - this.halfH + 0.5);
    this.meshes[mesh].setMatrixAt(index, this.m);
    this.paint(mesh, index, fire ? flame(key, time) : voxelColor(v));
  }

  // Swap with the last instance of the same mesh, so instances stay packed.
  private remove(key: number): void {
    const at = this.where.get(key);
    if (at === undefined) return;
    this.where.delete(key);
    const mesh = at >>> 16;
    const index = at & 0xffff;
    const last = --this.count[mesh];
    if (index !== last) {
      const moved = this.keyAt[mesh][last];
      this.keyAt[mesh][index] = moved;
      this.where.set(moved, mesh * 65536 + index);
      const m = this.meshes[mesh];
      m.getMatrixAt(last, this.m);
      m.setMatrixAt(index, this.m);
      m.getColorAt(last, this.col);
      m.setColorAt(index, this.col);
      this.touch(mesh, index);
    }
    this.touch(mesh, last);
  }

  private paint(mesh: number, index: number, color: number): void {
    this.meshes[mesh].setColorAt(index, this.col.setHex(color));
    this.touch(mesh, index);
  }

  private touch(mesh: number, index: number): void {
    const t = this.touched[mesh];
    if (index < t[0]) t[0] = index;
    if (index > t[1]) t[1] = index;
  }

  // Uploads only the range of instances that changed.
  // Up to n glowing voxels (burning or shining), spread over all of them, as
  // light points for the darkness.
  glowing(n: number, out: number[]): number[] {
    out.length = 0;
    const total = this.count[GLOW];
    const step = Math.max(1, Math.floor(total / n));
    for (let k = 0; k < total && out.length < n; k += step) out.push(this.keyAt[GLOW][k]);
    return out;
  }

  private flush(): void {
    for (let mesh = 0; mesh < 2; mesh++) {
      const m = this.meshes[mesh];
      m.count = this.count[mesh];
      const [lo, hi] = this.touched[mesh];
      if (hi < lo) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) {
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
        m.instanceColor.needsUpdate = true;
      }
      this.touched[mesh][0] = Infinity;
      this.touched[mesh][1] = -1;
    }
  }
}

function flame(key: number, time: number): number {
  return FLAME[(key + Math.floor(time * 10)) % 4];
}
