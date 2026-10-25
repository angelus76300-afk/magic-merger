import type { CreatureName } from "../../shared/spell";
import type { Grid } from "./grid";
import { M } from "./materials";

export type CreatureType = Exclude<CreatureName, "none">;

export interface Creature {
  id: number;
  type: CreatureType;
  // Feet position in cells. The body extends upward from y.
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  hp: number;
  size: number;
  shirt: number;
  dead: boolean;
  // Seconds left for each status.
  burning: number;
  frozen: number;
  levitate: number;
  fear: number;
  fearX: number;
  sleep: number;
  calm: number;
  stun: number;
  // Walk or rest decisions.
  plan: number;
  breath: number;
  anim: number;
}

const BODY: Record<CreatureType, { w: number; h: number; speed: number; maxHp: number }> = {
  villager: { w: 2, h: 4, speed: 4, maxHp: 100 },
  beast: { w: 4, h: 3, speed: 5, maxHp: 80 },
  spirit: { w: 2, h: 3, speed: 3, maxHp: 60 },
  golem: { w: 4, h: 6, speed: 2.5, maxHp: 250 },
};

const SHIRTS = [0xd64545, 0x3f7fd9, 0xe0a030, 0x5aa65a, 0x9b59b6, 0xe67e22, 0x16a085, 0xc0c0c0];

let nextId = 1;

export function bodyOf(c: Creature): { w: number; h: number } {
  const b = BODY[c.type];
  return { w: Math.max(1, Math.round(b.w * c.size)), h: Math.max(2, Math.round(b.h * c.size)) };
}

export function maxHp(c: Creature): number {
  return BODY[c.type].maxHp * c.size;
}

export function makeCreature(type: CreatureType, x: number, y: number, shirt?: number): Creature {
  return {
    id: nextId++,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    dir: Math.random() < 0.5 ? -1 : 1,
    hp: BODY[type].maxHp,
    size: 1,
    shirt: shirt ?? SHIRTS[(Math.random() * SHIRTS.length) | 0],
    dead: false,
    burning: 0,
    frozen: 0,
    levitate: 0,
    fear: 0,
    fearX: 0,
    sleep: 0,
    calm: 0,
    stun: 0,
    plan: Math.random() * 3,
    breath: 6,
    anim: 0,
  };
}

// Restores a creature from a save, ignoring anything that does not belong.
export function reviveFromSave(raw: Partial<Creature>): Creature | null {
  if (!raw.type || !(raw.type in BODY) || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
  const c = makeCreature(raw.type, raw.x, raw.y, raw.shirt);
  c.hp = typeof raw.hp === "number" ? raw.hp : c.hp;
  c.size = typeof raw.size === "number" ? Math.min(3, Math.max(0.4, raw.size)) : 1;
  c.dead = raw.dead === true;
  return c;
}

export interface CreatureEvents {
  // Called for visual feedback: flames on a burning creature, sleep bubbles.
  emit(x: number, y: number, color: number, vx: number, vy: number, life: number): void;
}

const GRAVITY = 55;
const MAX_FALL = 45;

export function updateCreature(c: Creature, grid: Grid, dt: number, events: CreatureEvents): void {
  const { w, h } = bodyOf(c);
  const cx = Math.floor(c.x);
  const feet = Math.floor(c.y);
  const head = feet - h + 1;

  for (const key of ["burning", "frozen", "levitate", "fear", "sleep", "calm", "stun"] as const) {
    if (c[key] > 0) c[key] = Math.max(0, c[key] - dt);
  }

  // What the body touches.
  let inWater = false;
  let headInWater = false;
  let inFire = false;
  let inLava = false;
  for (let y = head; y <= feet; y++) {
    const m = grid.get(cx, y);
    if (m === M.WATER) {
      inWater = true;
      if (y === head) headInWater = true;
    } else if (m === M.FIRE) inFire = true;
    else if (m === M.LAVA) inLava = true;
  }

  if (!c.dead) {
    if (inLava) {
      c.hp -= 70 * dt;
      c.burning = Math.max(c.burning, 4);
    }
    if (inFire && c.type !== "spirit" && c.type !== "golem") c.burning = Math.max(c.burning, 3);
    if (inWater) c.burning = 0;
    if (c.burning > 0) {
      c.hp -= 9 * dt;
      c.sleep = 0;
      if (Math.random() < 0.4) events.emit(c.x, head - 1, Math.random() < 0.5 ? 0xffb000 : 0xff6a00, 0, -6, 0.4);
      if (Math.random() < 0.02) grid.ignite(cx, feet);
    }
    if (c.sleep > 0 && Math.random() < 0.03) events.emit(c.x + 1, head - 1, 0xffffff, 1.5, -3, 1);
    if (headInWater && c.type !== "spirit" && c.type !== "golem") {
      c.breath -= dt;
      if (c.breath < 0) c.hp -= 12 * dt;
    } else c.breath = Math.min(6, c.breath + dt * 2);
    if (c.hp <= 0) {
      c.dead = true;
      c.burning = 0;
      c.levitate = 0;
    }
  }

  const supported = grid.solid(cx, feet + 1) || grid.solid(cx - (w >> 1), feet + 1) || grid.solid(cx + ((w - 1) >> 1), feet + 1);
  const flying = c.type === "spirit" && !c.dead;

  if (c.dead || c.frozen > 0) {
    c.vx *= supported ? 0.5 : 0.98;
  } else if (c.levitate > 0) {
    c.vy = -5;
    c.vx *= 0.9;
  } else if (flying) {
    const hover = grid.groundY(cx) - 8;
    c.vy += (hover - c.y) * 0.8 * dt * 10;
    c.vy *= 0.9;
    wander(c, dt);
    c.vx = c.dir * BODY.spirit.speed * (c.fear > 0 ? 2.2 : 1);
    if (c.fear > 0) c.dir = c.x < c.fearX ? -1 : 1;
  } else if (supported && c.stun <= 0) {
    walk(c, grid, dt, w, h);
  } else if (supported) {
    c.vx *= 0.7;
  }

  // Gravity and water.
  if (!flying && c.levitate <= 0) {
    if (inWater && c.type !== "golem" && !c.dead) {
      c.vy = Math.max(-4, c.vy - 40 * dt);
      c.vx *= 0.9;
    } else if (!supported) {
      c.vy = Math.min(MAX_FALL, c.vy + GRAVITY * dt);
    }
  }

  move(c, grid, dt, w, h);
  c.anim += Math.abs(c.vx) * dt;
}

function wander(c: Creature, dt: number): void {
  c.plan -= dt;
  if (c.plan < 0) {
    c.plan = 1 + Math.random() * 4;
    if (Math.random() < 0.5) c.dir = -c.dir;
  }
}

function walk(c: Creature, grid: Grid, dt: number, w: number, h: number): void {
  if (c.sleep > 0 || c.calm > 0) {
    c.vx = 0;
    return;
  }
  const fleeing = c.fear > 0 || c.burning > 0;
  if (c.fear > 0) c.dir = c.x < c.fearX ? -1 : 1;
  else if (c.burning > 0 && Math.random() < 0.05) c.dir = -c.dir;

  let resting = false;
  if (!fleeing) {
    c.plan -= dt;
    if (c.plan < 0) {
      c.plan = 1 + Math.random() * 5;
      if (Math.random() < 0.5) c.dir = -c.dir;
    }
    resting = c.plan < 1.2;
  }
  if (resting) {
    c.vx = 0;
    return;
  }

  const feet = Math.floor(c.y);
  const ahead = Math.floor(c.x + c.dir * (w / 2 + 0.6));
  // Climb steps of up to two cells if there is room for the body.
  if (grid.solid(ahead, feet)) {
    let climbed = false;
    for (let step = 1; step <= 2 && !climbed; step++) {
      if (grid.solid(ahead, feet - step)) continue;
      let free = true;
      for (let y = feet - step - h + 1; y < feet - step; y++) if (grid.solid(ahead, y)) free = false;
      if (free) {
        c.y -= step;
        climbed = true;
      }
    }
    if (!climbed) {
      c.dir = -c.dir;
      c.vx = 0;
      return;
    }
  }
  if (!fleeing) {
    // Avoid fire, lava, deep drops and the pond.
    const below = grid.get(ahead, feet + 1);
    const danger = [grid.get(ahead, feet), below].some((m) => m === M.FIRE || m === M.LAVA);
    let drop = 0;
    while (drop < 6 && !grid.solid(ahead, feet + 1 + drop)) drop++;
    if (danger || drop >= 6 || below === M.WATER) {
      c.dir = -c.dir;
      c.vx = 0;
      return;
    }
  }
  const speed = BODY[c.type].speed * Math.sqrt(c.size) * (fleeing ? 2.2 : 1);
  c.vx = c.dir * speed;
}

function move(c: Creature, grid: Grid, dt: number, w: number, h: number): void {
  // Horizontal, blocked by walls at chest height.
  const nx = c.x + c.vx * dt;
  const edge = Math.floor(nx + Math.sign(c.vx) * (w / 2));
  const chest = Math.floor(c.y) - Math.max(1, h >> 1);
  if (c.vx !== 0 && grid.solid(edge, chest)) c.vx = 0;
  else c.x = nx;
  c.x = Math.min(grid.w - 2, Math.max(1, c.x));

  // Vertical, one cell at a time so fast falls do not tunnel through floors.
  let remaining = c.vy * dt;
  while (Math.abs(remaining) > 1e-6) {
    const step = Math.max(-1, Math.min(1, remaining));
    const ny = c.y + step;
    const cx = Math.floor(c.x);
    if (step > 0 && grid.solid(cx, Math.floor(ny))) {
      c.y = Math.floor(ny) - 0.001;
      land(c);
      break;
    }
    if (step < 0 && grid.solid(cx, Math.floor(ny) - h + 1)) {
      c.vy = 0;
      break;
    }
    c.y = ny;
    remaining -= step;
  }

  // Buried by a spell: climb out, or suffer.
  let pushes = 0;
  while (grid.solid(Math.floor(c.x), Math.floor(c.y)) && pushes < 3) {
    c.y -= 1;
    pushes++;
  }
  if (pushes === 3 && grid.solid(Math.floor(c.x), Math.floor(c.y))) c.hp -= 25 * dt;

  if (c.y < h) c.y = h;
  if (c.y > grid.h + 5) {
    c.dead = true;
    c.y = grid.h - 1;
  }
}

function land(c: Creature): void {
  if (c.vy > 30 && !c.dead) c.hp -= (c.vy - 30) * 4;
  c.vy = 0;
}
