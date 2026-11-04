// What the Worker needs to know about wonders (4.4.5 part C), without the
// simulation: the rarities, the spots a wonder written as a program may ask
// for, and the built-in catalog (src/sim/wonders.ts, checked equal by
// `npm test`), so the daily wonder's prompt can list what islands already have.

export const RARITIES = ["common", "uncommon", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const SPOTS = ["high", "slope", "flat", "low", "drop", "forest", "shore", "sea", "water"] as const;
export type Spot = (typeof SPOTS)[number];

// The reach a wonder of each rarity may have, in cells (the prompt says the same).
export const REACH: Record<Rarity, [number, number]> = { common: [4, 6], uncommon: [5, 8], rare: [6, 10], legendary: [8, 14] };

export const BUILT_IN_WONDERS: readonly { kind: string; rarity: Rarity; does: string }[] = [
  { kind: "waterfall", rarity: "common", does: "its mist keeps fire away and the land around it green" },
  { kind: "hot spring", rarity: "common", does: "it melts the snow around it and heals whoever bathes in it" },
  { kind: "cave mouth", rarity: "common", does: "animals shelter in it from fire and the night, and come out healed" },
  { kind: "stone arch", rarity: "common", does: "the wind sings through it, and whoever comes near it forgets their fear" },
  { kind: "lone tree", rarity: "common", does: "birds come to it, people rest under it, and it seeds the land around" },
  { kind: "ruins", rarity: "uncommon", does: "explorers find old coins in them, and monsters are drawn to them" },
  { kind: "sinkhole lake", rarity: "uncommon", does: "its deep water never freezes or runs dry, and fish live through any winter in it" },
  { kind: "geysers", rarity: "uncommon", does: "every half minute they throw up a column of water and whoever stands on them" },
  { kind: "sea stacks", rarity: "uncommon", does: "seabirds nest on them, out of every hunter's reach" },
  { kind: "crater", rarity: "uncommon", does: "the strange ore in it draws miners, and it glows at night" },
  { kind: "floating rock", rarity: "rare", does: "it drifts over the island, and the moss under it rains: fires go out and the land greens where it passes" },
  { kind: "bones", rarity: "rare", does: "on a full moon the dead rise from them" },
  { kind: "frozen waterfall", rarity: "rare", does: "it keeps the cold around it; heat it and it runs again" },
  { kind: "fairy ring", rarity: "rare", does: "it hums at night, and creatures near it dance till dawn" },
  { kind: "world tree", rarity: "legendary", does: "it heals all around it, keeps monsters away and grows the forest back" },
  { kind: "hoard", rarity: "legendary", does: "its gold draws thieves, and the dragon wakes when anyone takes some" },
  { kind: "sunken temple", rarity: "legendary", does: "its runes glow under the sea at night, fish gather in it, and fishers bring up relics" },
];
