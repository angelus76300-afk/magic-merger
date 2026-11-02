import type { BufferGeometry } from "three";
import type { BodyLook } from "../visuals";
import { geometryOf, type Box } from "./models";
import { mixColor } from "../colors";

// Spell bodies built from small cubes, so a fireball or a vortex belongs to
// the same voxel world as the land. Each look is a set of boxes around the
// origin with a radius of about 1; the view scales it by the body's radius.
// Geometries are cached by look and colors.

const cache = new Map<string, BufferGeometry>();

export function bodyGeometry(look: BodyLook, c1: number, c2: number): BufferGeometry {
  const key = `${look}:${c1}:${c2}`;
  let g = cache.get(key);
  if (!g) {
    g = geometryOf(bodyBoxes(look, c1, c2));
    cache.set(key, g);
    // Spells pick many colors; keep the cache from growing forever.
    if (cache.size > 200) {
      const first = cache.keys().next().value as string;
      cache.get(first)?.dispose();
      cache.delete(first);
    }
  }
  return g;
}

const cube = (x: number, y: number, z: number, s: number, color: number): Box => ({ x: x - s / 2, y: y - s / 2, z: z - s / 2, w: s, h: s, d: s, color });

// Deterministic jitter, so a look is the same shape every time.
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function ball(boxes: Box[], r: number, step: number, color: (x: number, y: number, z: number, d: number) => number, ragged = 0): void {
  let n = 0;
  for (let x = -r; x <= r + 1e-6; x += step) {
    for (let y = -r; y <= r + 1e-6; y += step) {
      for (let z = -r; z <= r + 1e-6; z += step) {
        const d = Math.hypot(x, y, z) / r;
        n++;
        if (d > 1 || (d > 0.75 && hash(n) < ragged)) continue;
        // Inside cubes are never seen.
        if (d < 1 - (step * 1.8) / r) continue;
        boxes.push(cube(x, y, z, step, color(x, y, z, d)));
      }
    }
  }
}

export function bodyBoxes(look: BodyLook, c1: number, c2: number): Box[] {
  const boxes: Box[] = [];
  switch (look) {
    case "flame": {
      // A teardrop: wide and hot at the bottom, narrowing into tongues.
      for (let l = 0; l < 7; l++) {
        const r = 0.9 * (1 - l / 7) ** 0.8;
        const y = -0.8 + l * 0.32;
        for (let x = -r; x <= r; x += 0.3)
          for (let z = -r; z <= r; z += 0.3)
            if (x * x + z * z <= r * r && hash(l * 31 + x * 7 + z * 13) > 0.15)
              boxes.push(cube(x, y, z, 0.3, mixColor(c2, c1, Math.min(1, l / 5 + Math.hypot(x, z) * 0.4))));
      }
      break;
    }
    case "cloud": {
      for (let k = 0; k < 9; k++) {
        const x = (hash(k) - 0.5) * 1.8;
        const z = (hash(k + 9) - 0.5) * 1.4;
        const s = 0.5 + hash(k + 3) * 0.5;
        boxes.push({ x: x - s, y: -0.2 + hash(k + 5) * 0.3, z: z - s * 0.8, w: s * 2, h: s * 0.9, d: s * 1.6, color: k % 3 ? c1 : c2 });
      }
      break;
    }
    case "ring": {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        boxes.push(cube(Math.cos(a), 0, Math.sin(a), 0.24, k % 4 ? c1 : c2));
      }
      break;
    }
    case "vortex": {
      // A funnel of cubes spiraling up, wider at the top.
      for (let k = 0; k < 70; k++) {
        const t = k / 70;
        const a = t * Math.PI * 9;
        const r = 0.15 + t * 0.95;
        boxes.push(cube(Math.cos(a) * r, -1 + t * 2, Math.sin(a) * r, 0.14 + t * 0.14, mixColor(c2, c1, t)));
      }
      break;
    }
    case "shard": {
      // A crystal: a tall diamond with a bright core.
      for (let l = -4; l <= 4; l++) {
        const r = 0.45 * (1 - Math.abs(l) / 5);
        for (let x = -r; x <= r + 1e-6; x += 0.22)
          for (let z = -r; z <= r + 1e-6; z += 0.22) boxes.push(cube(x, l * 0.25, z, 0.22, Math.abs(x) + Math.abs(z) < 0.15 ? c2 : c1));
      }
      break;
    }
    case "star": {
      boxes.push(cube(0, 0, 0, 0.5, c2));
      const arms: [number, number, number][] = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      for (const [x, y, z] of arms) for (let k = 1; k <= 4; k++) boxes.push(cube(x * k * 0.25, y * k * 0.25, z * k * 0.25, 0.3 - k * 0.04, k < 3 ? c2 : c1));
      break;
    }
    case "meteor": {
      // A lumpy rock with glowing cracks.
      ball(boxes, 0.9, 0.3, (x, y, z) => (hash(x * 17 + y * 31 + z * 7) < 0.25 ? c2 : c1), 0.4);
      break;
    }
    case "swarm":
      // Drawn as moving motes by the view.
      break;
    default: {
      // Orb: a voxel ball, its color deepening toward the edge, with sparks.
      ball(boxes, 1, 0.25, (x, y, z, d) => (hash(x * 13 + y * 7 + z * 3) < 0.08 ? 0xffffff : mixColor(c2, c1, Math.min(1, d * 1.1))));
    }
  }
  return boxes;
}
