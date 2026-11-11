import { C, F, G } from "./materials";
import { daylight } from "./daylight";
import { names } from "./social";
import { unpackLook, type Calling } from "./villagers";
import { WARD, addWard, warded } from "./wards";
import {
  ABILITIES,
  TRIGGERS,
  deed,
  mindOf,
  reborn,
  feeling,
  harmed,
  life,
  markAt,
  remember,
  villageOf,
  type AbilityName,
  type AbilitySpec,
  type Mind,
  type Trigger,
} from "./kin";
import type { Creature, CreatureKind } from "./creatures";

// Creatures cast library spells at most at minor (a house), at most once
// every 20 seconds each (3.7); the runtime caps how many run island wide.
export const CREATURE_CAST_CAP = "minor" as const;
export const CAST_EVERY = 20;
import type { World } from "./world";

// Abilities (3.6): a creature's own magic, from a fixed vocabulary of engine
// actions, each with a trigger and a cooldown. A dragon breathes fire when an
// enemy comes near, a priest heals the wounded every so often, a necromancer
// raises the dead at night, a rabbit digs a burrow when hurt. Declared by a
// spell (`abilities: [{ do: "freeze", when: "enemy near", every: 8 }]`), or
// read from the name of older creatures, like bodies and goals.

const NAME_ABILITIES: [string[], AbilitySpec][] = [
  [
    ["dragon", "dragons", "wyrm", "drake", "wyvern", "salamander", "hellhound", "demon", "inferno", "fire", "flame", "flaming", "infernal"],
    { do: "breathe fire", when: "enemy near", every: 10 },
  ],
  [["priest", "priestess", "cleric", "healer", "angel", "unicorn", "saint", "nymph"], { do: "heal", when: "every so often", every: 15 }],
  [["necromancer", "lich"], { do: "raise the dead", when: "night", every: 45 }],
  [["vampire", "dracula", "wizard", "mage", "sorcerer", "witch", "warlock", "djinn", "genie", "blink", "imp"], { do: "teleport", when: "hurt", every: 12 }],
  [["frost", "ice", "snow", "yeti", "winter", "glacier", "frozen"], { do: "freeze", when: "enemy near", every: 10 }],
  [["storm", "thunder", "lightning", "thunderbird", "tempest"], { do: "lightning", when: "enemy near", every: 12 }],
  [["dryad", "treant", "ent", "sylvan", "druid", "gardener", "fairy", "sprout", "bloom"], { do: "grow", when: "every so often", every: 12 }],
  [["knight", "paladin", "guardian", "golem", "templar", "sentinel", "defender", "protector"], { do: "shield", when: "enemy near", every: 25 }],
  [["mole", "worm", "beaver", "dwarf", "gnome", "miner", "digger", "rabbit"], { do: "dig", when: "hurt", every: 15 }],
  [["kraken", "naiad", "tide", "leviathan", "undine"], { do: "flood", when: "enemy near", every: 20 }],
  [["goblin", "thief", "bandit", "rogue", "raccoon", "magpie", "kobold"], { do: "steal", when: "every so often", every: 15 }],
  [["queen", "hive", "broodmother", "alpha", "summoner", "conjurer"], { do: "summon", when: "hurt", every: 30 }],
];
// Defensive magic an item's name or promise must call for (the owner, 7
// November: "a serpent raising a shield does not fit its name"). A shield, a
// ward, or healing itself when hurt is for what protects or heals: a promise
// to protect or heal, or a name that says so (the guardians above, the
// healers, and the few beings known to mend: a troll, a hydra, a phoenix).
const DEFENDERS =
  /\b(knight|paladin|guardian|golem|templar|sentinel|defender|protector|shield|ward|warden|aegis|bastion|bulwark|sanctuary|turtle|tortoise|armadillo|guard|priest|priestess|cleric|healer|saint|angel|archangel|seraph|seraphim|cherub|valkyrie|sentry|keeper|barrier|fortress|citadel|haven|refuge|ark|unicorn|nymph|troll|hydra|phoenix|mender)s?\b/i;
// Is protection what this item is about? Its name says so, or protect is its
// main intent. A second intent does not count: the intent call gave protect
// to 123 live items of which 23 are about protection (62 of the 64 second
// intents were not: Gold, Clay, Ice, Werewolf, Dinosaur), each was then told
// its test would attack a village, and 127 programs raised a dome (the review
// of 10 November).
export function promisesProtection(name: string, intents: readonly string[]): boolean {
  return DEFENDERS.test(name) || intents[0] === "protect";
}

export function unfitDefence(name: string, intents: readonly string[], abilities: readonly AbilitySpec[], wards: number): string | null {
  if (promisesProtection(name, intents)) return null;
  const shield = abilities.some((a) => a.do === "shield");
  const mends = !intents.includes("heal") && abilities.some((a) => a.do === "heal" && a.when === "hurt");
  if (!shield && !mends && wards <= 0) return null;
  const what = [shield ? "a shield" : "", mends ? "healing itself when hurt" : "", wards > 0 ? "a ward" : ""].filter(Boolean).join(", ");
  return `${name} raises defensive magic (${what}), but neither its name nor what it promises is about protection: a serpent hunts, a fox spirit tricks, neither shields. Give it what its name does, and leave shields and wards to guardians and to items that promise to protect.`;
}

const INDEX = new Map<string, AbilitySpec[]>();
for (const [words, spec] of NAME_ABILITIES) for (const w of words) INDEX.set(w, [...(INDEX.get(w) ?? []), spec]);

export function abilitiesFromName(name: string): AbilitySpec[] {
  const out: AbilitySpec[] = [];
  for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
    const list = INDEX.get(raw) ?? (raw.endsWith("s") ? INDEX.get(raw.slice(0, -1)) : undefined);
    for (const s of list ?? []) if (!out.some((o) => o.do === s.do)) out.push(s);
  }
  return out.slice(0, 3);
}

const WORDS: Record<string, AbilityName> = {
  "fire breath": "breathe fire",
  fire: "breathe fire",
  breath: "breathe fire",
  raise: "raise the dead",
  "raise dead": "raise the dead",
  blink: "teleport",
  ward: "shield",
  burrow: "dig",
};
const WHEN: Record<string, Trigger> = {
  enemy: "enemy near",
  near: "enemy near",
  attacked: "hurt",
  hit: "hurt",
  dark: "night",
  death: "friend dies",
  "ally dies": "friend dies",
  often: "every so often",
  always: "every so often",
  periodic: "every so often",
};

// What a spell declares, bounded: three at most, cooldowns of 3 to 120 s.
export function abilitiesFrom(v: unknown): AbilitySpec[] | null {
  if (!Array.isArray(v)) return null;
  const out: AbilitySpec[] = [];
  for (const raw of v) {
    const r = typeof raw === "string" ? { do: raw } : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    // One with its own code is the spell's own ability (runtime.ts reads it).
    if (!r || typeof r.act === "function") continue;
    const name = String(r.do ?? r.name ?? r.ability ?? "")
      .trim()
      .toLowerCase();
    // A spell from the shared library, by name (3.7): "cast:Fireball" or {do: "cast", spell}.
    const spell = name.startsWith("cast:") ? String(r.do).trim().slice(5).trim() : name === "cast" && typeof r.spell === "string" ? r.spell.trim() : "";
    if (spell) {
      if (out.some((o) => o.do === "cast")) continue;
      const w = String(r.when ?? r.trigger ?? "")
        .trim()
        .toLowerCase();
      const when = (TRIGGERS as readonly string[]).includes(w) ? (w as Trigger) : (WHEN[w] ?? "enemy near");
      const every = typeof r.every === "number" && Number.isFinite(r.every) ? Math.max(CAST_EVERY, Math.min(300, r.every)) : 45;
      out.push({ do: "cast", when, every, spell: spell.slice(0, 60) });
      continue;
    }
    const what = (ABILITIES as readonly string[]).includes(name) ? (name as AbilityName) : WORDS[name];
    if (!what || out.some((o) => o.do === what)) continue;
    const w = String(r.when ?? r.trigger ?? "")
      .trim()
      .toLowerCase();
    const when = (TRIGGERS as readonly string[]).includes(w) ? (w as Trigger) : (WHEN[w] ?? DEFAULT_WHEN[what]);
    const every = typeof r.every === "number" && Number.isFinite(r.every) ? Math.max(3, Math.min(120, r.every)) : 12;
    out.push({ do: what, when, every });
  }
  return out.slice(0, 3);
}

const DEFAULT_WHEN: Record<AbilityName, Trigger> = {
  "breathe fire": "enemy near",
  heal: "every so often",
  summon: "hurt",
  teleport: "hurt",
  freeze: "enemy near",
  lightning: "enemy near",
  grow: "every so often",
  "raise the dead": "night",
  shield: "enemy near",
  dig: "hurt",
  flood: "enemy near",
  steal: "every so often",
};

// Villagers' abilities come from their job.
const PRIEST: AbilitySpec[] = [{ do: "heal", when: "every so often", every: 15 }];
const GUARD: AbilitySpec[] = [{ do: "shield", when: "enemy near", every: 30 }];

// 4.6 part B: a person's calling brings its own magic (villagers.ts).
const CALLING_ABILITIES: Partial<Record<Calling, AbilitySpec[]>> = {
  necromancer: [{ do: "raise the dead", when: "night", every: 40 }],
  knight: [{ do: "shield", when: "enemy near", every: 25 }],
  mage: [
    { do: "freeze", when: "enemy near", every: 15 },
    { do: "teleport", when: "hurt", every: 12 },
  ],
};

export function abilitiesOf(c: Creature, k: CreatureKind): AbilitySpec[] {
  if (c.kind === "villager") {
    const look = unpackLook(c.look);
    const own = CALLING_ABILITIES[look.calling ?? "none"];
    if (own) return own;
    const job = look.job;
    return job === "priest" ? PRIEST : job === "guard" ? GUARD : [];
  }
  return k.abilities ?? [];
}

// Checks each ability's trigger about three times a second, whatever the
// creature is doing (fleeing included: a hunted witch freezes her hunter).
export function useAbilities(world: World, c: Creature, k: CreatureKind): void {
  if ((world.tick + c.id) % 10 !== 0) return;
  const list = abilitiesOf(c, k);
  if (!list.length) return;
  const m = mindOf(c);
  const hpSeen = (c.data.hpSeen as number | undefined) ?? c.hp;
  const hurtNow = c.hp < hpSeen - 0.5 && c.hp < life.maxHp(c) * 0.75;
  c.data.hpSeen = c.hp;
  let enemy: Creature | null | undefined;
  for (let n = 0; n < list.length; n++) {
    const a = list[n];
    if (world.time < (m.ready[n] ?? 0)) continue;
    let fire = false;
    switch (a.when) {
      case "enemy near":
        enemy ??= enemyOf(world, c, k);
        fire = !!enemy;
        break;
      case "hurt":
        fire = hurtNow;
        enemy ??= enemyOf(world, c, k);
        break;
      case "night":
        fire = daylight(world.time).night > 0.6;
        break;
      case "friend dies":
        fire = world.deaths.some((d) => d.t > world.time - 1.2 && sameSide(c, d.kind) && Math.abs(d.x - c.x) < 12 && Math.abs(d.y - c.y) < 12);
        break;
      case "every so often":
        fire = true;
        break;
    }
    if (!fire) continue;
    if (a.do === "cast") enemy ??= enemyOf(world, c, k);
    // A spell's own ability runs its code; a library spell goes through the
    // runtime, at a creature's tier (minor at most); the twelve run here.
    const at = enemy ?? c;
    const done =
      a.do === "cast" && a.spell
        ? !!world.magic?.cast(a.spell, at.x, at.y, CREATURE_CAST_CAP, c.kind, !!enemy)
        : a.run
          ? a.run(c, enemy ?? null)
          : perform(world, c, k, m, a.do as AbilityName, enemy ?? null);
    if (done && (a.run || a.do === "cast")) deed(c, a.do === "cast" ? `cast ${a.spell}` : a.do);
    // 4.6 part B: counted for the creature probe of the test run (check.ts).
    if (done) c.data.used = Number(c.data.used ?? 0) + 1;
    // Nothing to do it on: look again in a few seconds instead of a full cooldown.
    m.ready[n] = world.time + (done ? a.every : 3);
  }
}

function sameSide(c: Creature, kind: string): boolean {
  return kind.split("#")[0] === c.kind.split("#")[0];
}

// Who counts as an enemy: what hunts or scares it, what it hunts when
// hungry, what it remembers for harm, and for guards what threatens people.
export function enemyOf(world: World, c: Creature, k: CreatureKind, r = 7): Creature | null {
  let best: Creature | null = null;
  let bestD = r;
  const prey = k.ai?.prey ?? [];
  for (const o of world.crowd.near(world, c.x, c.y, r)) {
    if (o === c || sameSide(c, o.kind) || (o.mind?.tame && c.kind === "villager")) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d >= bestD) continue;
    const ok = life.kindOf(o);
    const ai = ok.ai;
    const huntsMe = !!ai && ai.mode === "hunt" && (ai.prey.length ? names(ai.prey, c.kind) : true);
    const scaresMe = !!ai && names(ai.scares, c.kind);
    const mine = k.ai?.mode === "hunt" && (prey.length ? names(prey, o.kind) : true);
    const peopleThreat =
      (c.kind === "villager" || k.ai?.mode === "guard") && !!ai && (ai.converts || (ai.mode === "hunt" && (!ai.prey.length || names(ai.prey, "villager"))));
    if (huntsMe || scaresMe || mine || peopleThreat || feeling(c, o.kind) <= -1 || (c.mind?.task === "fight" && c.mind.target === o)) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function puff(world: World, x: number, y: number, color: number, n = 6, size = 1.2): void {
  for (let k = 0; k < n; k++)
    world.particles.add({
      x: x + (Math.random() - 0.5) * 1.5,
      y: y + (Math.random() - 0.5) * 1.5,
      z: 0.8,
      vz: 1.5 + Math.random(),
      life: 0.8,
      color,
      size,
      glow: true,
    });
}

function cellOf(world: World, x: number, y: number): number {
  return world.idx(Math.max(0, Math.min(world.w - 1, x)), Math.max(0, Math.min(world.h - 1, y)));
}

function walkable(world: World, i: number): boolean {
  return world.depth[i] < 0.6 && !world.materials.get("cover", world.cover[i]).solid && world.fire[i] < 0.2 && world.fluid[i] !== F.LAVA;
}

// Does it; false when there was nothing to do it on.
function perform(world: World, c: Creature, k: CreatureKind, m: Mind, what: AbilityName, enemy: Creature | null): boolean {
  switch (what) {
    case "breathe fire": {
      const t = enemy;
      if (!t) return false;
      const d = Math.hypot(t.x - c.x, t.y - c.y) || 1;
      const reach = Math.min(6, d + 1);
      for (let s = 1; s <= reach; s += 0.7) {
        const i = cellOf(world, c.x + ((t.x - c.x) / d) * s, c.y + ((t.y - c.y) / d) * s);
        if (warded(world, i, WARD.fire)) break;
        if (s > d - 1.5) world.fire[i] = Math.max(world.fire[i], 0.7);
        world.particles.add({ x: i % world.w, y: Math.floor(i / world.w), z: c.z + 1, vz: 1, life: 0.6, color: 0xff7a1a, size: 1.6, glow: true });
      }
      if (!life.kindOf(t).fireproof) t.burning = Math.max(t.burning, 3);
      t.hp -= 18;
      harmed(world, t, c, 18);
      if (t.hp <= 0) t.dead = true;
      world.emit({ kind: "sound", name: "whoosh", size: 0.4, x: c.x, y: c.y });
      // A dragon roars as it breathes fire (4.8, item 4).
      if (k.body.plan === "dragon") world.emit({ kind: "sound", name: "roar", size: 0.8, x: c.x, y: c.y });
      deed(c, `breathed fire on a ${t.kind.split("#")[0]}`);
      return true;
    }
    case "heal": {
      let n = 0;
      for (const o of world.crowd.near(world, c.x, c.y, 6)) {
        if (o.hp >= life.maxHp(o) * 0.85 && o.burning <= 0) continue;
        if (!(sameSide(c, o.kind) || (c.kind === "villager" && o.mind?.tame)) && !(c.kind !== "villager" && o.kind === "villager" && !k.ai?.converts)) continue;
        o.hp = Math.min(life.maxHp(o), o.hp + 30);
        o.burning = 0;
        if (o !== c) remember(o, c.kind === "villager" ? "priest" : c.kind, 1);
        puff(world, o.x, o.y, 0x9dffb0, 4);
        n++;
      }
      if (n) deed(c, n > 1 ? `healed ${n} wounded` : "healed the wounded");
      return n > 0;
    }
    case "summon": {
      const kind = k.name;
      let near = 0;
      for (const o of world.crowd.near(world, c.x, c.y, 20)) if (o.kind === kind) near++;
      if (near >= 8 || world.creatures.length > 480) return false;
      for (let n = 0; n < 2; n++) {
        const s = life.make(kind, c.x + (Math.random() - 0.5) * 3, c.y + (Math.random() - 0.5) * 3);
        s.homeX = c.homeX;
        s.homeY = c.homeY;
        world.creatures.push(s);
        puff(world, s.x, s.y, k.color, 5);
      }
      deed(c, "summoned its kin");
      return true;
    }
    case "teleport": {
      const from = enemy ?? null;
      for (let tries = 0; tries < 10; tries++) {
        const a = from ? Math.atan2(c.y - from.y, c.x - from.x) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 6;
        const x = c.x + Math.cos(a) * r;
        const y = c.y + Math.sin(a) * r;
        if (x < 2 || y < 2 || x > world.w - 3 || y > world.h - 3) continue;
        if (!k.flying && !walkable(world, cellOf(world, x, y))) continue;
        puff(world, c.x, c.y, k.color, 6);
        c.x = x;
        c.y = y;
        puff(world, c.x, c.y, k.color, 6);
        world.emit({ kind: "sound", name: "ping", size: 0.3, x: c.x, y: c.y });
        deed(c, "vanished and appeared elsewhere");
        if (m.target === from) m.task = "none";
        return true;
      }
      return false;
    }
    case "freeze": {
      const t = enemy;
      if (!t) return false;
      t.frozen = Math.max(t.frozen, 3);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = cellOf(world, t.x + dx, t.y + dy);
          if (warded(world, i, WARD.cold)) continue;
          world.temp[i] = Math.min(world.temp[i], -10);
          world.fire[i] = 0;
          if (world.fluid[i] === F.WATER && world.depth[i] < 1.5) world.fluid[i] = F.ICE;
        }
      puff(world, t.x, t.y, 0xbfe8ff, 8);
      harmed(world, t, c, 1);
      deed(c, `froze a ${t.kind.split("#")[0]}`);
      return true;
    }
    case "lightning": {
      const t = enemy;
      if (!t) return false;
      const i = cellOf(world, t.x, t.y);
      if (warded(world, i, WARD.lightning)) return false;
      t.hp -= 35;
      t.stun = Math.max(t.stun, 1);
      harmed(world, t, c, 35);
      if (t.hp <= 0) t.dead = true;
      if (world.materials.get("cover", world.cover[i]).flammable > 0) world.fire[i] = Math.max(world.fire[i], 0.8);
      world.emit({ kind: "flash", color: 0xdfe8ff, strength: 0.25 });
      world.emit({ kind: "sound", name: "zap", size: 0.5, x: t.x, y: t.y });
      puff(world, t.x, t.y, 0xdfe8ff, 10, 1.6);
      deed(c, `struck a ${t.kind.split("#")[0]} with lightning`);
      return true;
    }
    case "grow": {
      let n = 0;
      for (let tries = 0; tries < 10 && n < 5; tries++) {
        const i = cellOf(world, c.x + (Math.random() - 0.5) * 7, c.y + (Math.random() - 0.5) * 7);
        if (world.depth[i] > 0.05 || world.fire[i] > 0) continue;
        if (world.ground[i] === G.DIRT || world.ground[i] === G.ASH) world.ground[i] = G.GRASS;
        else if (world.cover[i] === C.STUMP) world.setCover(i, C.TREE);
        else if (world.ground[i] === G.GRASS && world.cover[i] === C.NONE) world.setCover(i, Math.random() < 0.6 ? C.FLOWER : C.BUSH);
        else continue;
        n++;
      }
      if (n) {
        puff(world, c.x, c.y, 0x9dffb0, 5);
        deed(c, "made the land grow");
      }
      return n > 0;
    }
    case "raise the dead": {
      // A villager necromancer (4.6 part B) raises thralls bound to its
      // village, three at most about it; any other raiser the hungry risen.
      const person = c.kind === "villager";
      const raised = person ? "thrall" : "risen";
      let bound = 0;
      if (person) for (const o of world.creatures) if (!o.dead && o.kind === "thrall" && Math.abs(o.x - c.x) < 14 && Math.abs(o.y - c.y) < 14) bound++;
      if (bound >= 3) return false;
      let n = 0;
      for (const o of world.creatures) {
        if (n >= 3 - bound || !o.dead || o.deadFor > 35 || o.data.eaten || o.data.buried || (o.kind === c.kind && !person)) continue;
        if (Math.abs(o.x - c.x) > 10 || Math.abs(o.y - c.y) > 10) continue;
        o.kind = raised;
        o.color = person ? 0xb8c4a8 : 0xd8d4c8;
        o.dead = false;
        o.deadFor = 0;
        o.vz = 0;
        o.z = 0;
        o.hp = life.maxHp(o) * 0.6;
        o.data = {};
        reborn(o);
        puff(world, o.x, o.y, 0x9a7aff, 6);
        n++;
      }
      // With no one to raise, a grave is opened instead.
      if (!n) {
        const yard = world.marks.find((mk) => mk.kind === "graveyard" && Math.abs(mk.x - c.x) < 14 && Math.abs(mk.y - c.y) < 14);
        if (world.creatures.length > 480) return false;
        // A person calls an old grave open where it stands: every island has its dead.
        if (!yard && !person) return false;
        const at = yard ? { x: yard.x + 0.5, y: yard.y + 0.5 } : { x: c.x + 1, y: c.y };
        const r = life.make(raised, at.x, at.y);
        world.creatures.push(r);
        puff(world, r.x, r.y, 0x9a7aff, 6);
        n = 1;
      }
      deed(c, n > 1 ? `raised ${n} of the dead` : "raised the dead");
      return true;
    }
    case "shield": {
      if (world.wards.some((w) => Math.hypot(w.x - c.x, w.y - c.y) < 3)) return false;
      addWard(world, {
        x: c.x,
        y: c.y,
        r: 3.5,
        against: WARD.creatures | WARD.harm | WARD.fire,
        from: world.time,
        until: world.time + 6,
        color: 0x9fd8ff,
        keepOut: [],
        allow: [],
        owner: "creature",
        hit: 0,
      });
      deed(c, "raised a shield");
      return true;
    }
    case "dig": {
      const i = cellOf(world, c.x, c.y);
      if (world.depth[i] > 0.05 || world.cover[i] !== C.NONE) return false;
      world.height[i] = Math.max(world.seaLevel + 0.3, world.height[i] - 0.4);
      world.ground[i] = G.DIRT;
      markAt(world, "burrow", c.x, c.y, c.kind, 2);
      // Underground and out again a little further on.
      if (enemy) {
        const d = Math.hypot(c.x - enemy.x, c.y - enemy.y) || 1;
        const j = cellOf(world, c.x + ((c.x - enemy.x) / d) * 4, c.y + ((c.y - enemy.y) / d) * 4);
        if (walkable(world, j)) {
          c.x = j % world.w;
          c.y = Math.floor(j / world.w);
        }
      }
      puff(world, c.x, c.y, 0x8a6a4a, 5);
      deed(c, "dug a burrow");
      return true;
    }
    case "flood": {
      const t = enemy;
      if (!t) return false;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const i = cellOf(world, t.x + dx, t.y + dy);
          if (warded(world, i, WARD.fluids) || world.cover[i] === C.HOUSE) continue;
          if (world.fluid[i] === F.NONE || world.fluid[i] === F.WATER) {
            world.setFluid(i, F.WATER, world.depth[i] + 0.5);
            world.fire[i] = 0;
            n++;
          }
        }
      if (n) {
        harmed(world, t, c, 1);
        deed(c, "flooded its enemy");
      }
      return n > 0;
    }
    case "steal": {
      for (const o of world.crowd.near(world, c.x, c.y, 3)) {
        if (o === c || !o.mind?.carry || sameSide(c, o.kind)) continue;
        m.carry = o.mind.carry;
        o.mind.carry = null;
        if (o.mind.task === "carry") o.mind.task = "none";
        remember(o, c.kind, -1);
        deed(c, `stole ${m.carry} from a ${o.kind.split("#")[0]}`);
        return true;
      }
      const v = villageOf(world, c.x, c.y);
      if (!m.carry && v && Math.hypot(v.x - c.x, v.y - c.y) < 6 && v.food >= 1) {
        v.food -= 1;
        m.carry = "loot";
        deed(c, "stole from a village");
        return true;
      }
      return false;
    }
  }
  return false;
}
