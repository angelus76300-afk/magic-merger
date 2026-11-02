// Villagers who differ (3.5): children and elders, clothes per village, a
// look per job. All of it is one number per villager, saved with it, so a
// reloaded island keeps its people. Jobs are only looks until 3.6 gives them
// work to do.

export const AGES = ["adult", "child", "elder"] as const;
export type Age = (typeof AGES)[number];
export const JOBS = ["none", "farmer", "woodcutter", "fisher", "smith", "guard", "priest", "merchant"] as const;
export type Job = (typeof JOBS)[number];

export interface Look {
  age: Age;
  job: Job;
  // Which village's clothes, an index into STYLES.
  style: number;
  skin: number;
  hair: number;
  // Short or long hair.
  long: boolean;
}

// Clothes per village: shirts to pick from, trousers, hats, and the priest's hood.
export const STYLES: { name: string; shirts: number[]; pants: number; hat: number; cloth: number }[] = [
  { name: "brick and oak", shirts: [0xc0392b, 0xd35400, 0xe8dcc0], pants: 0x5b3d24, hat: 0x7a5230, cloth: 0x6a2a20 },
  { name: "sea blue", shirts: [0x2e6fbf, 0x5dade2, 0xf2f2f2], pants: 0x34495e, hat: 0x1f3a5f, cloth: 0x1a2a4a },
  { name: "meadow", shirts: [0x5aa65a, 0x9bc45a, 0xf1e3b0], pants: 0x6e5a3a, hat: 0x3f6b35, cloth: 0x2e4a28 },
  { name: "saffron", shirts: [0xe0a030, 0xf4d03f, 0xa04020], pants: 0x7b4a2a, hat: 0x9a6b1f, cloth: 0x8a3a1a },
  { name: "heather", shirts: [0x8e5aa8, 0xc39bd3, 0x5b3a70], pants: 0x3d3346, hat: 0x4a2d5a, cloth: 0x3a2048 },
  { name: "slate", shirts: [0x7f8c8d, 0xbdc3c7, 0x16a085], pants: 0x2c3e50, hat: 0x2c2c2c, cloth: 0x2a2a34 },
];
export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa86b3c];
export const HAIRS = [0x2b1d14, 0x5a3a1e, 0x8a5a2b, 0xd9b45a, 0xa33a1a, 0x111111];
export const GRAY_HAIR = 0xd8d8d8;

// Job shares among adults, then whether an adult is a child or an elder.
const JOB_WEIGHTS: [Job, number][] = [
  ["none", 20],
  ["farmer", 25],
  ["woodcutter", 14],
  ["fisher", 10],
  ["smith", 7],
  ["guard", 10],
  ["priest", 5],
  ["merchant", 9],
];

function weighted<T>(list: [T, number][], r: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of list) {
    x -= w;
    if (x < 0) return v;
  }
  return list[list.length - 1][0];
}

// Bits: age 2, job 4, style 3, skin 3, hair 3, long 1.
export function packLook(l: Look): number {
  return (
    AGES.indexOf(l.age) |
    (JOBS.indexOf(l.job) << 2) |
    ((l.style & 7) << 6) |
    (l.skin % SKINS.length << 9) |
    (l.hair % HAIRS.length << 12) |
    ((l.long ? 1 : 0) << 15)
  );
}

export function unpackLook(n: number): Look {
  return {
    age: AGES[n & 3] ?? "adult",
    job: JOBS[(n >> 2) & 15] ?? "none",
    style: ((n >> 6) & 7) % STYLES.length,
    skin: ((n >> 9) & 7) % SKINS.length,
    hair: ((n >> 12) & 7) % HAIRS.length,
    long: ((n >> 15) & 1) === 1,
  };
}

export function randomLook(style: number, rnd: () => number = Math.random, age?: Age): Look {
  const a = age ?? (rnd() < 0.2 ? "child" : rnd() < 0.18 ? "elder" : "adult");
  let job: Job = a === "child" ? "none" : weighted(JOB_WEIGHTS, rnd());
  if (a === "elder" && job !== "priest") job = rnd() < 0.3 ? "priest" : "none";
  return { age: a, job, style, skin: (rnd() * SKINS.length) | 0, hair: (rnd() * HAIRS.length) | 0, long: rnd() < 0.45 };
}

// Children are small and so weaker and slower (hp and speed follow size).
export function sizeOf(l: Look): number {
  return l.age === "child" ? 0.68 : l.age === "elder" ? 0.95 : 1;
}

export function shirtOf(l: Look, rnd: () => number = Math.random): number {
  const s = STYLES[l.style].shirts;
  return s[(rnd() * s.length) | 0];
}
