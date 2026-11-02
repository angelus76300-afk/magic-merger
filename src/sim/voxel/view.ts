import {
  AdditiveBlending,
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ColorManagement,
  DoubleSide,
  Fog,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  Points,
  RingGeometry,
  Scene,
  ShaderMaterial,
  LinearSRGBColorSpace,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { kindOf, type Creature, type CreatureKind } from "../creatures";
import { F as FLUID } from "../materials";
import { Figures, figureMaterials, type Pose } from "./figures";
import { buildRig, paletteOf, ROLES, variantOf, type Rig } from "./rigs";
import { BUILTIN, C, F, S } from "../materials";
import { envelope, type Body, type Visuals } from "../visuals";
import type { World } from "../world";
import { bodyGeometry } from "./bodies";
import { daylight } from "../daylight";
import { MODELS, geometryOf } from "./models";
import { OrbitCamera } from "./orbit";
import { CHUNK, Terrain, columnTop, surfaceY } from "./terrain";
import { hexColor, mixColor } from "../colors";
import { DecorInstances } from "./decor-instances";
import { Darkness } from "./darkness";
import { keyLevel, keyX, keyY } from "../voxelkey";

// What a spell's darkness pulls the sky toward.
const NIGHT_SKY = 0x04020f;

// Colors are authored as they should look, with lighting baked in: no color
// management, no conversion, what is written is what is shown.
ColorManagement.enabled = false;

const SKY_TOP = "#5fa8e8";
const SKY_LOW = "#cfe8f7";
const DECAL_SCALE = 4; // decal pixels per cell
const MOOD_COLORS: Record<string, number> = { fear: 0xffe066, lured: 0xffc23d, angry: 0xff4d4d, hunt: 0xb3123b, asleep: 0xa9c8ff };

// Draws the world as a floating voxel island. Built for phones: unlit
// materials with lighting baked into colors, terrain rebuilt only where it
// changed, every repeated thing drawn in one instanced call, and a pixel
// density that drops when frames get slow.
export class VoxelView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly orbit: OrbitCamera;
  private terrain: Terrain;
  private covers = new Map<string, InstancedMesh>();
  private coverCounts = new Map<string, number>();
  private lastCovers = -1;
  // Creatures as figures of boxes (3.5), and what each one was doing at the
  // last frame: where it stood, its heading, its stride.
  private figures: Figures;
  private rigs = new WeakMap<CreatureKind, Map<number, Rig>>();
  private gaits = new Map<number, { x: number; y: number; t: number; speed: number; phase: number; yaw: number; seen: number }>();
  private palette: number[] = new Array(ROLES).fill(0);
  private pose: Pose = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    scale: 1,
    phase: 0,
    moving: 0,
    time: 0,
    flying: false,
    still: false,
    nod: 0,
    detail: true,
    glowAll: false,
    tint: 0,
    tintAmount: 0,
    offset: 0,
  };
  private frameNo = 0;
  private frustum = new Frustum();
  private sphere = new Sphere();
  private projScreen = new Matrix4();
  // A small block over a creature's head that shows why it acts: fear,
  // lured, carrying something home, angry, hunting, asleep.
  private markMesh: InstancedMesh;
  private flames: InstancedMesh;
  private puffs: InstancedMesh;
  private glowPoints: Points;
  private dullPoints: Points;
  private bodies = new Map<number, Object3D>();
  private boltCore: InstancedMesh;
  private boltHalo: InstancedMesh;
  private rings: Mesh[] = [];
  private lights: Sprite[] = [];
  private clouds: InstancedMesh;
  // Materials tinted by the time of day (fire and glows are not).
  private lit: MeshBasicMaterial[] = [];
  private windows!: InstancedMesh;
  private houseCells: number[] = [];
  private sky = "";
  private skyCanvas = document.createElement("canvas");
  private decorMesh: InstancedMesh;
  // Voxels that shine (crystal, magic, fire) are not darkened at night.
  private decorGlow: InstancedMesh;
  private decorVersion = -1;
  private decorInstances: DecorInstances;
  private darkness = new Darkness();
  private glowKeys: number[] = [];
  private decal: HTMLCanvasElement;
  private decalCtx: CanvasRenderingContext2D;
  private decalTexture: CanvasTexture;
  private decalUsed = false;
  private overlayCtx: CanvasRenderingContext2D;
  private glowTexture: CanvasTexture;
  private m = new Matrix4();
  private v = new Vector3();
  private col = new Color();
  private frameTimes: number[] = [];
  private drawTimes: number[] = [];
  private droppedAt = -Infinity;
  private pixelRatio = 1;
  private cssW = 1;
  private cssH = 1;
  private firstBuild = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly overlay: HTMLCanvasElement,
    private world: World,
    options: { preserveDrawingBuffer?: boolean } = {},
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: !!options.preserveDrawingBuffer,
    });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.overlayCtx = overlay.getContext("2d")!;
    this.orbit = new OrbitCamera(world.w, world.h);

    this.scene.background = skyTexture();
    this.scene.fog = new Fog(SKY_LOW, world.w * 1.6, world.w * 5);

    // Spell drawings in world space are painted onto a texture draped over the land.
    this.decal = document.createElement("canvas");
    this.decal.width = world.w * DECAL_SCALE;
    this.decal.height = world.h * DECAL_SCALE;
    this.decalCtx = this.decal.getContext("2d")!;
    this.decalTexture = new CanvasTexture(this.decal);
    const land = withDecal(new MeshBasicMaterial({ vertexColors: true }), this.decalTexture, world);
    const fluid = withDecal(new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }), this.decalTexture, world);
    this.terrain = new Terrain(
      world,
      land,
      fluid,
      (m) => this.scene.add(m),
      (m) => this.scene.remove(m),
    );

    const basic = new MeshBasicMaterial({ vertexColors: true });
    for (const key of ["tree", "pine", "bush", "crop", "house", "rubble", "powder", "stump", "flower", "boulder", "block", "slab"]) {
      const mesh = new InstancedMesh(geometryOf(MODELS[key]), basic, 64);
      withColors(mesh);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.covers.set(key, mesh);
      this.scene.add(mesh);
    }
    const figureMats = figureMaterials();
    this.figures = new Figures(this.scene, figureMats);
    this.markMesh = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true }), 900);
    this.flames = this.instanced("flame", new MeshBasicMaterial({ vertexColors: true }), 5000);
    this.puffs = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }), 4000);
    this.glowTexture = glowTexture();
    this.glowPoints = pointCloud(world.particles.capacity, true, this.glowTexture);
    this.dullPoints = pointCloud(world.particles.capacity, false, this.glowTexture);
    this.scene.add(this.glowPoints, this.dullPoints);
    this.clouds = this.makeClouds();
    this.decorMesh = this.instanced("puff", basic, 20000);
    this.decorGlow = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true }), 20000);
    this.decorInstances = new DecorInstances([this.decorMesh, this.decorGlow], 20000, world.w / 2, world.h / 2);
    this.windows = this.instanced("flame", new MeshBasicMaterial({ vertexColors: true }), 4096);
    this.boltCore = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true }), 3000);
    this.boltHalo = this.instanced(
      "puff",
      new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }),
      3000,
    );
    this.lit = [land, fluid, basic, this.puffs.material as MeshBasicMaterial, this.clouds.material as MeshBasicMaterial, figureMats.lit];
    for (const m of this.lit) this.darkness.apply(m);
  }

  private instanced(model: string, material: Material, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(geometryOf(MODELS[model]), material, capacity);
    withColors(mesh);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.orbit.resize(this.cssW, this.cssH);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(this.cssW * dpr);
    this.overlay.height = Math.round(this.cssH * dpr);
  }

  // Height of the visible surface (land or fluid) under a point, in scene units.
  groundAt = (x: number, y: number): number => {
    const { world } = this;
    const cx = Math.max(0, Math.min(world.w - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(world.h - 1, Math.floor(y)));
    return surfaceY(world, cy * world.w + cx);
  };

  // The cell under a screen point, by walking along the camera ray.
  pick(sx: number, sy: number): { x: number; y: number } | null {
    const cam = this.orbit.camera;
    const ndc = new Vector3((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1, 0.5);
    ndc.unproject(cam);
    const dir = ndc.sub(cam.position).normalize();
    const p = cam.position.clone();
    const { world } = this;
    const step = Math.max(0.25, this.orbit.dist / 400);
    for (let t = 0; t < this.orbit.dist * 4 + 400; t += step) {
      p.addScaledVector(dir, step);
      const x = p.x + world.w / 2;
      const y = p.z + world.h / 2;
      if (p.y < -20) return null;
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
      if (p.y <= this.groundAt(x, y)) return { x, y };
    }
    return null;
  }

  render(visuals: Visuals, time: number, dt: number, reducedMotion: boolean): void {
    const started = performance.now();
    this.lapAt = started;
    const { world } = this;
    this.orbit.update(dt, time, this.groundAt, reducedMotion);
    this.terrain.scan();
    this.terrain.rebuild(this.firstBuild);
    this.firstBuild = false;
    this.lap("terrain");
    if (this.terrain.coversChanged && time - this.lastCovers > 0.25) {
      this.terrain.coversChanged = false;
      this.lastCovers = time;
      this.placeCovers();
    }
    this.lap("covers");
    if (world.decorVersion !== this.decorVersion) {
      this.decorVersion = world.decorVersion;
      this.placeDecor(time);
    }
    this.lap("decor");
    this.placeCreatures(time);
    this.lap("creatures");
    this.placeFireAndGas(time);
    this.placeParticles();
    this.placeBodies(visuals, time);
    this.placeBolts(visuals);
    this.placeRingsAndLights(visuals);
    this.lap("effects");
    this.paintDecal(visuals);
    this.moveClouds(time);
    this.applyDaylight(time, visuals.darknessLevel(), visuals);
    this.lap("decal+day");
    this.renderer.render(this.scene, this.orbit.camera);
    this.lap("draw");
    this.drawOverlay(visuals);
    this.lap("overlay");
    this.adapt(performance.now() - started, dt);
  }

  // Spell Lab only: milliseconds per part of render(), one entry per frame.
  profile: Record<string, number[]> | null = null;
  private lapAt = 0;
  private lap(part: string): void {
    if (!this.profile) return;
    const now = performance.now();
    (this.profile[part] ??= []).push(now - this.lapAt);
    this.lapAt = now;
  }

  // What the last frame drew, for the HUD.
  counts(): { calls: number; triangles: number; pixelRatio: number; parts: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, pixelRatio: this.pixelRatio, parts: this.figures.parts };
  }

  // The light points that stay bright in a spell's darkness, most important
  // first: spell lights, glowing bodies and creatures, fire and lava on the
  // land, then glowing voxels. Positions in scene units.
  private lightTheDark(dark: number, visuals: Visuals): void {
    const d = this.darkness;
    d.begin(dark > 0.01 ? dark : 0);
    if (dark <= 0.01) return;
    const { world } = this;
    const at = (x: number, y: number, h: number, r: number, power: number) => {
      const p = this.toScene(x, y, h);
      return d.add(p.x, p.y, p.z, r, power);
    };
    for (const l of visuals.lights) at(l.x, l.y, this.groundAt(l.x, l.y) + 1, l.r * 1.3, envelope(l.t, l.dur) * 1.2);
    for (const b of visuals.bodies) if (b.glow && b.look !== "none") at(b.x, b.y, this.groundAt(b.x, b.y) + b.z, Math.max(3, b.r * 4), 1);
    for (const c of world.creatures) if (!d.full && !c.dead && kindOf(c).glow) at(c.x, c.y, this.groundAt(c.x, c.y) + 1, 5, 0.9);
    // Fire and lava, looked for on a coarse grid, the brightest spots first.
    for (let y = 2; y < world.h && !d.full; y += 6) {
      for (let x = 2; x < world.w && !d.full; x += 6) {
        const i = y * world.w + x;
        if (world.fire[i] > 0.3 || world.fluid[i] === F.LAVA || world.materials.get("ground", world.ground[i]).glow)
          at(x + 0.5, y + 0.5, columnTop(world, i) + 1, 8, 0.9);
      }
    }
    for (const key of this.decorInstances.glowing(6, this.glowKeys)) {
      if (!at(keyX(key) + 0.5, keyY(key) + 0.5, keyLevel(key) + 0.5, 5, 0.7)) break;
    }
  }

  // Lower the pixel density when frames are slow, raise it back when they are fast.
  private adapt(ms: number, dt: number): void {
    this.frameTimes.push(dt * 1000);
    this.drawTimes.push(ms);
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const draw = this.drawTimes.reduce((a, b) => a + b, 0) / this.drawTimes.length;
    this.frameTimes = [];
    this.drawTimes = [];
    const max = Math.min(2, window.devicePixelRatio || 1);
    // Frames come every 33 ms, one per simulation tick, unless a finger moves
    // the view. Well past that, frames are being missed: draw fewer pixels.
    // Back up only when both the cadence and the drawing have room, and not
    // within 10 s of a drop, so it does not see-saw.
    const now = performance.now();
    let next = this.pixelRatio;
    if (avg > 52 || draw > 30) {
      next = Math.max(0.6, this.pixelRatio - 0.25);
      this.droppedAt = now;
    } else if (avg < 38 && draw < 12 && now - this.droppedAt > 10_000) next = Math.min(max, this.pixelRatio + 0.25);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(this.cssW, this.cssH, false);
    }
  }

  private toScene(x: number, y: number, h: number): Vector3 {
    return this.v.set(x - this.world.w / 2, h, y - this.world.h / 2);
  }

  private placeCovers(): void {
    const { world } = this;
    const lists = new Map<string, number[]>();
    for (const key of this.covers.keys()) lists.set(key, []);
    const builtinCovers = BUILTIN.cover.length;
    for (let i = 0; i < world.n; i++) {
      const c = world.cover[i];
      if (c === C.NONE) continue;
      let key: string;
      if (c >= builtinCovers) key = world.materials.get("cover", c).solid ? "block" : "slab";
      else if (c === C.TREE) key = world.shade[i] % 3 === 0 || world.height[i] > 20 ? "pine" : "tree";
      else key = world.materials.get("cover", c).name;
      lists.get(key)?.push(i);
    }
    this.houseCells = lists.get("house") ?? [];
    for (const [key, cells] of lists) {
      let mesh = this.covers.get(key)!;
      if (cells.length > mesh.instanceMatrix.count) {
        // Grow the instance buffer.
        const bigger = new InstancedMesh(mesh.geometry, mesh.material, Math.ceil(cells.length * 1.5));
        withColors(bigger);
        bigger.frustumCulled = false;
        this.scene.remove(mesh);
        mesh.dispose();
        this.scene.add(bigger);
        this.covers.set(key, bigger);
        mesh = bigger;
      }
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const x = i % world.w;
        const y = Math.floor(i / world.w);
        // A little size and turn variety so forests do not look stamped.
        const s = key === "house" ? 1 : 0.85 + (world.shade[i] % 7) * 0.04;
        const turn = key === "house" ? 0 : ((world.shade[i] >> 2) % 4) * (Math.PI / 2);
        this.m.makeRotationY(turn);
        this.m.scale(new Vector3(s, s, s));
        const p = this.toScene(x + 0.5, y + 0.5, columnTop(world, i));
        // Rotation is around the model's corner: shift so it turns around the cell center.
        const off = new Vector3(-0.5 * s, 0, -0.5 * s).applyMatrix4(new Matrix4().makeRotationY(turn));
        this.m.setPosition(p.x + off.x, p.y, p.z + off.z);
        mesh.setMatrixAt(k, this.m);
        if (key === "block" || key === "slab") {
          const mat = world.materials.get("cover", world.cover[i]);
          mesh.setColorAt(k, this.col.setHex(mat.colors[world.shade[i] % mat.colors.length]));
        }
      }
      mesh.count = cells.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.coverCounts.set(key, cells.length);
    }
  }

  private placeDecor(time: number): void {
    this.decorInstances.update(this.world.decor, this.world.voxels.burning, time);
  }

  // Tints the land, the sky and the fog for the time of day; lights the
  // windows at night and lets chimneys smoke.
  // A spell's darkness (w.darken) is the same tint, deeper: everything lit by
  // the sun dims, while fire, lava glow, shining voxels and spell lights keep
  // their own light. It used to be a 2D canvas over the whole screen with a
  // gradient hole cut for every light, redrawn every frame.
  private applyDaylight(time: number, dark: number, visuals: Visuals): void {
    const day = daylight(time);
    for (const m of this.lit) m.color.setRGB(day.r, day.g, day.b);
    this.lightTheDark(Math.min(0.95, dark), visuals);
    // The sky is repainted only when it changes by a visible step.
    const shade = Math.round(Math.min(0.95, dark) * 20) / 20;
    const top = shade ? hexColor(mixColor(parseInt(day.skyTop.slice(1), 16), NIGHT_SKY, shade)) : day.skyTop;
    const low = shade ? hexColor(mixColor(parseInt(day.skyLow.slice(1), 16), NIGHT_SKY, shade)) : day.skyLow;
    const key = top + low;
    if (key !== this.sky) {
      this.sky = key;
      paintSky(this.skyCanvas, top, low);
      (this.scene.background as CanvasTexture).image = this.skyCanvas;
      (this.scene.background as CanvasTexture).needsUpdate = true;
      (this.scene.fog as Fog).color.set(low);
    }
    let n = 0;
    if (day.night > 0.15) {
      const glow = 0.4 + 0.6 * day.night;
      for (const i of this.houseCells) {
        if (n >= 4096) break;
        // One lit window on the south wall of each house cell, flickering a little.
        const x = i % this.world.w;
        const y = Math.floor(i / this.world.w);
        const flicker = 0.85 + 0.15 * Math.sin(time * 3 + i);
        this.m.makeScale(0.24, 0.22, 0.06);
        const p = this.toScene(x + 0.5, y + 0.94, columnTop(this.world, i) + 0.28);
        this.m.setPosition(p.x, p.y, p.z);
        this.windows.setMatrixAt(n, this.m);
        this.windows.setColorAt(n, this.col.setRGB(glow * flicker, glow * 0.78 * flicker, glow * 0.35));
        n++;
      }
    }
    this.windows.count = n;
    this.windows.instanceMatrix.needsUpdate = true;
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    // Chimney smoke: a puff now and then from a random house.
    if (this.houseCells.length && Math.random() < Math.min(0.6, this.houseCells.length / 60)) {
      const i = this.houseCells[(Math.random() * this.houseCells.length) | 0];
      this.world.particles.add({
        x: (i % this.world.w) + 0.5,
        y: Math.floor(i / this.world.w) + 0.5,
        z: 1.4,
        vz: 1.2,
        vx: this.world.wind.x * 0.6,
        vy: this.world.wind.y * 0.6,
        life: 2.5,
        color: 0xd8d4cc,
        size: 1.6,
        drag: 0.4,
        gravity: -0.3,
      });
    }
  }

  private rigFor(c: Creature, k: CreatureKind): Rig {
    let byVariant = this.rigs.get(k);
    if (!byVariant) {
      byVariant = new Map();
      this.rigs.set(k, byVariant);
    }
    const variant = variantOf(k.body, c.look);
    let rig = byVariant.get(variant);
    if (!rig) {
      rig = buildRig(k.body, c.look);
      byVariant.set(variant, rig);
    }
    return rig;
  }

  private placeCreatures(time: number): void {
    const { world } = this;
    const frame = ++this.frameNo;
    const pose = this.pose;
    pose.time = time;
    // What the camera sees: creatures outside it are not posed or drawn.
    const cam = this.orbit.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const camPos = cam.position;
    // Small parts (eyes, ears, buckles) only where they are a pixel or more:
    // closer than this many scene units for a creature of size 1.
    const detailRange = 55;
    this.figures.begin();
    let marks = 0;
    let n = 0;
    for (const c of world.creatures) {
      if (n >= 900) break;
      n++;
      const k = kindOf(c);
      const rig = this.rigFor(c, k);
      // Figures are slimmer than the blocks they replace: drawn a little larger
      // so a villager reads at a glance (the simulation's size is unchanged).
      const size = k.radius * 1.85 * c.size;
      const i = Math.max(0, Math.min(world.w - 1, Math.floor(c.x))) + Math.max(0, Math.min(world.h - 1, Math.floor(c.y))) * world.w;
      const ground = this.groundAt(c.x, c.y);
      // Fish swim under the surface; a dead one floats.
      const underwater = k.aquatic && !c.dead && world.depth[i] > 0.3 && world.fluid[i] === FLUID.WATER;
      const y = underwater ? ground - Math.min(0.7, world.depth[i] * 0.5) - size * 0.15 : ground + c.z;
      const p = this.toScene(c.x, c.y, y);
      this.sphere.center.set(p.x, p.y + rig.height * size * 0.5, p.z);
      this.sphere.radius = Math.max(rig.height, 1.4) * size;
      const seen = this.frustum.intersectsSphere(this.sphere);

      // The stride and heading come from how far it moved since the last tick.
      let g = this.gaits.get(c.id);
      if (!g) {
        g = { x: c.x, y: c.y, t: time, speed: 0, phase: c.id, yaw: (c.id * 2.4) % (Math.PI * 2), seen: frame };
        this.gaits.set(c.id, g);
      }
      g.seen = frame;
      if (time > g.t) {
        const dt = time - g.t;
        const dx = c.x - g.x;
        const dy = c.y - g.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) g.speed = 0;
        else {
          g.speed += (d / dt - g.speed) * Math.min(1, dt * 8);
          if (d > 0.004 && !c.dead) {
            let turn = Math.atan2(dx, dy) - g.yaw;
            turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            g.yaw += turn * Math.min(1, dt * 10);
          }
          g.phase += Math.min(g.speed, 12) * dt * (3.6 / Math.max(0.3, size));
        }
        g.x = c.x;
        g.y = c.y;
        g.t = time;
      }

      // The mark over its head, then the figure, when the camera sees it.
      const mood = c.dead ? null : (c.data.mood as string | null | undefined);
      if (mood && marks < 900 && seen) {
        const color = mood === "carry" ? ((c.data.carry as number | undefined) ?? 0xffd36a) : (MOOD_COLORS[mood] ?? 0xffffff);
        const s = Math.max(0.22, size * 0.28) * (mood === "lured" || mood === "angry" ? 0.9 + 0.2 * Math.sin(time * 8 + c.id) : 1);
        this.m.makeScale(s, s, s);
        this.m.setPosition(p.x, p.y + rig.height * size + s * 1.4, p.z);
        this.markMesh.setMatrixAt(marks, this.m);
        this.markMesh.setColorAt(marks, this.col.setHex(color));
        marks++;
      }
      if (!seen) continue;
      const still = c.dead || c.frozen > 0 || c.stun > 0;
      const asleep = c.sleep > 0 || c.data.mood === "asleep";
      pose.x = p.x;
      pose.y = p.y;
      pose.z = p.z;
      pose.yaw = g.yaw;
      pose.scale = size;
      pose.phase = g.phase;
      pose.moving = still ? 0 : Math.min(1, g.speed / 1.4);
      pose.still = still;
      pose.flying = !c.dead && (k.flying || c.levitate > 0) && c.z > 0.5;
      pose.nod = asleep ? 0.35 : 0;
      pose.pitch = rig.lean + (still ? 0 : pose.moving * 0.05);
      pose.roll = 0;
      pose.offset = (c.id % 17) * 0.37;
      pose.glowAll = k.glow;
      pose.tintAmount = 0;
      if (c.dead) {
        // Falls on its side (a fish turns belly up), lying on the ground and
        // not in it, then sinks into it over the 40 s before it is gone.
        const fall = Math.min(1, c.deadFor * 3);
        pose.roll = (k.aquatic ? Math.PI : Math.PI / 2) * fall;
        pose.pitch = 0;
        pose.y += (k.aquatic ? rig.height : rig.halfWidth) * size * Math.sin((fall * Math.PI) / 2);
        if (!k.aquatic) pose.y -= Math.min(1, c.deadFor / 40) * (rig.halfWidth * 2 + 0.1) * size;
        pose.tint = 0x5a5560;
        pose.tintAmount = 0.55;
        pose.glowAll = false;
      } else if (c.frozen > 0) {
        pose.tint = 0xbfe6ff;
        pose.tintAmount = 0.6;
      } else if (c.burning > 0 && Math.sin(time * 30 + c.id) > 0) {
        pose.tint = 0xff8c1a;
        pose.tintAmount = 0.65;
      } else if (k.glow) pose.y += Math.sin(time * 2 + c.id) * 0.08 * size;
      if (asleep && !c.dead && !pose.flying) pose.y -= size * 0.05;
      pose.detail = camPos.distanceToSquared(this.sphere.center) < (detailRange * size) ** 2;
      this.figures.add(rig, paletteOf(this.palette, rig, k.body, c.color, c.look), pose);
    }
    this.figures.end();
    this.markMesh.count = marks;
    this.markMesh.instanceMatrix.needsUpdate = true;
    if (this.markMesh.instanceColor) this.markMesh.instanceColor.needsUpdate = true;
    // Forget creatures that are gone, now and then.
    if (frame % 120 === 0) for (const [id, g] of this.gaits) if (g.seen !== frame) this.gaits.delete(id);
  }

  // Creature parts drawn in the last frame, for the HUD.
  get figureParts(): number {
    return this.figures.parts;
  }

  private placeFireAndGas(time: number): void {
    const { world } = this;
    let f = 0;
    let g = 0;
    const flameColors = [0xffd36a, 0xffa43a, 0xff6a1a, 0xe8420f];
    for (let i = 0; i < world.n; i++) {
      const fire = world.fire[i];
      if (fire > 0.05 && f < 5000) {
        const x = i % world.w;
        const y = Math.floor(i / world.w);
        const base = columnTop(world, i) + (world.cover[i] === C.TREE || world.cover[i] === C.HOUSE ? 0.6 : 0);
        const flick = 0.5 + 0.5 * Math.sin(time * 18 + i * 1.7);
        const h = (0.4 + fire * 1.2) * (0.7 + flick * 0.6);
        this.m.makeScale(0.7, h, 0.7);
        const p = this.toScene(x + 0.5, y + 0.5, base);
        this.m.setPosition(p.x, p.y, p.z);
        this.flames.setMatrixAt(f, this.m);
        this.flames.setColorAt(f, this.col.setHex(flameColors[(i + Math.floor(time * 12)) % 4]));
        f++;
      }
      // Gas is sampled every other cell, so a big cloud stays affordable.
      const amt = world.gasAmt[i];
      if (amt > 0.3 && world.gas[i] !== S.NONE && g < 2500 && i % 3 === 0 && ((i / world.w) | 0) % 3 === 0) {
        const x = i % world.w;
        const y = Math.floor(i / world.w);
        const s = 1.2 + amt * 1.6;
        this.m.makeScale(s, s * 0.6, s);
        const p = this.toScene(x + 1.5, y + 1.5, surfaceY(world, i) + 2 + amt * 3 + Math.sin(time + i) * 0.3);
        this.m.setPosition(p.x, p.y, p.z);
        this.puffs.setMatrixAt(g, this.m);
        this.puffs.setColorAt(g, this.col.setHex(world.materials.get("gas", world.gas[i]).colors[0]));
        g++;
      }
    }
    this.flames.count = f;
    this.puffs.count = g;
    this.flames.instanceMatrix.needsUpdate = true;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  private placeParticles(): void {
    const p = this.world.particles;
    const fill = (points: Points, glow: boolean) => {
      const geo = points.geometry;
      const pos = geo.getAttribute("position") as BufferAttribute;
      const col = geo.getAttribute("color") as BufferAttribute;
      const size = geo.getAttribute("size") as BufferAttribute;
      let n = 0;
      for (let i = 0; i < p.capacity; i++) {
        if (p.life[i] <= 0 || (p.glow[i] === 1) !== glow) continue;
        const ground = this.groundAt(p.x[i], p.y[i]);
        pos.setXYZ(n, p.x[i] - this.world.w / 2, ground + p.z[i], p.y[i] - this.world.h / 2);
        const c = p.color[i];
        const a = Math.min(1, (p.life[i] / p.maxLife[i]) * 1.6);
        col.setXYZW(n, ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, a);
        size.setX(n, p.size[i] * 0.45);
        n++;
      }
      geo.setDrawRange(0, n);
      pos.needsUpdate = true;
      col.needsUpdate = true;
      size.needsUpdate = true;
    };
    fill(this.glowPoints, true);
    fill(this.dullPoints, false);
    const scale = (this.renderer.getPixelRatio() * this.cssH * 0.5) / Math.tan((this.orbit.camera.fov * Math.PI) / 360);
    (this.glowPoints.material as ShaderMaterial).uniforms.scale.value = scale;
    (this.dullPoints.material as ShaderMaterial).uniforms.scale.value = scale;
  }

  private placeBodies(visuals: Visuals, time: number): void {
    const alive = new Set<number>();
    // Even a cosmic body should not hide the whole island.
    const maxScale = Math.max(this.world.w, this.world.h) * 0.2;
    for (const b of visuals.bodies) {
      if (!b.alive || b.look === "none") continue;
      alive.add(b.id);
      let obj = this.bodies.get(b.id);
      if (!obj) {
        obj = this.makeBody(b);
        this.bodies.set(b.id, obj);
        this.scene.add(obj);
      }
      const ground = this.groundAt(b.x, b.y);
      const scale = Math.max(0.2, Math.min(maxScale, b.r));
      const p = this.toScene(b.x, b.y, ground + b.z + scale);
      obj.position.copy(p);
      obj.scale.setScalar(scale);
      if (b.look === "vortex" || b.look === "ring" || b.look === "star") obj.rotation.y = time * 3;
      if (b.look === "meteor") obj.rotation.set(time * 2, time * 1.3, 0);
      if (b.look === "flame") {
        obj.scale.multiplyScalar(0.9 + Math.random() * 0.2);
        obj.rotation.y = time * 1.5;
      }
      if (b.look === "swarm") {
        // Motes wandering around the body's center.
        obj.children.forEach((m, k) => {
          if (m instanceof Sprite) return;
          const a = time * (1.5 + (k % 5) * 0.4) + k * 2.1;
          m.position.set(Math.cos(a) * (0.4 + (k % 3) * 0.3), Math.sin(a * 1.7 + k) * 0.5, Math.sin(a) * (0.4 + (k % 4) * 0.25));
        });
      }
    }
    for (const [id, obj] of this.bodies) {
      if (alive.has(id)) continue;
      this.scene.remove(obj);
      obj.traverse((o) => {
        // Body geometries are shared through a cache; only materials are per body.
        if (o instanceof Mesh || o instanceof Sprite) (o.material as Material).dispose();
      });
      this.bodies.delete(id);
    }
  }

  private makeBody(b: Body): Object3D {
    const group = new Group();
    const color = new Color(b.color);
    if (b.look === "swarm") {
      const mote = new BoxGeometry(0.16, 0.16, 0.16);
      for (let k = 0; k < 16; k++) group.add(new Mesh(mote, new MeshBasicMaterial({ color: k % 3 ? b.color : b.color2 })));
    } else {
      const mat = new MeshBasicMaterial({
        vertexColors: true,
        transparent: b.look === "cloud" || b.look === "vortex",
        opacity: b.look === "cloud" ? 0.88 : b.look === "vortex" ? 0.8 : 1,
      });
      group.add(new Mesh(bodyGeometry(b.look, b.color, b.color2), mat));
    }
    if (b.glow) {
      const glow = new Sprite(
        new SpriteMaterial({ map: this.glowTexture, color, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }),
      );
      glow.scale.setScalar(b.look === "cloud" ? 2.5 : 3.2);
      group.add(glow);
    }
    return group;
  }

  // Lightning and beams: lines of glowing cubes with a soft halo.
  private placeBolts(visuals: Visuals): void {
    let n = 0;
    const { world } = this;
    for (const bolt of visuals.bolts) {
      const fade = Math.max(0, 1 - bolt.t / bolt.dur);
      // Lightning flickers; it is brightest when it hits.
      const flicker = bolt.dur < 1 ? (Math.random() < 0.25 ? 0.4 : 1) : 0.85 + 0.15 * Math.sin(bolt.t * 30);
      const k = fade * flicker;
      for (let s = 1; s < bolt.points.length; s++) {
        const a = bolt.points[s - 1];
        const b = bolt.points[s];
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.l - a.l);
        const steps = Math.max(1, Math.ceil(len / 0.45));
        for (let q = 0; q < steps && n < 3000; q++) {
          const t = q / steps;
          const x = a.x + (b.x - a.x) * t - world.w / 2;
          const z = a.y + (b.y - a.y) * t - world.h / 2;
          const y = a.l + (b.l - a.l) * t;
          const w = bolt.width * 0.35;
          this.m.makeScale(w, w, w);
          this.m.setPosition(x, y, z);
          this.boltCore.setMatrixAt(n, this.m);
          this.boltCore.setColorAt(n, this.col.setRGB(0.85 + 0.15 * k, 0.85 + 0.15 * k, 1).lerp(new Color(bolt.color), 0.35));
          const h = bolt.width * 1.3;
          this.m.makeScale(h, h, h);
          this.m.setPosition(x, y, z);
          this.boltHalo.setMatrixAt(n, this.m);
          this.boltHalo.setColorAt(n, this.col.setHex(bolt.color).multiplyScalar(k));
          n++;
        }
      }
    }
    for (const mesh of [this.boltCore, this.boltHalo]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private placeRingsAndLights(visuals: Visuals): void {
    while (this.rings.length < visuals.shockwaves.length) {
      const ring = new Mesh(
        new RingGeometry(0.92, 1, 64),
        new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.rings.push(ring);
      this.scene.add(ring);
    }
    this.rings.forEach((ring, k) => {
      const sw = visuals.shockwaves[k];
      ring.visible = !!sw;
      if (!sw) return;
      const t = sw.t / sw.dur;
      const r = Math.max(0.1, sw.r * (1 - (1 - t) * (1 - t)));
      const p = this.toScene(sw.x, sw.y, this.groundAt(sw.x, sw.y) + 0.4);
      ring.position.copy(p);
      ring.scale.setScalar(r);
      const mat = ring.material as MeshBasicMaterial;
      mat.color.setHex(sw.color);
      mat.opacity = Math.max(0, 1 - t);
    });
    while (this.lights.length < visuals.lights.length) {
      const s = new Sprite(new SpriteMaterial({ map: this.glowTexture, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      this.lights.push(s);
      this.scene.add(s);
    }
    this.lights.forEach((s, k) => {
      const l = visuals.lights[k];
      s.visible = !!l;
      if (!l) return;
      s.position.copy(this.toScene(l.x, l.y, this.groundAt(l.x, l.y) + 2));
      s.scale.setScalar(l.r * 2.2);
      const mat = s.material as SpriteMaterial;
      mat.color.setHex(l.color);
      mat.opacity = 0.7 * envelope(l.t, l.dur);
    });
  }

  // World space spell drawings, painted on the decal texture over the land.
  private paintDecal(visuals: Visuals): void {
    const world = visuals.drawings.filter((d) => d.space === "world");
    if (!world.length && !this.decalUsed) return;
    const ctx = this.decalCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.decal.width, this.decal.height);
    ctx.setTransform(DECAL_SCALE, 0, 0, DECAL_SCALE, 0, 0);
    for (const d of world) {
      ctx.save();
      try {
        d.fn(ctx, d.t);
      } catch {
        // The runtime reports drawing errors; the frame goes on.
      }
      ctx.restore();
    }
    this.decalUsed = world.length > 0;
    this.decalTexture.needsUpdate = true;
  }

  // Night, tints, flashes and screen space spell drawings, over the 3D view.
  private drawOverlay(visuals: Visuals): void {
    const ctx = this.overlayCtx;
    const dpr = this.overlay.width / this.cssW;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const t of visuals.tints) {
      ctx.globalAlpha = t.alpha * envelope(t.t, t.dur);
      ctx.fillStyle = hexColor(t.color);
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    if (visuals.flash > 0) {
      ctx.globalAlpha = Math.min(1, visuals.flash);
      ctx.fillStyle = hexColor(visuals.flashColor);
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    ctx.globalAlpha = 1;
    for (const d of visuals.drawings) {
      if (d.space !== "screen") continue;
      ctx.save();
      try {
        d.fn(ctx, d.t);
      } catch {
        // Reported by the runtime.
      }
      ctx.restore();
    }
  }

  private makeClouds(): InstancedMesh {
    const mesh = new InstancedMesh(geometryOf(MODELS.puff), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }), 120);
    withColors(mesh);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private moveClouds(time: number): void {
    const { world } = this;
    const R = Math.max(world.w, world.h);
    let n = 0;
    for (let c = 0; c < 10; c++) {
      const a = c * 0.63 + time * 0.01;
      // A ring of clouds around the island, never through it.
      const d = R * (0.85 + (c % 3) * 0.22);
      const cx = Math.cos(a) * d;
      const cz = Math.sin(a) * d;
      const cy = 10 + (c % 4) * 7;
      for (let k = 0; k < 9; k++) {
        const s = 3 + ((c * 7 + k * 3) % 4);
        this.m.makeScale(s * 1.4, s * 0.6, s);
        this.m.setPosition(cx + (k - 4) * 2.4, cy + ((k * 5) % 3) * 0.8, cz + ((k * 3) % 5) - 2);
        this.clouds.setMatrixAt(n, this.m);
        this.clouds.setColorAt(n, this.col.setHex(k % 2 ? 0xffffff : 0xf0f4f8));
        n++;
      }
    }
    this.clouds.count = n;
    this.clouds.instanceMatrix.needsUpdate = true;
    if (this.clouds.instanceColor) this.clouds.instanceColor.needsUpdate = true;
  }

  // Frees every geometry, material and texture, not only the renderer: the
  // next engine reuses the same canvas and so the same WebGL context.
  dispose(): void {
    const seen = new Set<object>();
    const free = (thing: { dispose(): void } | null | undefined) => {
      if (thing && !seen.has(thing)) {
        seen.add(thing);
        thing.dispose();
      }
    };
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) free(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        free((mat as MeshBasicMaterial).map);
        free(mat);
      }
      if (o instanceof InstancedMesh) o.dispose();
    });
    free(this.decalTexture);
    free(this.glowTexture);
    free(this.scene.background as CanvasTexture);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  // Number of chunks, for the lab's statistics.
  stats(): { chunks: number; covers: number } {
    let covers = 0;
    for (const n of this.coverCounts.values()) covers += n;
    return { chunks: Math.ceil(this.world.w / CHUNK) * Math.ceil(this.world.h / CHUNK), covers };
  }
}

// Adds the decal texture to an unlit material: the land shows whatever spells
// painted at that spot. The drawing is projected from above, so it only goes
// on faces whose `decalMask` is 1 (dry land tops and fluid tops): on a cut
// side it would smear into vertical streaks, and on land under water it would
// show twice, once on the water and once through it.
function withDecal<T extends MeshBasicMaterial>(material: T, texture: CanvasTexture, world: World): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.decalMap = { value: texture };
    shader.uniforms.worldSize = { value: [world.w, world.h] };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nattribute float decalMask;\nvarying float vDecal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvDecal = decalMask;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nvarying float vDecal;\nuniform sampler2D decalMap;\nuniform vec2 worldSize;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nvec2 decalUv = (vWorldPos.xz + worldSize * 0.5) / worldSize;\nvec4 decal = texture2D(decalMap, vec2(decalUv.x, 1.0 - decalUv.y));\ngl_FragColor.rgb = mix(gl_FragColor.rgb, decal.rgb, decal.a * vDecal);",
      );
  };
  return material;
}

function paintSky(c: HTMLCanvasElement, top: string, low: string): void {
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
}

function skyTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, SKY_TOP);
  g.addColorStop(1, SKY_LOW);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  return t;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

// Particles as screen facing points, sized by distance, faded by their life.
function pointCloud(capacity: number, glow: boolean, texture: CanvasTexture): Points {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(capacity * 4), 4));
  geo.setAttribute("size", new BufferAttribute(new Float32Array(capacity), 1));
  geo.setDrawRange(0, 0);
  const material = new ShaderMaterial({
    uniforms: { scale: { value: 400 }, map: { value: texture } },
    vertexShader: `attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
      void main() { vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(2.0, size * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: glow
      ? `uniform sampler2D map; varying vec4 vColor; void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); }`
      : `varying vec4 vColor; void main() { gl_FragColor = vColor; }`,
    transparent: true,
    depthWrite: false,
    ...(glow ? { blending: AdditiveBlending } : {}),
  });
  const points = new Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}

// Instance colors must exist before the first render, or the shader is built without them.
function withColors(mesh: InstancedMesh): void {
  const white = new Color(0xffffff);
  for (let k = 0; k < mesh.instanceMatrix.count; k++) mesh.setColorAt(k, white);
}
