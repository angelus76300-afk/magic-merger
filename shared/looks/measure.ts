// How detailed a look is (the looks revamp, roadmap 5.2.5): the measures of phase 0
// (scripts/look-measure.ts), shared with the reference library's checks (scripts/looks-refs-test.ts),
// so "richer than the library" is one number in both.

export interface MeasuredPart {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  glow: boolean;
  shape?: string;
  rx?: number;
  ry?: number;
  rz?: number;
  grain?: number;
}

export const SILHOUETTE_GRID = 24;

// Cells filled in the outline of the parts seen from the front, the side and the top, over their
// bounding box (of the parts' boxes, before turns). A shaped or turned part is drawn by its shape. A solid rectangle has the outline of the grid's edge (92 cells) and scores 0; three
// times that scores 1; the three views are averaged. A single brick scores 0.
export function silhouette(boxes: MeasuredPart[]): { score: number; fill: number } {
  const GRID = SILHOUETTE_GRID;
  if (!boxes.length) return { score: 0, fill: 0 };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const a = [b.x, b.y, b.z];
    const s = [b.w, b.d, b.h];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[k]);
      hi[k] = Math.max(hi[k], a[k] + s[k]);
    }
  }
  const views: [number, number][] = [
    [0, 2], // front: x across, z up
    [1, 2], // side: y across, z up
    [0, 1], // top: x across, y down
  ];
  let score = 0;
  let fill = 0;
  const perimeter = 4 * GRID - 4;
  // Each part as points: a plain upright part is its box (so the looks stored before the shapes
  // measure as they did); a shaped or turned one is sampled inside its shape and turned as drawn.
  const solids = boxes.map((b) => (isPlainPart(b) ? null : samplePart(b)));
  for (const [u, v] of views) {
    const grid = new Uint8Array(GRID * GRID);
    const du = hi[u] - lo[u] || 1;
    const dv = hi[v] - lo[v] || 1;
    boxes.forEach((b, n) => {
      const pts = solids[n];
      if (pts) {
        for (const pt of pts) {
          const i = Math.min(GRID - 1, Math.max(0, Math.floor(((pt[u] - lo[u]) / du) * GRID)));
          const j = Math.min(GRID - 1, Math.max(0, Math.floor(((pt[v] - lo[v]) / dv) * GRID)));
          grid[j * GRID + i] = 1;
        }
        return;
      }
      const a = [b.x, b.y, b.z];
      const s = [b.w, b.d, b.h];
      const u0 = Math.floor(((a[u] - lo[u]) / du) * GRID);
      const u1 = Math.ceil(((a[u] + s[u] - lo[u]) / du) * GRID);
      const v0 = Math.floor(((a[v] - lo[v]) / dv) * GRID);
      const v1 = Math.ceil(((a[v] + s[v] - lo[v]) / dv) * GRID);
      for (let j = Math.max(0, v0); j < Math.min(GRID, v1); j++) for (let i = Math.max(0, u0); i < Math.min(GRID, u1); i++) grid[j * GRID + i] = 1;
    });
    let filled = 0;
    let edge = 0;
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        if (!grid[j * GRID + i]) continue;
        filled++;
        const open = (a: number, b: number) => a < 0 || b < 0 || a >= GRID || b >= GRID || !grid[b * GRID + a];
        if (open(i - 1, j) || open(i + 1, j) || open(i, j - 1) || open(i, j + 1)) edge++;
      }
    score += Math.max(0, Math.min(1, (edge - perimeter) / (2 * perimeter)));
    fill += filled / (GRID * GRID);
  }
  return { score: score / 3, fill: fill / 3 };
}

function isPlainPart(b: MeasuredPart): boolean {
  return (!b.shape || b.shape === "box") && !b.rx && !b.ry && !b.rz;
}

// Is (u, v, t), in a part's own unit box (t up), inside its shape? As src/sim/voxel/shapes.ts draws it.
export function insidePart(shape: string, u: number, v: number, t: number): boolean {
  const du = u - 0.5;
  const dv = v - 0.5;
  switch (shape) {
    case "wedge":
      return t <= 1 - u;
    case "cyl":
      return du * du + dv * dv <= 0.25;
    case "cone": {
      const r = 0.5 * (1 - t);
      return du * du + dv * dv <= r * r;
    }
    case "dome":
      return du * du + dv * dv + 0.25 * t * t <= 0.25;
    default:
      return true;
  }
}

const SAMPLES = 10;

// Points inside a part, turned about its center as the island turns it (src/sim/props.ts partCorners).
function samplePart(b: MeasuredPart): [number, number, number][] {
  const [ax, ay, az] = [((b.rx ?? 0) * Math.PI) / 180, ((b.ry ?? 0) * Math.PI) / 180, ((b.rz ?? 0) * Math.PI) / 180];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.d / 2;
  const cz = b.z + b.h / 2;
  const out: [number, number, number][] = [];
  for (let i = 0; i < SAMPLES; i++)
    for (let j = 0; j < SAMPLES; j++)
      for (let k = 0; k < SAMPLES; k++) {
        const u = (i + 0.5) / SAMPLES;
        const v = (j + 0.5) / SAMPLES;
        const t = (k + 0.5) / SAMPLES;
        if (!insidePart(b.shape ?? "box", u, v, t)) continue;
        let x = (u - 0.5) * b.w;
        let y = (v - 0.5) * b.d;
        let z = (t - 0.5) * b.h;
        [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
        [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
        [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
        out.push([cx + x, cy + y, cz + z]);
      }
  return out;
}

// The shapes a look uses, by count ("box" for an upright plain part), and how many parts are turned.
export function shapesOf(boxes: MeasuredPart[]): { shapes: Record<string, number>; turned: number; grained: number } {
  const shapes: Record<string, number> = {};
  let turned = 0;
  let grained = 0;
  for (const b of boxes) {
    const s = b.shape ?? "box";
    shapes[s] = (shapes[s] ?? 0) + 1;
    if (b.rx || b.ry || b.rz) turned++;
    if (b.grain) grained++;
  }
  return { shapes, turned, grained };
}

// Tones of one material: colours grouped by hue (12 steps round the wheel, greys apart), so a look
// "in three tones of one hue" has a group of three or more.
export function toneGroups(boxes: MeasuredPart[]): number[] {
  const groups = new Map<string, Set<number>>();
  for (const b of boxes) {
    const r = ((b.color >> 16) & 255) / 255;
    const g = ((b.color >> 8) & 255) / 255;
    const bl = (b.color & 255) / 255;
    const max = Math.max(r, g, bl);
    const min = Math.min(r, g, bl);
    const sat = max ? (max - min) / max : 0;
    let key = "grey";
    if (sat > 0.15 && max - min > 0.04) {
      let h = 0;
      if (max === r) h = ((g - bl) / (max - min)) % 6;
      else if (max === g) h = (bl - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      key = String(Math.round(((h * 60 + 360) % 360) / 30) % 12);
    }
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(b.color);
  }
  return [...groups.values()].map((s) => s.size).sort((a, b) => b - a);
}
