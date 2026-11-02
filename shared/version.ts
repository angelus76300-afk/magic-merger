// The World API version new programs are written for. Bumping it NEVER
// rewrites stored spells: 3.1 did that and Opus spell calls went from 43 to 96
// in a day. The API stays backward compatible (scripts/replay-stored.ts casts
// every stored program on the current runtime), and spells are rewritten one
// at a time from the admin card. History: 3 brought typed voxels, the structure
// kit, lightning and declared rules; 4 brought relationships (lures, scares,
// landmarks); 5 brought bodies (body, features, color2, model) and the wild
// animals; 6 brought goals, needs and abilities (goal, abilities). Kept apart from spellcode.ts so the game page does not pull in the
// JavaScript parser just to read a number.
export const PROGRAM_VERSION = 6;

// Programs from version 2 on are code. Version 1 rows are old declarative
// specs that nothing can run, so they are written once on their next cast.
export const FIRST_PROGRAM_VERSION = 2;
