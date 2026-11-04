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
import { DAY_LENGTH } from "../daylight";
import { LOOKS, type Weather } from "../land";
import { seeded } from "../noise";
import type { World } from "../world";
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

export function weatherAt(world: World, time: number): WeatherNow {
  if (LAB_WEATHER.now) return LAB_WEATHER.now;
  if (!world.land) return { kind: "clear", amount: 0 };
  const odds = LOOKS[world.land.biome].weather;
  const spell = Math.floor(time / SPELL);
  const roll = seeded((world.seed * 7919 + spell * 104729) >>> 0)();
  let kind: Weather = "clear";
  let acc = 0;
  for (const k of ["rain", "snow", "fog"] as const) {
    acc += odds[k] ?? 0;
    if (roll < acc) {
      kind = k;
      break;
    }
  }
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
const DROPS = 2400;

export class Sky {
  private group = new Group();
  private sun: Sprite;
  private moon: Sprite;
  private stars: Points;
  private drops: Points;
  private dropMaterial: ShaderMaterial;
  private starMaterial: ShaderMaterial;
  weather: WeatherNow = { kind: "clear", amount: 0 };

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
    // Rain and snow: points in a box around the camera's target, falling in
    // the vertex shader, so a frame costs nothing on the CPU.
    const drop = new Float32Array(DROPS * 3);
    for (let k = 0; k < DROPS * 3; k++) drop[k] = rand();
    const dropGeometry = new BufferGeometry();
    dropGeometry.setAttribute("position", new BufferAttribute(drop, 3));
    this.dropMaterial = new ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        center: { value: [0, 0, 0] },
        box: { value: 60 },
        amount: { value: 0 },
        snow: { value: 0 },
        tint: { value: new Color(0xffffff) },
        pixels: { value: 1 },
      },
      vertexShader: `uniform float time; uniform vec3 center; uniform float box; uniform float amount; uniform float snow; uniform float pixels;
        varying float vShow;
        void main() {
          vec3 p = position;
          vShow = step(p.x * 0.37 + p.z * 0.63, amount);
          float fall = mix(0.9, 0.12, snow);
          p.y = fract(p.y - time * fall);
          p.x = fract(p.x + snow * 0.05 * sin(time * 0.7 + p.z * 40.0) + time * 0.02);
          vec3 w = center + vec3((p.x - 0.5) * box, (p.y - 0.25) * box * 0.6, (p.z - 0.5) * box);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          gl_PointSize = mix(16.0, 6.0, snow) * pixels * 40.0 / max(4.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
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
    this.drops.visible = false;
    this.group.add(this.sun, this.moon, this.stars);
    scene.add(this.group, this.drops);
  }

  // Places the sky around the camera and the weather around its target.
  // `night` is daylight's (0 to 1); `target` in scene units.
  update(time: number, night: number, camera: PerspectiveCamera, target: { x: number; y: number; z: number }, dist: number, pixels: number): void {
    this.weather = GRAPHICS.weather ? weatherAt(this.world, time) : { kind: "clear", amount: 0 };
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
      u.box.value = Math.min(90, Math.max(30, dist * 0.9));
      u.amount.value = cover;
      u.snow.value = this.weather.kind === "snow" ? 1 : 0;
      (u.tint.value as Color).setHex(this.weather.kind === "snow" ? 0xffffff : 0xb8c8dc).multiplyScalar(1 - night * 0.6);
      u.pixels.value = pixels;
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
