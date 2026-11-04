import { C, F, G, S } from "./materials";
import type { World } from "./world";
import { addGas } from "./cells";
import { igniteVoxels, stepVoxels } from "./voxels";
import { WARD, stepWards, wardHit, warded } from "./wards";

// The rules of the land. Spells set them in motion; these keep them going:
// water runs downhill and freezes, fire spreads with the wind and leaves ash,
// lava hardens into basalt, steam rises and rains back down.

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

let flowDelta = new Float32Array(0);
let flowType = new Uint8Array(0);
let gasNext = new Float32Array(0);
let gasTypeNext = new Uint8Array(0);
let tempNext = new Float32Array(0);
const windAcc = { x: 0, y: 0 };

export function stepPhysics(world: World, dt: number): void {
  if (flowDelta.length !== world.n) {
    flowDelta = new Float32Array(world.n);
    flowType = new Uint8Array(world.n);
    gasNext = new Float32Array(world.n);
    gasTypeNext = new Uint8Array(world.n);
    tempNext = new Float32Array(world.n);
  }
  stepWards(world);
  stepFluids(world, dt);
  stepFire(world, dt);
  // Every other tick each, on alternate ticks: together on the same tick they
  // made every second tick three times as long as the others (seen on a phone).
  if (world.tick % 2 === 0) stepTemperature(world, dt * 2);
  else stepGas(world, dt * 2);
  stepGrowth(world);
  stepVoxels(world, dt);
}

function stepFluids(world: World, dt: number): void {
  const { w, h, height, depth, fluid, materials, rng } = world;
  flowDelta.fill(0);
  flowType.fill(0);
  const diffs = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const f = fluid[i];
      if (f === F.NONE || depth[i] < 0.0005) continue;
      const m = materials.get("fluid", f);
      fluidSurface(world, i, f, x, y, dt);
      if (m.flow <= 0 || fluid[i] !== f) continue;
      const level = height[i] + depth[i];
      let total = 0;
      for (let k = 0; k < 4; k++) {
        diffs[k] = 0;
        const nx = x + N4[k][0];
        const ny = y + N4[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const g = fluid[j];
        if (g !== F.NONE && g !== f && depth[j] > 0.0005) {
          react(world, i, j);
          continue;
        }
        // A ward against fluids is a wall: nothing flows in from outside.
        if (warded(world, j, WARD.fluids) && !warded(world, i, WARD.fluids)) {
          if (rng.next() < 0.01) wardHit(world, j);
          continue;
        }
        const d = level - (height[j] + depth[j]);
        if (d > 0) {
          diffs[k] = d;
          total += d;
        }
      }
      if (total <= 0) continue;
      const amount = Math.min(depth[i] + flowDelta[i], total * 0.24 * m.flow);
      if (amount <= 0) continue;
      flowDelta[i] -= amount;
      for (let k = 0; k < 4; k++) {
        if (diffs[k] <= 0) continue;
        const j = (y + N4[k][1]) * w + x + N4[k][0];
        flowDelta[j] += (amount * diffs[k]) / total;
        if (fluid[j] === F.NONE) flowType[j] = f;
      }
    }
  }
  for (let i = 0; i < world.n; i++) {
    const delta = flowDelta[i];
    if (delta === 0) continue;
    depth[i] = Math.max(0, depth[i] + delta);
    if (fluid[i] === F.NONE && flowType[i]) fluid[i] = flowType[i];
    if (depth[i] < 0.0005) {
      depth[i] = 0;
      fluid[i] = F.NONE;
    }
  }
}

// What a fluid does where it lies: lava burns and hardens, acid eats, mud
// dries, shallow water soaks into the ground above the sea.
function fluidSurface(world: World, i: number, f: number, x: number, y: number, dt: number): void {
  const { depth, rng } = world;
  if (f === F.WATER) {
    if (world.height[i] > world.seaLevel) depth[i] -= 0.004 * dt;
    if (world.fire[i] > 0) world.fire[i] = 0;
    if (world.cover[i] === C.CROP || world.cover[i] === C.FLOWER) {
      if (depth[i] > 0.6) world.setCover(i, C.NONE);
    }
  } else if (f === F.LAVA) {
    world.temp[i] = 1100;
    if (world.cover[i] !== C.NONE) {
      world.fire[i] = 1;
      if (rng.next() < dt * 2) world.setCover(i, C.NONE);
    }
    if (world.ground[i] === G.GRASS || world.ground[i] === G.FIELD) world.ground[i] = G.ASH;
    // Spread heat and fire to the banks.
    if (rng.next() < dt * 3) {
      const [dx, dy] = N8[(rng.next() * 8) | 0];
      if (world.inside(x + dx, y + dy)) {
        const j = (y + dy) * world.w + x + dx;
        if (!warded(world, j, WARD.fire) && (world.materials.get("cover", world.cover[j]).flammable > 0 || world.ground[j] === G.GRASS))
          world.fire[j] = Math.max(world.fire[j], 0.5);
      }
    }
    const thin = depth[i] < 0.25 ? 0.5 : 0;
    if (rng.next() < dt * (0.02 + thin)) {
      world.height[i] += depth[i] * 0.9;
      world.ground[i] = G.BASALT;
      world.setFluid(i, F.NONE, 0);
      world.temp[i] = 300;
    }
  } else if (f === F.ACID) {
    if (world.cover[i] !== C.NONE && world.cover[i] !== C.BOULDER) {
      world.coverHp[i] -= dt * 4;
      if (world.coverHp[i] <= 0 || rng.next() < dt) {
        world.setCover(i, C.NONE);
        addGas(world, i, S.POISON, 0.2);
      }
    }
    if (world.ground[i] === G.GRASS || world.ground[i] === G.FIELD) world.ground[i] = G.DIRT;
    world.height[i] -= dt * 0.04 * Math.min(1, depth[i]);
    depth[i] -= dt * 0.012;
  } else if (f === F.MUD) {
    if (world.temp[i] > 5 && rng.next() < dt * 0.02) {
      world.height[i] += depth[i] * 0.8;
      world.ground[i] = G.DIRT;
      world.setFluid(i, F.NONE, 0);
    }
  } else if (f === F.OIL) {
    if (world.fire[i] > 0) depth[i] -= dt * 0.05;
  }
}

// Two different fluids touch.
function react(world: World, i: number, j: number): void {
  const a = world.fluid[i];
  const b = world.fluid[j];
  const pair = (p: number, q: number) => (a === p && b === q) || (a === q && b === p);
  const lava = a === F.LAVA ? i : j;
  const other = a === F.LAVA ? j : i;
  if (pair(F.LAVA, F.WATER)) {
    // Lava meeting water: the lava turns to basalt, the water hisses into steam.
    world.height[lava] += world.depth[lava] * 0.9;
    world.ground[lava] = G.BASALT;
    world.setFluid(lava, F.NONE, 0);
    world.depth[other] = Math.max(0, world.depth[other] - 0.05);
    addGas(world, other, S.STEAM, 0.5);
  } else if (pair(F.LAVA, F.ICE)) {
    world.fluid[other] = F.WATER;
    addGas(world, other, S.STEAM, 0.3);
  } else if (pair(F.LAVA, F.OIL)) {
    world.fire[other] = 1;
  } else if (pair(F.ACID, F.WATER)) {
    // Water dilutes acid.
    const acid = a === F.ACID ? i : j;
    world.depth[acid] *= 0.98;
    if (world.depth[acid] < 0.05 || world.rng.next() < 0.02) world.fluid[acid] = F.WATER;
  } else if (pair(F.MUD, F.WATER)) {
    const mud = a === F.MUD ? i : j;
    if (world.rng.next() < 0.01) world.fluid[mud] = F.WATER;
  }
}

function stepFire(world: World, dt: number): void {
  const { w, h, fire, cover, coverHp, materials, rng, wind } = world;
  for (let i = 0; i < world.n; i++) {
    const f = fire[i];
    if (f <= 0) continue;
    if (warded(world, i, WARD.fire)) {
      fire[i] = 0;
      continue;
    }
    const fl = world.fluid[i];
    if ((fl === F.WATER || fl === F.ICE || fl === F.MUD) && world.depth[i] > 0.05) {
      fire[i] = 0;
      addGas(world, i, S.STEAM, 0.2);
      continue;
    }
    if (world.ground[i] === G.SNOW) {
      fire[i] = 0;
      world.ground[i] = G.DIRT;
      continue;
    }
    const coverMat = materials.get("cover", cover[i]);
    const groundMat = materials.get("ground", world.ground[i]);
    let burning = false;
    if (cover[i] !== C.NONE && coverMat.flammable > 0) {
      burning = true;
      coverHp[i] -= dt * (0.5 + f);
      if (coverHp[i] <= 0) burnOut(world, i);
    } else if (fl === F.OIL && world.depth[i] > 0.01) {
      burning = true;
      world.depth[i] -= dt * 0.06;
      if (world.depth[i] <= 0.01) world.setFluid(i, F.NONE, 0);
    } else if (groundMat.flammable > 0) {
      burning = true;
      if (rng.next() < dt * 0.6) world.ground[i] = G.ASH;
    }
    if (!burning) {
      fire[i] = f - dt * 2.5;
      if (fire[i] < 0.02) fire[i] = 0;
      continue;
    }
    fire[i] = Math.min(1, f + dt * 1.2);
    world.temp[i] = Math.max(world.temp[i], 350 * fire[i]);
    addGas(world, i, S.SMOKE, dt * 0.6);
    if (rng.next() < dt * 4) {
      world.particles.add({
        x: (i % w) + rng.next(),
        y: Math.floor(i / w) + rng.next(),
        z: 0.5,
        vz: 3 + rng.next() * 3,
        vx: wind.x * 2,
        vy: wind.y * 2,
        life: 0.8,
        color: rng.next() < 0.5 ? 0xffb03a : 0xff6a1a,
        size: 0.5,
        glow: true,
        gravity: -1,
      });
    }
    // Catch the neighbors, more easily downwind.
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + N8[k][0];
      const ny = y + N8[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (fire[j] > 0) continue;
      if (warded(world, j, WARD.fire)) {
        if (rng.next() < 0.02) wardHit(world, j);
        continue;
      }
      const flam = Math.max(
        cover[j] !== C.NONE ? materials.get("cover", cover[j]).flammable : 0,
        materials.get("ground", world.ground[j]).flammable,
        world.fluid[j] === F.OIL ? 1 : 0,
      );
      if (flam <= 0 || (world.fluid[j] === F.WATER && world.depth[j] > 0.05)) continue;
      const downwind = 1 + (N8[k][0] * wind.x + N8[k][1] * wind.y) * 0.8;
      const diag = k >= 4 ? 0.6 : 1;
      if (rng.next() < f * flam * dt * 1.6 * downwind * diag) fire[j] = 0.3;
    }
  }
}

// A cover has burned through.
function burnOut(world: World, i: number): void {
  const c = world.cover[i];
  if (c === C.TREE) world.setCover(i, C.STUMP);
  else if (c === C.HOUSE) world.setCover(i, C.RUBBLE);
  else if (c === C.POWDER) {
    world.setCover(i, C.NONE);
    explode(world, i % world.w, Math.floor(i / world.w), 3.5, 0.7);
  } else world.setCover(i, C.NONE);
  if (world.ground[i] === G.GRASS || world.ground[i] === G.FIELD) world.ground[i] = G.ASH;
}

function stepTemperature(world: World, dt: number): void {
  const { w, h, temp, materials, rng } = world;
  // The tables themselves, read by id: materials.get looked its layer up by
  // name for every cell, three times (4.3, paid for the steering).
  const fluids = materials.list.fluid;
  const grounds = materials.list.ground;
  const covers = materials.list.cover;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = temp[i];
      const avg = (temp[x > 0 ? i - 1 : i] + temp[x < w - 1 ? i + 1 : i] + temp[y > 0 ? i - w : i] + temp[y < h - 1 ? i + w : i]) * 0.25;
      let target = world.ambient(i);
      let pull = 0.03;
      const fl = world.fluid[i];
      if (fl !== F.NONE && world.depth[i] > 0.05) {
        const heat = (fluids[fl] ?? fluids[0]).heat;
        if (heat !== null) {
          target = heat;
          pull = 0.3;
        }
      }
      const groundHeat = (grounds[world.ground[i]] ?? grounds[0]).heat;
      if (groundHeat !== null && pull < 0.3) {
        target = Math.min(target, groundHeat);
        pull = 0.08;
      }
      const coverHeat = (covers[world.cover[i]] ?? covers[0]).heat;
      if (coverHeat !== null) {
        target = coverHeat;
        pull = 0.2;
      }
      if (world.fire[i] > 0) {
        target = Math.max(target, 500 * world.fire[i]);
        pull = 0.2;
      }
      let next = t + (avg - t) * 0.3 + (target - t) * pull * dt * 10;
      const ward = world.wardMask[i];
      if (ward & WARD.fire) next = Math.min(next, 60);
      if (ward & WARD.cold) next = Math.max(next, 4);
      tempNext[i] = next;
    }
  }
  temp.set(tempNext);

  // Phase changes.
  for (let i = 0; i < world.n; i++) {
    const t = temp[i];
    const fl = world.fluid[i];
    if (fl === F.WATER) {
      if (t < 0) world.fluid[i] = F.ICE;
      else if (t > 100) {
        world.depth[i] -= 0.03 * dt;
        addGas(world, i, S.STEAM, 0.2 * dt);
        if (world.depth[i] <= 0) world.setFluid(i, F.NONE, 0);
      }
    } else if (fl === F.ICE && t > 1) world.fluid[i] = F.WATER;
    const g = world.ground[i];
    if (g === G.SNOW && t > 2 && rng.next() < dt * 0.3) {
      world.ground[i] = G.GRASS;
      world.place(i, "water", 0.12);
    } else if ((g === G.GRASS || g === G.DIRT || g === G.FIELD) && t < -6 && world.depth[i] === 0 && rng.next() < dt * 0.4) {
      world.ground[i] = G.SNOW;
    }
    if (t > 280 && world.fire[i] === 0 && !warded(world, i, WARD.fire)) {
      const flam = Math.max(materials.get("cover", world.cover[i]).flammable, materials.get("ground", world.ground[i]).flammable);
      if (flam > 0) world.fire[i] = 0.4;
    }
  }
}

function stepGas(world: World, dt: number): void {
  const { w, h, gas, gasAmt, wind } = world;
  windAcc.x += wind.x * dt;
  windAcc.y += wind.y * dt;
  const sx = Math.trunc(windAcc.x);
  const sy = Math.trunc(windAcc.y);
  windAcc.x -= sx;
  windAcc.y -= sy;
  gasNext.fill(0);
  gasTypeNext.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Each cell takes its gas from upwind, blurred a little.
      const ux = x - sx;
      const uy = y - sy;
      if (ux < 1 || uy < 1 || ux >= w - 1 || uy >= h - 1) continue;
      const s = uy * w + ux;
      const around = gasAmt[s - 1] + gasAmt[s + 1] + gasAmt[s - w] + gasAmt[s + w];
      const amount = gasAmt[s] * 0.6 + around * 0.1;
      if (amount < 0.004) continue;
      let type = gas[s];
      if (type === S.NONE) {
        let best = 0;
        for (const j of [s - 1, s + 1, s - w, s + w]) {
          if (gasAmt[j] > best) {
            best = gasAmt[j];
            type = gas[j];
          }
        }
      }
      const i = y * w + x;
      // Poison does not drift into a ward against harm.
      if (type === S.POISON && warded(world, i, WARD.harm) && !warded(world, s, WARD.harm)) continue;
      const decay = type === S.SMOKE ? 0.985 : type === S.STEAM ? 0.99 : 0.992;
      gasNext[i] = Math.min(1, amount * decay);
      gasTypeNext[i] = type;
    }
  }
  gasAmt.set(gasNext);
  gas.set(gasTypeNext);
  // Thick steam condenses into rain.
  for (let i = 0; i < world.n; i++) {
    if (gas[i] === S.STEAM && gasAmt[i] > 0.5 && world.temp[i] < 90 && world.rng.next() < 0.05) {
      gasAmt[i] -= 0.25;
      world.place(i, "water", 0.08);
    }
  }
}

// Life comes back slowly: grass creeps over bare dirt, forests reseed, ash
// turns to soil, fields sprout crops.
function stepGrowth(world: World): void {
  const { w, rng, ground, cover } = world;
  const samples = Math.ceil(world.n / 250);
  for (let k = 0; k < samples; k++) {
    const i = (rng.next() * world.n) | 0;
    if (world.depth[i] > 0.02 || world.fire[i] > 0) continue;
    const t = world.temp[i];
    if (t < 2 || t > 45) continue;
    const g = ground[i];
    const j = neighbor(world, i);
    if (g === G.DIRT && cover[i] !== C.HOUSE && ground[j] === G.GRASS && rng.next() < 0.5) ground[i] = G.GRASS;
    else if (g === G.ASH && rng.next() < 0.08) ground[i] = G.DIRT;
    else if (g === G.GRASS && cover[i] === C.NONE) {
      if (cover[j] === C.TREE && rng.next() < 0.04) world.setCover(i, C.TREE);
      else if (rng.next() < 0.002) world.setCover(i, rng.next() < 0.5 ? C.FLOWER : C.BUSH);
    } else if (cover[i] === C.STUMP && rng.next() < 0.01) world.setCover(i, C.TREE);
    else if (g === G.FIELD && cover[i] === C.NONE && rng.next() < 0.1) world.setCover(i, C.CROP);
    void w;
  }
}

function neighbor(world: World, i: number): number {
  const [dx, dy] = N4[(world.rng.next() * 4) | 0];
  const x = (i % world.w) + dx;
  const y = Math.floor(i / world.w) + dy;
  return world.inside(x, y) ? y * world.w + x : i;
}

// A blast: a crater, flattened houses, fire, and creatures thrown away.
// power around 1 is a big bomb; more digs deeper and throws further.
export function explode(world: World, x: number, y: number, r: number, power: number): void {
  const { w, rng } = world;
  let blocked = false;
  forDisc(world, x, y, r, (i, k) => {
    // A ward against harm shrugs off the blast: the land and houses inside stay.
    if (warded(world, i, WARD.harm)) {
      blocked = true;
      return;
    }
    world.height[i] -= power * 2.2 * k * k;
    if (k > 0.25) {
      const c = world.cover[i];
      if (c === C.POWDER) world.fire[i] = 1;
      else if (c === C.HOUSE) world.setCover(i, C.RUBBLE);
      else if (c !== C.NONE && c !== C.RUBBLE) world.setCover(i, rng.next() < 0.4 ? C.RUBBLE : C.NONE);
    }
    if (k > 0.55) world.ground[i] = G.ASH;
    else if (world.ground[i] === G.GRASS && k > 0.3) world.ground[i] = G.DIRT;
    if (world.depth[i] > 0) {
      world.depth[i] *= 1 - k * 0.8;
      if (world.fluid[i] === F.WATER) addGas(world, i, S.STEAM, 0.3 * k);
    }
    if (rng.next() < 0.35 * power * k) world.fire[i] = Math.max(world.fire[i], 0.6);
    world.temp[i] += 400 * k * power;
    addGas(world, i, S.SMOKE, 0.6 * k);
  });
  for (const c of world.creatures) {
    if (c.dead && c.z <= 0) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    const d = Math.hypot(dx, dy);
    const reach = r * 1.4;
    if (d > reach) continue;
    if (shielded(world, c.x, c.y)) continue;
    const f = 1 - d / reach;
    c.hp -= 140 * power * f;
    c.vx += (dx / (d || 1)) * 30 * f * power;
    c.vy += (dy / (d || 1)) * 30 * f * power;
    c.vz += 14 * f * power;
    c.z = Math.max(c.z, 0.1);
    if (f > 0.5) c.burning = Math.max(c.burning, 2);
    c.stun = Math.max(c.stun, 1);
  }
  // Debris and a fireball.
  const count = Math.min(400, 40 + r * r * 2);
  for (let k = 0; k < count; k++) {
    const a = rng.next() * Math.PI * 2;
    const sp = rng.next() * r * 3 * Math.sqrt(power);
    const hot = k % 3 === 0;
    world.particles.add({
      x: x + Math.cos(a) * rng.next() * r * 0.3,
      y: y + Math.sin(a) * rng.next() * r * 0.3,
      z: 0.5,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      vz: 6 + rng.next() * 14 * power,
      life: 0.8 + rng.next() * 1.2,
      color: hot ? [0xfff2b0, 0xffb03a, 0xff6a1a][k % 3] : [0x6b5a48, 0x8a7a6a, 0x4a4038][k % 3],
      size: hot ? 1.2 : 0.7,
      glow: hot,
      gravity: hot ? 4 : 22,
      drag: hot ? 1.5 : 0.3,
    });
  }
  // Blasts blow away what spells built close by and set fire to wood further out;
  // whatever loses its support then falls.
  if (world.landmarks.length) world.landmarks = world.landmarks.filter((l) => Math.hypot(l.x - x, l.y - y) > r * 0.6 || shielded(world, l.x, l.y));
  if (world.decor.size) {
    if (!blocked) world.clearVoxels(x, y, r * 0.6);
    igniteVoxels(world, x, y, r * (0.6 + 0.4 * Math.min(1, power)));
  }
  if (blocked) wardHit(world, Math.round(y) * world.w + Math.round(x));
  world.emit({ kind: "sound", name: "boom", size: Math.min(1, r / 30) });
  world.emit({ kind: "shake", amount: Math.min(14, 2 + r * 0.4 * power), seconds: 0.6 });
  world.emit({ kind: "flash", color: 0xfff0c0, strength: Math.min(0.8, 0.2 + r / 60) });
  void w;
}

// One jolt of an earthquake. Call it repeatedly for a lasting quake.
export function quake(world: World, x: number, y: number, r: number, strength: number): void {
  const { rng } = world;
  forDisc(world, x, y, r, (i, k) => {
    if (warded(world, i, WARD.harm)) return;
    if (rng.next() < 0.3) world.height[i] += (rng.next() - 0.5) * strength * 0.8 * k;
    const c = world.cover[i];
    if (c === C.HOUSE && rng.next() < strength * k * 0.08) world.setCover(i, C.RUBBLE);
    else if (c === C.TREE && rng.next() < strength * k * 0.03) world.setCover(i, C.STUMP);
  });
  for (const c of world.creatures) {
    if (c.dead || Math.hypot(c.x - x, c.y - y) > r || shielded(world, c.x, c.y)) continue;
    if (rng.next() < strength * 0.3) {
      c.stun = Math.max(c.stun, 0.4);
      c.vz += 3 + rng.next() * 4 * strength;
    }
  }
}

// A creature standing under a ward against harm.
function shielded(world: World, x: number, y: number): boolean {
  const cx = Math.max(0, Math.min(world.w - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(world.h - 1, Math.round(y)));
  return warded(world, cy * world.w + cx, WARD.harm);
}

// Visits every cell in a disc. k is 1 at the center and 0 at the rim.
export function forDisc(world: World, x: number, y: number, r: number, fn: (i: number, k: number, cx: number, cy: number) => void): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(x - r));
  const x1 = Math.min(world.w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r));
  const y1 = Math.min(world.h - 1, Math.ceil(y + r));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      if (d2 > r2) continue;
      fn(cy * world.w + cx, 1 - Math.sqrt(d2) / (r || 1), cx, cy);
    }
  }
}
