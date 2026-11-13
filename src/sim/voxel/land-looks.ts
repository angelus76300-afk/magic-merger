// The land's looks of 5.2.5 (terrain.ts, terrain-fine.ts), each its own switch of GRAPHICS so the
// Perf Lab can measure it alone ("off=steps"). Drawing only: the simulation's heights and grounds
// are never changed. With all of them off the land and water are drawn exactly as before them
// (scripts/terrain-looks-test.ts).
export const LAND_LOOKS = {
  // Near where the camera looks, each cell of land drawn as columns of eighth voxels (close up)
  // or quarter voxels (a little farther), the scale of the reference models; the one cell mesh
  // farther away and from high up.
  fine: true,
  // In the fine land: a rise of one voxel becomes a few small irregular steps; a cliff of two or
  // more keeps its wall and gets a broken top lip.
  steps: true,
  // In the fine land: the border of two grounds that meet (grass and sand, dirt, rock, snow or a
  // path) is a wavy line; sand reaches into the shallows; grass and snow hang over cliff edges.
  blend: true,
  // In the fine land: each ground in soft patches of three shades, soil the same, and cliffs in
  // darker strata bands.
  grain: true,
  // In the fine land: a line of white foam where water meets land.
  foam: true,
  // In the fine land: a few small clusters of flowers on grass and pebbles on sand.
  bits: true,
  // Water in bands of colour by depth, clearer in the shallows so the bed shows (everywhere).
  bands: true,
};
