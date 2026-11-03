import { isArtifact } from "./artifacts";
import { daylight } from "./daylight";
import { unpackLook } from "./villagers";
import type { World } from "./world";
import type { ChronicleDigest } from "../../shared/chronicle";

export type { ChronicleDigest };

// What the chronicle is written from (3.7): the island's story lines, its
// everyday work counted, what villagers remember of who hurt or helped them,
// and how the island stands now. Plain data, built in the World frame and
// sent to the page, then to the Worker, where Haiku writes it as a tale.
// Names in it come from players' merges: the Worker treats it as data.

const DAY = 360;

export function chronicleDigest(world: World): ChronicleDigest {
  const lines = world.story.slice(-40).map((l) => {
    const day = Math.floor(l.t / DAY) + 1;
    return `day ${day}${daylight(l.t).night > 0.5 ? ", by night" : ""}: ${l.text}${l.n > 1 ? ` (${l.n} times)` : ""}`;
  });
  const work = Object.entries(world.storyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([what, n]) => `${what}: ${n} times`);
  // What the villagers remember, together: harm and help by kind.
  const felt = new Map<string, { hurt: number; helped: number }>();
  let villagers = 0;
  let children = 0;
  let elders = 0;
  for (const c of world.creatures) {
    if (c.dead || c.kind !== "villager") continue;
    villagers++;
    const age = unpackLook(c.look).age;
    if (age === "child") children++;
    if (age === "elder") elders++;
    for (const e of c.mind?.memory ?? []) {
      if (Math.abs(e.feel) < 0.5) continue;
      const f = felt.get(e.kind) ?? { hurt: 0, helped: 0 };
      if (e.feel < 0) f.hurt++;
      else f.helped++;
      felt.set(e.kind, f);
    }
  }
  const memories: string[] = [];
  for (const [kind, f] of [...felt].sort((a, b) => b[1].hurt + b[1].helped - (a[1].hurt + a[1].helped)).slice(0, 8)) {
    const who = kind === "magic" ? "magic" : `the ${kind}`;
    if (f.hurt) memories.push(`${f.hurt} villagers remember ${who} hurt them`);
    if (f.helped) memories.push(`${f.helped} villagers remember ${who} helped them`);
  }
  const animals = new Map<string, number>();
  for (const c of world.creatures) if (!c.dead && c.kind !== "villager") animals.set(c.kind.split("#")[0], (animals.get(c.kind.split("#")[0]) ?? 0) + 1);
  const now = [
    `${villagers} villagers (${children} children, ${elders} elders) in ${world.villages.length} villages`,
    ...world.villages.slice(0, 4).map((v, n) => `village ${n + 1}: food ${Math.floor(v.food)}, wood ${Math.floor(v.wood)}, gold ${Math.floor(v.gold)}`),
    `creatures: ${
      [...animals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, n]) => `${n} ${k}`)
        .join(", ") || "none"
    }`,
    ...world.landmarks
      .filter(isArtifact)
      .slice(0, 6)
      .map((a) => `the ${a.name} stands on the island${a.art.did.length ? `; it ${a.art.did[0]}` : ""}`),
  ];
  return { days: Math.floor(world.time / DAY) + 1, lines, work, memories, now };
}
