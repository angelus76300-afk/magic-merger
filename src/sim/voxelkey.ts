// Keys of free standing voxels (world.decor): one number per voxel,
// ((y * 1024 + x) * 512 + level + 128). Level is in voxels, the same unit as
// the terrain's column tops (half a height unit each), from -128 to 383.
// Every module that reads or builds a key goes through here.

export const KEY_LEVELS = 512;
export const KEY_ROW = 1024;
const LEVEL_OFFSET = 128;

export function voxelKey(x: number, y: number, level: number): number {
  return ((Math.round(y) * KEY_ROW + Math.round(x)) * KEY_LEVELS + (Math.round(level) + LEVEL_OFFSET)) >>> 0;
}

// The three parts, without allocating: for loops over thousands of voxels.
export function keyX(key: number): number {
  return Math.floor(key / KEY_LEVELS) % KEY_ROW;
}
export function keyY(key: number): number {
  return Math.floor(key / (KEY_LEVELS * KEY_ROW));
}
export function keyLevel(key: number): number {
  return (key % KEY_LEVELS) - LEVEL_OFFSET;
}

export function keyCell(key: number): { x: number; y: number; level: number } {
  return { x: keyX(key), y: keyY(key), level: keyLevel(key) };
}

// What to add to a key to move by (dx, dy, dl).
export function keyOffset(dx: number, dy: number, dl: number): number {
  return (dy * KEY_ROW + dx) * KEY_LEVELS + dl;
}

// The six face neighbors: up, down, then the four sides.
export const FACE_STEPS: readonly number[] = [1, -1, KEY_LEVELS, -KEY_LEVELS, KEY_ROW * KEY_LEVELS, -KEY_ROW * KEY_LEVELS];
