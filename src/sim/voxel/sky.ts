import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type CanvasTexture,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from "three";
import { DAY_LENGTH, MOON_DAYS, dayOf } from "../daylight";
import { LOOKS, biomeAt, type Weather } from "../land";
import { fallingAt } from "../weather";
import { seeded } from "../noise";
import type { World } from "../world";
import { DROP_SHADER, dropShare } from "./drops";
import { GRAPHICS } from "./graphics";

// The sky of 4.4: a sun and a moon that cross it with the day, stars at
// night, and weather you can see (rain, snow, fog) that comes and goes. All
// of it is the view's: the simulation never knows it rains, so a challenge
// or a spell's test run plays the same under any sky. The weather is a
// function of the island's seed and the time, so it needs no saving and two
// devices with the same island see the same sky.

// One spell of weather lasts this long, easing in and out.
const SPELL = 120;

export interface WeatherNow {
  kind: Weather;
  // 0 to 1.
  amount: number;
}

// The weather on an island at a time. Islands from before 4.4, challenges
// and the Spell Lab (no land) have none.
// The Perf Lab can hold one weather, to measure and look at it.
export const LAB_WEATHER: { now: WeatherNow | null } = { now: null };
// For frames of the checks (scripts/ground-frames.mjs): a time of day held for
// the light and the clouds, and a storm cloud held over a spot. The drawing
// only: the simulation keeps its own clock and its own fronts.
export const LAB_SKY: { time: number | null; front: { x: number; y: number; r: number } | null } = { time: null, front: null };

// On a mixed island (4.4.1), the weather of the region at `cell`.
export function weatherAt(world: World, time: number, cell = -1): WeatherNow {
  if (LAB_WEATHER.now) return LAB_WEATHER.now;
  if (!world.land) return { kind: "clear", amount: 0 };
  // Rain and snow are fronts that cross the island (weather.ts): what falls here is what is
  // overhead, wherever the camera looks from. Fog alone stays a region's own.
  const at = cell >= 0 && cell < world.n ? cell : Math.floor(world.h / 2) * world.w + Math.floor(world.w / 2);
  const falling = fallingAt(world, at % world.w, Math.floor(at / world.w), time);
  if (falling.amount > 0) return falling;
  const odds = LOOKS[cell >= 0 && cell < world.n ? biomeAt(world, cell) : world.land.biome].weather;
  const spell = Math.floor(time / SPELL);
  const roll = seeded((world.seed * 7919 + spell * 104729 + 17) >>> 0)();
  const kind: Weather = roll < (odds.fog ?? 0) ? "fog" : "clear";
  if (kind === "clear") return { kind, amount: 0 };
  const f = (time % SPELL) / SPELL;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const amount = f < 0.2 ? ease(f / 0.2) : f > 0.8 ? ease((1 - f) / 0.2) : 1;
  return { kind, amount };
}

// Where the sun and the moon are, from the day cycle (daylight.ts): the sun
// rises at dawn (0.95 of the day) and sets at dusk (0.72); the moon crosses
// the night between. Height 0 at the horizon, 1 overhead.
export function skyBodies(time: number): { sun: number; sunAz: number; moon: number; moonAz: number } {
  const f = ((((time + DAY_LENGTH * 0.1) % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
  const day = (((f - 0.95 + 1) % 1) / 0.77) as number;
  const night = (f - 0.72) / 0.23;
  return {
    sun: day <= 1 ? Math.sin(Math.PI * day) : -0.2,
    sunAz: Math.PI * Math.min(1, day),
    moon: night >= 0 && night <= 1 ? Math.sin(Math.PI * night) : -0.2,
    moonAz: Math.PI * Math.min(1, Math.max(0, night)),
  };
}

const FAR = 1500;
const DIR = new Vector3();
const STARS = 700;
// Enough for the tile of drops.ts to be as thick close up as the old box
// was (2400 in a box of 30); far out a ninth of them show, as before.
const DROPS = 21600;

export class Sky {
  // Named so the glow mask (looks.ts) leaves the sun, moon and stars out of the bloom.
  private group = Object.assign(new Group(), { name: "sky" });
  private sun: Sprite;
  private moon: Sprite;
  private stars: Points;
  private drops: Points;
  private dropMaterial: ShaderMaterial;
  private starMaterial: ShaderMaterial;
  weather: WeatherNow = { kind: "clear", amount: 0 };
  private lastTime = 0;

  constructor(
    private scene: Scene,
    private world: World,
    glow: CanvasTexture,
  ) {
    const disc = (color: number, opacity: number) =>
      new Sprite(new SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, fog: false, blending: AdditiveBlending }));
    this.sun = disc(0xfff2c8, 1);
    this.sun.scale.setScalar(FAR * 0.1);
    this.moon = disc(0xdfe8ff, 0.9);
    this.moon.scale.setScalar(FAR * 0.055);
    // Stars on the upper half of a sphere, fixed for the island.
    const rand = seeded(world.seed ^ 0x5eed);
    const pos = new Float32Array(STARS * 3);
    const bright = new Float32Array(STARS);
    for (let k = 0; k < STARS; k++) {
      const a = rand() * Math.PI * 2;
      // More stars low in the sky: the camera sees only the first few
      // degrees above the horizon.
      const h = 0.01 + rand() ** 2.5 * 0.99;
      const r = Math.sqrt(1 - h * h);
      pos.set([Math.cos(a) * r * FAR, h * FAR, Math.sin(a) * r * FAR], k * 3);
      bright[k] = 0.4 + rand() * 0.6;
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute("position", new BufferAttribute(pos, 3));
    starGeometry.setAttribute("bright", new BufferAttribute(bright, 1));
    this.starMaterial = new ShaderMaterial({
      uniforms: { night: { value: 0 } },
      vertexShader: `attribute float bright; varying float vBright;
        void main() { vBright = bright; gl_PointSize = 1.5 + bright * 1.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float night; varying float vBright;
        void main() { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vec4(vec3(1.0), night * vBright); }`,
      transparent: true,
      depthWrite: false,
    });
    this.stars = new Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    // Rain and snow: points fixed over the island (drops.ts), falling in
    // the vertex shader, so a frame costs nothing on the CPU.
    const drop = new Float32Array(DROPS * 3);
    for (let k = 0; k < DROPS * 3; k++) drop[k] = rand();
    const rank = new Float32Array(DROPS);
    for (let k = 0; k < DROPS; k++) rank[k] = rand();
    const dropGeometry = new BufferGeometry();
    dropGeometry.setAttribute("position", new BufferAttribute(drop, 3));
    dropGeometry.setAttribute("rank", new BufferAttribute(rank, 1));
    this.dropMaterial = new ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        center: { value: [0, 0, 0] },
        share: { value: 0 },
        snow: { value: 0 },
        tint: { value: new Color(0xffffff) },
        pixels: { value: 1 },
        nearest: { value: 0 },
        grain: { value: 1 },
      },
      vertexShader: DROP_SHADER,
      fragmentShader: `uniform float snow; uniform vec3 tint; varying float vShow;
        void main() {
          if (vShow < 0.5) discard;
          vec2 d = gl_PointCoord - 0.5;
          float a = snow > 0.5 ? 1.0 - smoothstep(0.15, 0.25, length(d)) : (1.0 - smoothstep(0.04, 0.1, abs(d.x))) * (1.0 - smoothstep(0.25, 0.5, abs(d.y)));
          if (a < 0.02) discard;
          gl_FragColor = vec4(tint, a * mix(0.6, 0.9, snow));
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.drops = new Points(dropGeometry, this.dropMaterial);
    this.drops.frustumCulled = false;
    // After the water (terrain.ts draws it at 2): drops write no depth, so
    // water drawn after them covered the ones in front of it (4.4.5, seen
    // by the owner: rain behind the sea).
    this.drops.renderOrder = 4;
    this.drops.visible = false;
    this.group.add(this.sun, this.moon, this.stars);
    scene.add(this.group, this.drops);
  }

  // Drops nearer the camera than this are not drawn (the eye view, eyes.ts).
  dropsFrom = 0;

  // Places the sky around the camera; the rain and snow stay over the
  // island and are drawn around the camera's target.
  // `night` is daylight's (0 to 1); `target` in scene units.
  update(time: number, night: number, camera: PerspectiveCamera, target: { x: number; y: number; z: number }, dist: number, pixels: number): void {
    // The weather of the region the camera looks at; moving to another
    // region, the old weather eases out before the new one eases in.
    const w = this.world;
    const cx = Math.round(target.x + w.w / 2);
    const cy = Math.round(target.z + w.h / 2);
    const cell = cx >= 0 && cy >= 0 && cx < w.w && cy < w.h ? cy * w.w + cx : -1;
    const under = GRAPHICS.weather ? weatherAt(w, time, cell) : { kind: "clear" as const, amount: 0 };
    // From afar a front is its cloud over part of the island (view.ts); the grey sky, the mist and
    // the drops are for those under it. Full up close, gone from where the whole island is seen.
    const side = Math.max(w.w, w.h);
    const close = under.kind === "fog" ? 1 : Math.max(0, Math.min(1, (side * 0.95 - dist) / (side * 0.45)));
    const goal = { kind: under.kind, amount: under.amount * close };
    const dt = Math.min(0.25, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const now = this.weather;
    if (goal.kind === now.kind || now.amount <= 0.01) {
      const kind = goal.kind === now.kind || goal.kind !== "clear" ? goal.kind : now.kind;
      const to = goal.kind === kind ? goal.amount : 0;
      const step = dt * 0.5;
      this.weather = { kind, amount: Math.abs(to - now.amount) <= step ? to : now.amount + Math.sign(to - now.amount) * step };
    } else this.weather = { kind: now.kind, amount: Math.max(0, now.amount - dt * 0.5) };
    if (LAB_WEATHER.now) this.weather = LAB_WEATHER.now;
    const cover = this.weather.kind === "clear" ? 0 : this.weather.amount;
    const on = GRAPHICS.sky;
    this.group.visible = on;
    if (on) {
      this.group.position.copy(camera.position);
      // Inside the camera's far plane, which follows the island's size.
      this.group.scale.setScalar((camera.far * 0.8) / FAR);
      const b = skyBodies(time);
      // A low path, at most about 20 degrees up and a little to the south.
      // The camera mostly looks down at the island and sees only the first
      // few degrees of sky, so a body is drawn no higher than the top of
      // what is on screen: turn toward it and it sits above the horizon.
      camera.getWorldDirection(DIR);
      const top = Math.asin(Math.max(-1, Math.min(1, DIR.y))) + ((camera.fov / 2) * Math.PI) / 180;
      const place = (s: Sprite, height: number, az: number) => {
        const el = Math.max(0.015, Math.min(Math.asin(Math.max(-0.2, Math.min(1, height)) * 0.35), top - 0.05));
        const hx = Math.cos(az);
        const hz = -0.6;
        const k = (Math.cos(el) * FAR * 0.9) / Math.hypot(hx, hz);
        s.position.set(hx * k, Math.sin(el) * FAR * 0.9, hz * k);
        s.visible = height > -0.05;
      };
      place(this.sun, b.sun, b.sunAz);
      place(this.moon, b.moon, b.moonAz);
      // A full moon one night in four (4.4.5 part B), bigger and warmer; a
      // thin one the night after it.
      const phase = dayOf(time) % MOON_DAYS;
      this.moon.scale.setScalar(FAR * (phase === MOON_DAYS - 1 ? 0.085 : phase === 0 ? 0.04 : 0.055));
      (this.moon.material as SpriteMaterial).color.setHex(phase === MOON_DAYS - 1 ? 0xfff2d0 : 0xdfe8ff);
      (this.sun.material as SpriteMaterial).opacity = Math.max(0, 1 - cover * 0.85);
      (this.moon.material as SpriteMaterial).opacity = 0.9 * night * (1 - cover * 0.8);
      this.starMaterial.uniforms.night.value = Math.max(0, night - 0.3) * 1.4 * (1 - cover);
      this.stars.visible = night > 0.3;
    }
    const falling = this.weather.kind === "rain" || this.weather.kind === "snow";
    this.drops.visible = falling && cover > 0.01;
    if (this.drops.visible) {
      const u = this.dropMaterial.uniforms;
      u.time.value = time;
      u.center.value = [target.x, target.y, target.z];
      u.share.value = dropShare(cover, dist);
      u.snow.value = this.weather.kind === "snow" ? 1 : 0;
      (u.tint.value as Color).setHex(this.weather.kind === "snow" ? 0xffffff : 0xb8c8dc).multiplyScalar(1 - night * 0.6);
      u.pixels.value = pixels;
      u.nearest.value = this.dropsFrom;
      // Seen from a creature's eyes the drops are close: drawn at a quarter of their size from afar.
      u.grain.value = this.dropsFrom > 0 ? 0.25 : 1;
    }
  }

  // How much the weather greys the day: 0 clear, up to about 0.3.
  get overcast(): number {
    const w = this.weather;
    return w.kind === "clear" ? 0 : w.amount * (w.kind === "fog" ? 0.18 : w.kind === "rain" ? 0.3 : 0.12);
  }

  // How much closer the fog comes: 0 clear, 1 thick.
  get fog(): number {
    const w = this.weather;
    return w.kind === "fog" ? w.amount : w.kind === "clear" ? 0 : w.amount * 0.35;
  }

  dispose(): void {
    this.scene.remove(this.group, this.drops);
    for (const o of [this.stars, this.drops]) o.geometry.dispose();
    for (const m of [this.starMaterial, this.dropMaterial, this.sun.material, this.moon.material]) m.dispose();
  }
}
