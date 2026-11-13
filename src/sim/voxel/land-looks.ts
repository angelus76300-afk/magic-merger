// The land's looks of 5.2.5 (terrain.ts, terrain-fine.ts), each its own switch of GRAPHICS so the
// Perf Lab can measure it alone ("off=steps"). Drawing only: the simulation's heights and grounds
// are never changed. With all of them off the land and water are drawn exactly as before them
// (scripts/terrain-looks-test.ts).
export const LAND_LOOKS = {
  // Near the camera (close and mid zoom), each cell of land drawn as 4 by 4 columns of quarter
  // voxels, the scale of the reference models; the one cell mesh farther away and from high up.
  fine: true,
  // In the fine land: a rise of one voxel becomes a few small irregular steps; a cliff of two or
  // more keeps its wall and gets a broken top lip.
  steps: true,
  // In the fine land: grounds that meet (grass and sand, dirt, rock or snow) mix over a quarter
  // voxel or two; sand pokes out of the shallows; grass and snow hang over the edge of a cliff.
  blend: true,
  // In the fine land: every quarter voxel a tone of its own, soil with its own grain, and cliffs in
  // darker strata bands.
  grain: true,
  // In the fine land: a ring of white foam voxels where water meets land.
  foam: true,
  // Flowers on grass and pebbles on sand, single quarter voxels seeded by position (fine land).
  bits: true,
  // Water in bands of colour by depth, clearer in the shallows so the bed shows (everywhere).
  bands: true,
};
