import { BufferAttribute, BufferGeometry } from "three";

// Small voxel models built from boxes, with lighting baked into vertex colors:
// tops are brightest, the sides facing the sun a little darker, the others
// darker still. Materials are unlit, so the GPU does no lighting at all, which
// is what keeps phones fast. Bottom faces are skipped: they are never seen.

export const FACE_LIGHT = { top: 1, east: 0.84, south: 0.74, west: 0.66, north: 0.58 };

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
}

// Appends the five visible faces of a box to position and color arrays.
export function pushBox(pos: number[], col: number[], b: Box): void {
  const { x, y, z, w, h, d, color } = b;
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const bl = (color & 255) / 255;
  const quad = (p: number[][], light: number) => {
    // Two triangles: 0 1 2, 0 2 3.
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(p[k][0], p[k][1], p[k][2]);
      col.push(r * light, g * light, bl * light);
    }
  };
  const x1 = x + w;
  const y1 = y + h;
  const z1 = z + d;
  quad(
    [
      [x, y1, z],
      [x, y1, z1],
      [x1, y1, z1],
      [x1, y1, z],
    ],
    FACE_LIGHT.top,
  );
  quad(
    [
      [x1, y, z],
      [x1, y1, z],
      [x1, y1, z1],
      [x1, y, z1],
    ],
    FACE_LIGHT.east,
  );
  quad(
    [
      [x, y, z1],
      [x1, y, z1],
      [x1, y1, z1],
      [x, y1, z1],
    ],
    FACE_LIGHT.south,
  );
  quad(
    [
      [x, y, z],
      [x, y, z1],
      [x, y1, z1],
      [x, y1, z],
    ],
    FACE_LIGHT.west,
  );
  quad(
    [
      [x, y, z],
      [x, y1, z],
      [x1, y1, z],
      [x1, y, z],
    ],
    FACE_LIGHT.north,
  );
}

export function geometryOf(boxes: Box[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  for (const b of boxes) pushBox(pos, col, b);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
}

// Models sit on a 1 by 1 cell, x and z from 0 to 1, y from 0 up.
const B = (x: number, y: number, z: number, w: number, h: number, d: number, color: number): Box => ({ x, y, z, w, h, d, color });

export const MODELS: Record<string, Box[]> = {
  tree: [B(0.4, 0, 0.4, 0.2, 0.7, 0.2, 0x6b4a2b), B(0.05, 0.6, 0.05, 0.9, 0.75, 0.9, 0x3a7d32), B(0.22, 1.3, 0.22, 0.56, 0.4, 0.56, 0x4a9a3c)],
  pine: [
    B(0.42, 0, 0.42, 0.16, 0.5, 0.16, 0x5b3d24),
    B(0.1, 0.4, 0.1, 0.8, 0.5, 0.8, 0x24603a),
    B(0.2, 0.85, 0.2, 0.6, 0.5, 0.6, 0x2b7044),
    B(0.32, 1.3, 0.32, 0.36, 0.45, 0.36, 0x348050),
  ],
  // Trees of the biomes (4.4, land.ts LOOKS): a palm, a pine under snow, a
  // tall broad jungle tree, a drooping willow, a squat juniper.
  palm: [
    B(0.44, 0, 0.44, 0.14, 0.5, 0.14, 0x8a6a44),
    B(0.46, 0.45, 0.42, 0.13, 0.5, 0.14, 0x957450),
    B(0.43, 0.9, 0.43, 0.15, 0.4, 0.15, 0x8a6a44),
    B(0.05, 1.22, 0.38, 0.9, 0.1, 0.26, 0x3f8a36),
    B(0.38, 1.24, 0.05, 0.26, 0.1, 0.9, 0x4a9a3c),
    B(0.3, 1.3, 0.3, 0.4, 0.12, 0.4, 0x377a30),
  ],
  snowpine: [
    B(0.42, 0, 0.42, 0.16, 0.45, 0.16, 0x5b3d24),
    B(0.1, 0.35, 0.1, 0.8, 0.45, 0.8, 0x2a5a40),
    B(0.12, 0.78, 0.12, 0.76, 0.06, 0.76, 0xf2f6fa),
    B(0.2, 0.84, 0.2, 0.6, 0.45, 0.6, 0x306848),
    B(0.22, 1.27, 0.22, 0.56, 0.06, 0.56, 0xf6f9fc),
    B(0.32, 1.33, 0.32, 0.36, 0.4, 0.36, 0x387452),
    B(0.33, 1.71, 0.33, 0.34, 0.07, 0.34, 0xffffff),
  ],
  jungle: [
    B(0.38, 0, 0.38, 0.24, 1.2, 0.24, 0x5e4026),
    B(-0.05, 1.05, -0.05, 1.1, 0.45, 1.1, 0x2f7d2a),
    B(0.1, 1.45, 0.1, 0.8, 0.35, 0.8, 0x3a8f32),
    B(0.0, 0.6, 0.35, 0.3, 0.3, 0.3, 0x2a7026),
  ],
  willow: [
    B(0.38, 0, 0.38, 0.24, 0.8, 0.24, 0x4e3a26),
    B(0.05, 0.75, 0.05, 0.9, 0.35, 0.9, 0x5f8a3a),
    B(0.0, 0.25, 0.0, 0.14, 0.55, 0.9, 0x6a9442),
    B(0.86, 0.25, 0.0, 0.14, 0.55, 0.9, 0x6a9442),
    B(0.14, 0.3, 0.0, 0.72, 0.5, 0.12, 0x648e40),
    B(0.14, 0.3, 0.88, 0.72, 0.5, 0.12, 0x648e40),
  ],
  juniper: [B(0.42, 0, 0.42, 0.16, 0.35, 0.16, 0x6b4a2b), B(0.15, 0.3, 0.15, 0.7, 0.45, 0.7, 0x4f6a3a), B(0.28, 0.72, 0.28, 0.44, 0.25, 0.44, 0x5a7842)],
  bush: [B(0.2, 0, 0.2, 0.6, 0.4, 0.6, 0x4f9136)],
  crop: [B(0.15, 0, 0.15, 0.2, 0.45, 0.2, 0xe0c14a), B(0.6, 0, 0.25, 0.2, 0.5, 0.2, 0xd6b23e), B(0.35, 0, 0.6, 0.2, 0.4, 0.2, 0xe8cc58)],
  house: [
    B(0.08, 0, 0.08, 0.84, 0.7, 0.84, 0xe8dcc0),
    B(0.42, 0, 0.92, 0.18, 0.4, 0.02, 0x5b3d24),
    B(0.0, 0.7, 0.0, 1, 0.22, 1, 0xb5523b),
    B(0.15, 0.92, 0.15, 0.7, 0.2, 0.7, 0xc05d44),
    B(0.32, 1.12, 0.32, 0.36, 0.14, 0.36, 0xa84a35),
  ],
  rubble: [B(0.1, 0, 0.15, 0.35, 0.22, 0.3, 0x8c7c6c), B(0.5, 0, 0.45, 0.4, 0.3, 0.35, 0x7a6b5d), B(0.3, 0.2, 0.3, 0.3, 0.15, 0.25, 0xb5523b)],
  powder: [B(0.25, 0, 0.25, 0.5, 0.55, 0.5, 0x3a3a3a), B(0.3, 0.55, 0.3, 0.4, 0.06, 0.4, 0x8a5a2a)],
  stump: [B(0.35, 0, 0.35, 0.3, 0.25, 0.3, 0x5b4128)],
  flower: [B(0.2, 0, 0.3, 0.12, 0.25, 0.12, 0xe86a9a), B(0.6, 0, 0.55, 0.12, 0.2, 0.12, 0xf2c94c), B(0.4, 0, 0.7, 0.12, 0.22, 0.12, 0xa98cf0)],
  boulder: [B(0.1, 0, 0.1, 0.8, 0.55, 0.8, 0x9a9aa0), B(0.25, 0.5, 0.2, 0.5, 0.25, 0.5, 0xa8a8ae)],
  // Spell defined covers: a block in the material's own color (tinted per instance).
  block: [B(0.1, 0, 0.1, 0.8, 0.8, 0.8, 0xffffff)],
  slab: [B(0.1, 0, 0.1, 0.8, 0.3, 0.8, 0xffffff)],
  // Creatures, centered on x and z.
  body: [B(-0.5, 0, -0.5, 1, 1, 1, 0xffffff)],
  head: [B(-0.5, 0, -0.5, 1, 1, 1, 0xf1c27d)],
  flame: [B(-0.5, 0, -0.5, 1, 1, 1, 0xffffff)],
  puff: [B(-0.5, -0.5, -0.5, 1, 1, 1, 0xffffff)],
};
