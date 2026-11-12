import { GRAPHICS } from "./graphics";
import { fronts } from "../weather";
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
import { buildRig, drawScale, paletteOf, ROLES, variantOf, type Rig } from "./rigs";
import { easeGround, walkGround, type Footing } from "./walk";
import { gaitOf, hipHeight, lookAround, strideRate } from "./gait";
import { BUILTIN, C, F, G, S } from "../materials";
import { laid } from "../roads";
import { envelope, type Body, type Visuals } from "../visuals";
import { TICK, type World } from "../world";
import { bodyGeometry } from "./bodies";
import { daylight } from "../daylight";
import { MODELS, geometryOf } from "./models";
import { OrbitCamera } from "./orbit";
import { CHUNK, Terrain, V, columnTop, surfaceY } from "./terrain";
import { hexColor, mixColor } from "../colors";
import { DecorInstances } from "./decor-instances";
import { Darkness } from "./darkness";
import { Domes } from "./domes";
import { keyLevel, keyX, keyY } from "../voxelkey";
import { LOOKS, biomeAt } from "../land";
import { DAMP, HEART, HOUSE_STYLES, R as RARE, STYLE_BITS, TREE_STYLES, type TreeStyle } from "../ecology";
import { NEAR_CELLS, nearTreeModel } from "./near";
import { GLOWING, VARIANTS, floraModels } from "./flora";
import { Buildings } from "./buildings";
import { WonderModels } from "./wonders";
import { PropModels } from "./props";
import { valueNoise } from "../noise";
import { LAB_SKY, Sky } from "./sky";
import { eyeFogRange, fogRange } from "./fog";
import { clearEye } from "../eyes";
import { solidCovers } from "../paths";
import { FAR, LETTERING, cartCenter, coverOf, emptyMap, fade, nameLabels, nameOrder, onTrip, placeNames, refreshMap, type Label, type Rect } from "../map";

// What a spell's darkness pulls the sky toward.
const NIGHT_SKY = 0x04020f;

// Colors are authored as they should look, with lighting baked in: no color
// management, no conversion, what is written is what is shown.
ColorManagement.enabled = false;

const SKY_TOP = "#5fa8e8";
const SKY_LOW = "#cfe8f7";
const DECAL_SCALE = 4; // decal pixels per cell
const MOOD_COLORS: Record<string, number> = { inspected: 0xffffff, fear: 0xffe066, lured: 0xffc23d, angry: 0xff4d4d, hunt: 0xb3123b, asleep: 0xa9c8ff };

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
  // Near the eye (near.ts): each tree cell's model and its place in that model's mesh, and the
  // meshes of the boxes drawn over the trees within NEAR_CELLS of the eye.
  private treeSlots = new Map<number, number>();
  private treeKeys: string[] = [];
  private nearMeshes = new Map<string, InstancedMesh>();
  private nearSlots = new Map<string, number[]>();
  private nearAt = -1;
  private coversDrawn = 0;
  private nearDrawn = -1;
  private coverMaterial!: MeshBasicMaterial;
  // Plants and crystals that shine by themselves (4.4.5): never darkened.
  private glowMaterial = new MeshBasicMaterial({ vertexColors: true });
  private sparks: InstancedMesh | null = null;
  private shoreCells: number[] | null = null;
  private lastCovers = -1;
  // Creatures as figures of boxes (3.5), and what each one was doing at the
  // last frame: where it stood, its heading, its stride.
  private figures: Figures;
  private rigs = new WeakMap<CreatureKind, Map<number, Rig>>();
  private gaits = new Map<
    number,
    Footing & {
      x: number;
      y: number;
      t: number;
      speed: number;
      phase: number;
      yaw: number;
      seen: number;
      graze: number;
      lie: number;
      look: number;
      // Where it stood, its stride and heading one tick before (2026-11-07):
      // a frame between two ticks draws it part way (between).
      px: number;
      py: number;
      pphase: number;
      pyaw: number;
    }
  >();
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
  private domes = new Domes(this.scene);
  private lights: Sprite[] = [];
  private clouds: InstancedMesh;
  // Rain seen from afar, under a front's cloud.
  private rainShafts: InstancedMesh;
  // Materials tinted by the time of day (fire and glows are not).
  private lit: MeshBasicMaterial[] = [];
  private windows!: InstancedMesh;
  private houseCells: number[] = [];
  // Every house and building with a job, each its own (4.4.5 part B).
  private buildings!: Buildings;
  // Wonders above the land (4.4.5 part B).
  private wonderModels!: WonderModels;
  private propModels!: PropModels;
  private skyKey = "";
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
  // Sun, moon, stars and weather (4.4).
  private sky!: Sky;
  private waveTime = { value: 0 };
  // The island as a map (4.9 part 3, map.ts): what the simulation holds, read every 3 s; how much
  // of the island the camera holds (1 whole); the far roads, one mesh drawn only from far; dust
  // and smoke over villages, one mesh; which windows are lit, by each village's people.
  private map = emptyMap();
  private cover = 0;
  private farRoads: InstancedMesh;
  private farWide = { value: 0 };
  private roadsMapped = -1;
  private plumes: InstancedMesh;
  private litMask = new Uint8Array(0);
  private litFor: unknown = null;
  private litMapped = -1;
  private nameWidths = new Map<string, number>();
  // Set by the frame (frame.ts): no names while the tour's card is up, and none over what it shows
  // above the island (the story line, a creature's card, the Watch button), as top left rectangles.
  mapHide: { all: boolean; blocked: Rect[] } = { all: false, blocked: [] };

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
    const fluid = withWaves(
      withDecal(new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }), this.decalTexture, world),
      this.waveTime,
    );
    this.terrain = new Terrain(
      world,
      land,
      fluid,
      (m) => this.scene.add(m),
      (m) => this.scene.remove(m),
    );

    const basic = new MeshBasicMaterial({ vertexColors: true });
    // Cover meshes are made the first time something needs them (4.4.5:
    // dozens of plant and rock looks, of which an island uses some).
    this.coverMaterial = basic;
    this.buildings = new Buildings(this.scene, basic);
    this.wonderModels = new WonderModels(this.scene, basic, this.glowMaterial);
    this.propModels = new PropModels(this.scene, basic, this.glowMaterial);
    const figureMats = figureMaterials();
    this.figures = new Figures(this.scene, figureMats);
    this.markMesh = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true }), 900);
    this.flames = this.instanced("flame", new MeshBasicMaterial({ vertexColors: true }), 5000);
    this.puffs = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }), 4000);
    // Smoke, steam and a bolt's halo write no depth: drawn after the water
    // (renderOrder 2), or the water covers the part in front of it.
    this.puffs.renderOrder = 3;
    this.glowTexture = glowTexture();
    this.glowPoints = pointCloud(world.particles.capacity, true, this.glowTexture);
    this.dullPoints = pointCloud(world.particles.capacity, false, this.glowTexture);
    this.scene.add(this.glowPoints, this.dullPoints);
    this.clouds = this.makeClouds();
    this.rainShafts = new InstancedMesh(
      geometryOf(MODELS.puff),
      new MeshBasicMaterial({ color: 0xc4d2e4, transparent: true, opacity: 0.2, depthWrite: false }),
      80,
    );
    this.rainShafts.frustumCulled = false;
    this.rainShafts.count = 0;
    this.scene.add(this.rainShafts);
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
    this.boltHalo.renderOrder = 3;
    this.sky = new Sky(this.scene, world, this.glowTexture);
    this.farRoads = farRoadMesh(this.farWide);
    this.scene.add(this.farRoads);
    this.plumes = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.68, depthWrite: false }), 1200);
    this.plumes.renderOrder = 3;
    this.plumes.visible = false;
    this.lit = [
      land,
      fluid,
      basic,
      this.puffs.material as MeshBasicMaterial,
      this.clouds.material as MeshBasicMaterial,
      figureMats.lit,
      this.farRoads.material as MeshBasicMaterial,
      this.plumes.material as MeshBasicMaterial,
    ];
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

  // Set by the engine before each frame (2026-11-07): how far the frame is
  // from the last tick to the next (0 to 1; 1 draws creatures where the
  // simulation has them), and the time between frames it aims for.
  between = 1;
  paceMs = 1000 / 30;
  // A cast changed the land outside a tick (Engine.cast).
  landChanged = true;
  // The roads the pegs were placed for (4.9).
  private roadsDrawn = -1;
  private sitesDrawn = -1;
  private scannedAt = NaN;

  render(visuals: Visuals, time: number, dt: number, reducedMotion: boolean): void {
    const started = performance.now();
    this.lapAt = started;
    const { world } = this;
    if (this.orbit.eye) this.placeEye();
    this.orbit.update(dt, time, this.groundAt, reducedMotion);
    // Nothing of the map in the eye view.
    this.cover = this.orbit.eye ? 0 : coverOf(this.orbit.visibleRadius(), world);
    refreshMap(world, this.map);
    // The land changes only in a tick or a cast: a frame between two ticks
    // does not compare every column again (3.5 ms a frame on a large island).
    if (this.landChanged || time !== this.scannedAt) {
      this.landChanged = false;
      this.scannedAt = time;
      this.terrain.scan();
    }
    this.terrain.rebuild(this.firstBuild);
    this.firstBuild = false;
    this.lap("terrain");
    if ((this.terrain.coversChanged || this.roadsDrawn !== world.roadsVersion || this.sitesDrawn !== world.sitesVersion) && time - this.lastCovers > 0.25) {
      this.terrain.coversChanged = false;
      this.lastCovers = time;
      this.placeCovers();
    }
    this.placeNearTrees();
    this.lap("covers");
    if (world.wonders.length) this.wonderModels.update(world, time);
    this.propModels.update(world, this.groundAt);
    if (world.decorVersion !== this.decorVersion) {
      this.decorVersion = world.decorVersion;
      this.placeDecor(time);
    }
    this.lap("decor");
    this.placeCreatures(time);
    this.lap("creatures");
    this.placeFireAndGas(time);
    this.placeParticles();
    this.placeMap(LAB_SKY.time ?? time);
    this.placeBodies(visuals, time);
    this.placeBolts(visuals);
    this.placeRingsAndLights(visuals);
    this.domes.update(world, world.time, (x, y, h) => this.toScene(x, y, h), this.groundAt);
    this.lap("effects");
    this.paintDecal(visuals);
    this.moveClouds(LAB_SKY.time ?? time);
    this.applyDaylight(LAB_SKY.time ?? time, visuals.darknessLevel(), visuals);
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

  // The Perf Lab pins the pixel density, so two runs draw the same pixels (4.4).
  fixedPixelRatio: number | null = null;

  // Lower the pixel density when frames are slow, raise it back when they are fast.
  private adapt(ms: number, dt: number): void {
    if (this.fixedPixelRatio !== null) {
      if (this.pixelRatio !== this.fixedPixelRatio) {
        this.pixelRatio = this.fixedPixelRatio;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(this.cssW, this.cssH, false);
      }
      return;
    }
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
    // within 10 s of a drop, so it does not see-saw. At 60 a second
    // (pacing.ts) a missed cadence first falls back to 30, so only the draw
    // time lowers the pixels there; the way back up needs the same room.
    const now = performance.now();
    const fast = this.paceMs < 25;
    let next = this.pixelRatio;
    if ((!fast && avg > 52) || draw > 30) {
      next = Math.max(0.6, this.pixelRatio - 0.25);
      this.droppedAt = now;
    } else if (avg < (fast ? 19 : 38) && draw < 12 && now - this.droppedAt > 10_000) next = Math.min(max, this.pixelRatio + 0.25);
    if (next !== this.pixelRatio) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(this.cssW, this.cssH, false);
    }
  }

  private toScene(x: number, y: number, h: number): Vector3 {
    return this.v.set(x - this.world.w / 2, h, y - this.world.h / 2);
  }

  private coverMesh(key: string, need: number): InstancedMesh {
    const mesh = this.covers.get(key);
    if (mesh && need <= mesh.instanceMatrix.count) return mesh;
    const boxes = MODELS[key] ?? FLORA_MODELS[key] ?? MODELS.block;
    const geometry = mesh ? mesh.geometry : geometryOf(boxes);
    const bigger = new InstancedMesh(geometry, GLOWING.has(key) ? this.glowMaterial : this.coverMaterial, Math.max(64, Math.ceil(need * 1.5)));
    withColors(bigger);
    bigger.count = 0;
    bigger.frustumCulled = false;
    if (mesh) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.scene.add(bigger);
    this.covers.set(key, bigger);
    return bigger;
  }

  // The model a cover is drawn with in this cell.
  private coverKey(i: number, c: number, trees: [string, string] | null, builtinCovers: number): string {
    const { world } = this;
    if (c >= builtinCovers) return world.materials.get("cover", c).solid ? "block" : "slab";
    if (c === C.TREE) {
      // 4.4.5: the cell's own tree, one of its style's shapes.
      const style = world.flora ? TREE_STYLES[world.flora[i] & STYLE_BITS] : "";
      if (style) return `tree:${style}:${cellHash(i) % VARIANTS}`;
      const high = world.shade[i] % 3 === 0 || world.height[i] > 20;
      const own = world.biomeMap ? LOOKS[biomeAt(world, i)].trees : trees;
      return own ? own[high ? 1 : 0] : high ? "pine" : "tree";
    }
    if (c === C.HOUSE) {
      const style = this.houseStyle(i);
      return style && style !== "timber" ? `house-${style}` : "house";
    }
    if (world.flora) {
      if (c === C.FLOWER) return "bloom";
      if (c === C.FUNGI && world.rare?.[i] === RARE.GLOWWOOD) return "fungi-glow";
    }
    if (c === C.FENCE) {
      const x = i % world.w;
      const along = (x > 0 && world.cover[i - 1] === C.FENCE) || (x < world.w - 1 && world.cover[i + 1] === C.FENCE);
      return along ? "fence-x" : "fence-z";
    }
    if (c === C.BRIDGE) {
      // Along the way it carries: the side with more bridge or road.
      const x = i % world.w;
      const way = (j: number) => j >= 0 && j < world.n && (world.cover[j] === C.BRIDGE || world.ground[j] === G.ROAD);
      const ex = (x > 0 && way(i - 1) ? 1 : 0) + (x < world.w - 1 && way(i + 1) ? 1 : 0);
      const ez = (way(i - world.w) ? 1 : 0) + (way(i + world.w) ? 1 : 0);
      return ez > ex ? "bridge-z" : "bridge-x";
    }
    return world.materials.get("cover", c).name;
  }

  // A house's look: its village's (4.4.5), the nearest one within reach.
  private houseStyle(i: number): string | null {
    const list = this.world.settlements;
    if (!list.length) return null;
    const x = i % this.world.w;
    const y = Math.floor(i / this.world.w);
    let best = -1;
    let bestD = 40;
    for (let k = 0; k < list.length; k++) {
      const d = Math.abs(list[k].x - x) + Math.abs(list[k].y - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best >= 0 ? HOUSE_STYLES[list[best].style] : null;
  }

  private placeCovers(): void {
    const { world } = this;
    const lists = new Map<string, number[]>();
    for (const key of this.covers.keys()) lists.set(key, []);
    const add = (key: string, i: number) => {
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      list.push(i);
    };
    const builtinCovers = BUILTIN.cover.length;
    // A biome draws its own trees (4.4), a mixed island each region's
    // (4.4.1); the island before 4.4, oaks and pines; since 4.4.5 each
    // cell its own.
    const trees = world.land ? LOOKS[world.land.biome].trees : null;
    const flora = world.flora;
    // Villages of 4.4.5 part B: houses and buildings drawn whole, each its own.
    const whole = world.settlements.length || world.sites.length ? this.buildings.update(world) : null;
    for (let i = 0; i < world.n; i++) {
      const c = world.cover[i];
      if (whole?.has(i) || c === C.WONDER) continue;
      if (c === C.NONE) {
        if (!flora) continue;
        // Tufts of grass on open ground, lily pads on still water (4.4.5).
        if (world.fluid[i] === FLUID.WATER) {
          if (flora[i] & DAMP && world.depth[i] > 0.1 && world.depth[i] < 1.5 && LILY_LANDS.has(biomeAt(world, i))) add("lily", i);
        } else if (world.ground[i] === 0 && world.depth[i] === 0 && cellHash(i) % 100 < 2) add("tuft", i);
        continue;
      }
      add(this.coverKey(i, c, trees, builtinCovers), i);
    }
    // 4.9: pegs every few cells along a road marked out and not laid yet.
    for (const r of world.roads)
      for (let k = 2; k < r.cells.length - 1; k += 4) {
        const i = r.cells[k];
        if (world.cover[i] === C.NONE && world.depth[i] <= 0.3 && !laid(world, r, k)) add("road-peg", i);
      }
    this.roadsDrawn = world.roadsVersion;
    this.sitesDrawn = world.sitesVersion;
    this.houseCells = [];
    for (const [key, cells] of lists) if (key === "house" || key.startsWith("house-")) for (const i of cells) this.houseCells.push(i);
    const m = this.m;
    this.treeSlots.clear();
    this.treeKeys = [];
    this.coversDrawn++;
    for (const [key, cells] of lists) {
      if (!cells.length && !this.covers.has(key)) continue;
      const mesh = this.coverMesh(key, cells.length);
      // A tree of the flora kit has boxes drawn over it near the eye (near.ts).
      const slot = key.startsWith("tree:") ? this.treeKeys.push(key) - 1 : -1;
      if (slot >= 0) for (let k = 0; k < cells.length; k++) this.treeSlots.set(cells[k], slot * 0x100000 + k);
      const tree =
        key.startsWith("tree") || key === "pine" || key === "palm" || key === "snowpine" || key === "jungle" || key === "willow" || key === "juniper";
      const house = key === "house" || key.startsWith("house-");
      const tinted = key === "block" || key === "slab" || key === "tuft" || key === "bloom";
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const x = i % world.w;
        const y = Math.floor(i / world.w);
        const h = cellHash(i);
        let base = columnTop(world, i);
        if (key === "lily") base = surfaceY(world, i) + 0.01;
        else if (key === "dock") base = Math.max(base, surfaceY(world, i)) - 0.24;
        else if (key === "bridge-x" || key === "bridge-z") base = world.walkLevel(i) * V - 0.3;
        const p = this.toScene(x + 0.5, y + 0.5, base);
        if (house || key === "bridge-x" || key === "bridge-z") {
          m.makeTranslation(p.x - 0.5, p.y, p.z - 0.5);
        } else if (tree && flora) {
          // Every tree its own (4.4.5): height, girth, a lean and a turn.
          const old = flora[i] & HEART ? 1.3 : 1;
          const sh = (0.82 + (((h >> 3) % 32) / 32) * 0.4) * old;
          const sw = (0.86 + (((h >> 8) % 32) / 32) * 0.26) * old;
          const lean = (((h >> 13) % 32) / 32) * 0.1;
          const dir = (((h >> 18) % 64) / 64) * Math.PI * 2;
          placeLeaning(m, p, (h >> 1) % 4, sw, sh, lean, dir);
        } else {
          // A little size and turn variety so forests do not look stamped.
          const s = 0.85 + (world.shade[i] % 7) * 0.04;
          placeLeaning(m, p, (world.shade[i] >> 2) % 4, s, s, 0, 0);
        }
        mesh.setMatrixAt(k, m);
        if (tinted) {
          if (key === "tuft") mesh.setColorAt(k, this.col.setHex(scaleHex(this.groundColor(i), 0.78)));
          else if (key === "bloom") mesh.setColorAt(k, this.col.setHex(driftColor(x, y, world.seed)));
          else {
            const mat = world.materials.get("cover", world.cover[i]);
            mesh.setColorAt(k, this.col.setHex(mat.colors[world.shade[i] % mat.colors.length]));
          }
        } else if (tree && flora) {
          // A tint within the kind: lighter, darker, a touch warmer or cooler.
          const t = 0.9 + (((h >> 23) % 16) / 16) * 0.18;
          const warm = ((((h >> 27) % 8) - 3.5) / 3.5) * 0.04;
          mesh.setColorAt(k, this.col.setRGB(t * (1 + warm), t, t * (1 - warm)));
        }
      }
      mesh.count = cells.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.coverCounts.set(key, cells.length);
    }
  }

  // In the eye view, the trees within NEAR_CELLS of the eye are drawn with their near model
  // (near.ts) in place of their own, placed and tinted as they were; their own instance is folded to
  // nothing meanwhile. Again only when the eye enters another cell or the covers change. From the
  // sky, none: every tree is its own model, at its own cost.
  private placeNearTrees(): void {
    const eye = this.orbit.eye;
    const { world } = this;
    const at = eye ? Math.floor(eye.y) * world.w + Math.floor(eye.x) : -1;
    if (at === this.nearAt && this.nearDrawn === this.coversDrawn) return;
    // The trees near the eye before put back as they were, unless the covers were placed again since.
    if (this.nearDrawn === this.coversDrawn)
      for (const [key, slots] of this.nearSlots) {
        const base = this.covers.get(key);
        const mesh = this.nearMeshes.get(key);
        if (!base || !mesh) continue;
        for (let n = 0; n < slots.length; n++) {
          mesh.getMatrixAt(n, this.m);
          base.setMatrixAt(slots[n], this.m);
        }
        if (slots.length) base.instanceMatrix.needsUpdate = true;
      }
    this.nearSlots.clear();
    this.nearAt = at;
    this.nearDrawn = this.coversDrawn;
    const lists = new Map<string, number[]>();
    for (const key of this.nearMeshes.keys()) lists.set(key, []);
    if (eye) {
      const ex = Math.floor(eye.x);
      const ey = Math.floor(eye.y);
      const R = NEAR_CELLS;
      for (let y = Math.max(0, ey - R); y <= Math.min(world.h - 1, ey + R); y++)
        for (let x = Math.max(0, ex - R); x <= Math.min(world.w - 1, ex + R); x++) {
          if ((x - ex) * (x - ex) + (y - ey) * (y - ey) > R * R) continue;
          const slot = this.treeSlots.get(y * world.w + x);
          if (slot === undefined) continue;
          const key = this.treeKeys[Math.floor(slot / 0x100000)];
          let list = lists.get(key);
          if (!list) lists.set(key, (list = []));
          list.push(slot % 0x100000);
        }
    }
    for (const [key, slots] of lists) {
      let mesh = this.nearMeshes.get(key);
      const base = this.covers.get(key);
      if (!base) continue;
      if (!mesh || slots.length > mesh.instanceMatrix.count) {
        if (!slots.length) continue;
        const boxes = nearTreeModel(key.split(":")[1] as TreeStyle, FLORA_MODELS[key] ?? []);
        const geometry = mesh ? mesh.geometry : geometryOf(boxes);
        const bigger = new InstancedMesh(geometry, base.material, Math.max(32, Math.ceil(slots.length * 1.5)));
        withColors(bigger);
        bigger.frustumCulled = false;
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
        }
        this.scene.add(bigger);
        this.nearMeshes.set(key, (mesh = bigger));
      }
      for (let n = 0; n < slots.length; n++) {
        base.getMatrixAt(slots[n], this.m);
        mesh.setMatrixAt(n, this.m);
        base.setMatrixAt(slots[n], FOLDED);
        if (base.instanceColor) {
          base.getColorAt(slots[n], this.col);
          mesh.setColorAt(n, this.col);
        }
      }
      if (slots.length) base.instanceMatrix.needsUpdate = true;
      this.nearSlots.set(key, slots);
      mesh.count = slots.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // The glowing shore (4.4.5): specks of blue light twinkle in its shallows
  // at night.
  private placeSparks(time: number, night: number): void {
    const { world } = this;
    if (!this.shoreCells) {
      this.shoreCells = [];
      for (let i = 0; i < world.n && this.shoreCells.length < 1500; i++)
        if (world.rare![i] === RARE.SHORE && world.fluid[i] === FLUID.WATER) this.shoreCells.push(i);
      if (!this.shoreCells.length) return;
      this.sparks = new InstancedMesh(geometryOf(FLORA_MODELS.spark), this.glowMaterial, this.shoreCells.length);
      withColors(this.sparks);
      this.sparks.frustumCulled = false;
      this.scene.add(this.sparks);
    }
    const sparks = this.sparks;
    if (!sparks) return;
    let n = 0;
    if (night > 0.2) {
      for (const i of this.shoreCells) {
        if (world.fluid[i] !== FLUID.WATER) continue;
        const h = cellHash(i);
        const glow = Math.sin(time * (0.8 + (h % 7) * 0.2) + (h % 100)) * 0.5 + 0.5;
        if (glow < 0.35) continue;
        const x = i % world.w;
        const y = Math.floor(i / world.w);
        const p = this.toScene(x + 0.2 + ((h >> 4) % 6) / 10, y + 0.2 + ((h >> 8) % 6) / 10, surfaceY(world, i) + 0.02);
        const s = 0.12 + glow * 0.16;
        this.m.makeScale(s, 0.4, s);
        this.m.setPosition(p.x, p.y, p.z);
        sparks.setMatrixAt(n, this.m);
        const k = glow * Math.min(1, night * 1.5);
        sparks.setColorAt(n, this.col.setRGB(0.25 * k, 0.85 * k, 1.0 * k));
        n++;
      }
    }
    sparks.count = n;
    sparks.instanceMatrix.needsUpdate = true;
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
  }

  // A cell's ground color as the terrain draws it, for tufts of grass.
  private groundColor(i: number): number {
    const { world } = this;
    const m = world.materials.get("ground", world.ground[i]);
    const colors =
      world.biomeMap && world.ground[i] < BUILTIN.ground.length
        ? (LOOKS[biomeAt(world, i)].palette[m.name] ?? BUILTIN.ground[world.ground[i]].colors)
        : m.colors;
    return colors[world.shade[i] % colors.length];
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
    // Sun, moon, stars and the weather (4.4): rain and fog grey the day and
    // bring the fog in.
    const o = this.orbit;
    const target = this.toScene(o.tx, o.ty, this.groundAt(o.tx, o.ty));
    this.sky.dropsFrom = o.eye ? 2.5 : 0;
    this.sky.update(time, day.night, o.camera, target, o.dist, this.pixelRatio);
    this.waveTime.value = time;
    const grey = this.sky.overcast;
    const fogK = this.sky.fog;
    const dim = 1 - grey;
    for (const m of this.lit) m.color.setRGB(day.r * dim, day.g * dim, day.b * dim);
    this.lightTheDark(Math.min(0.95, dark), visuals);
    // The sky is repainted only when it changes by a visible step.
    const shade = Math.round(Math.min(0.95, dark) * 20) / 20;
    const cloud = Math.round(Math.min(1, Math.max(grey * 2.4, fogK * 0.75)) * 20) / 20;
    const tone = (c: string) => {
      let v = parseInt(c.slice(1), 16);
      if (cloud) v = mixColor(v, mixColor(0x8a949e, NIGHT_SKY, day.night * 0.8), cloud);
      if (shade) v = mixColor(v, NIGHT_SKY, shade);
      return hexColor(v);
    };
    const top = tone(day.skyTop);
    const low = tone(day.skyLow);
    const fogStep = Math.round(fogK * 20) / 20;
    const key = top + low + fogStep;
    if (key !== this.skyKey) {
      this.skyKey = key;
      paintSky(this.skyCanvas, top, low);
      (this.scene.background as CanvasTexture).image = this.skyCanvas;
      (this.scene.background as CanvasTexture).needsUpdate = true;
      (this.scene.fog as Fog).color.set(fogStep ? hexColor(mixColor(parseInt(low.slice(1), 16), 0xc4c8cc, fogStep * 0.6)) : low);
    }
    // The mist moves back with the camera, so the island keeps its colours
    // when zoomed out (fog.ts).
    const range = o.eye ? eyeFogRange(fogStep) : fogRange(Math.max(this.world.w, this.world.h), o.dist, fogStep);
    const fog = this.scene.fog as Fog;
    fog.near = range.near;
    fog.far = range.far;
    let n = 0;
    const lights = this.world.settlements.length ? this.buildings.lights : null;
    // As many windows lit as the village has people (map.ts): a village that lost its people goes dark.
    const lit = this.markLit(lights?.windows ?? []);
    if (day.night > 0.15 && lights) {
      const glow = 0.4 + 0.6 * day.night;
      for (let k = 0; k < lights.windows.length; k++) {
        const w = lights.windows[k];
        if (n >= 4096) break;
        if (!lit[k]) continue;
        const flicker = 0.85 + 0.15 * Math.sin(time * 3 + w.x * 7 + w.z);
        if (w.axis === 0) this.m.makeScale(0.17, 0.15, 0.04);
        else this.m.makeScale(0.04, 0.15, 0.17);
        this.m.setPosition(w.x, w.y, w.z);
        this.windows.setMatrixAt(n, this.m);
        this.windows.setColorAt(n, this.col.setRGB(glow * flicker, glow * 0.78 * flicker, glow * 0.35));
        n++;
      }
    }
    if (day.night > 0.15) {
      const glow = 0.4 + 0.6 * day.night;
      const off = lights?.windows.length ?? 0;
      for (let k = 0; k < this.houseCells.length; k++) {
        const i = this.houseCells[k];
        if (n >= 4096) break;
        if (!lit[off + k]) continue;
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
    if (this.world.rare) this.placeSparks(time, day.night);
    this.windows.instanceMatrix.needsUpdate = true;
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    // Chimney smoke: a puff now and then from a random chimney (4.4.5 part B)
    // or house.
    const chimneys = lights?.chimneys ?? [];
    if (chimneys.length && Math.random() < Math.min(0.6, chimneys.length / 25)) {
      const ch = chimneys[(Math.random() * chimneys.length) | 0];
      this.world.particles.add({
        x: ch.x,
        y: ch.z,
        z: ch.y + 0.2,
        vz: 1.2,
        vx: this.world.wind.x * 0.6,
        vy: this.world.wind.y * 0.6,
        life: 2.5,
        color: 0xd8d4cc,
        size: 1.4,
        drag: 0.4,
        gravity: -0.3,
      });
    } else if (!lights && this.houseCells.length && Math.random() < Math.min(0.6, this.houseCells.length / 60)) {
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

  // Which windows are lit: in each village, the share its people fill (two to a house, map.ts),
  // chosen by a hash of the window so the same ones stay lit. Windows far from any village stay lit.
  // Again only when the map is read again (every 3 s) or the buildings are placed again.
  private markLit(windows: { x: number; z: number }[]): Uint8Array {
    const { world } = this;
    const total = windows.length + this.houseCells.length;
    if (this.litFor === windows && this.litMapped === this.map.version && this.litMask.length === total) return this.litMask;
    this.litFor = windows;
    this.litMapped = this.map.version;
    if (this.litMask.length !== total) this.litMask = new Uint8Array(total);
    const villages = this.map.villages;
    const share = (x: number, y: number): number => {
      let best = 1;
      let bestD = 22;
      for (const v of villages) {
        const d = Math.hypot(v.x - x, v.y - y);
        if (d < bestD) {
          bestD = d;
          best = v.lit;
        }
      }
      return best;
    };
    for (let k = 0; k < windows.length; k++) {
      const x = windows[k].x + world.w / 2;
      const y = windows[k].z + world.h / 2;
      this.litMask[k] = (cellHash(Math.floor(y) * world.w + Math.floor(x) + k * 7919) % 1000) / 1000 < share(x, y) ? 1 : 0;
    }
    for (let k = 0; k < this.houseCells.length; k++) {
      const i = this.houseCells[k];
      this.litMask[windows.length + k] = (cellHash(i) % 1000) / 1000 < share(i % world.w, Math.floor(i / world.w)) ? 1 : 0;
    }
    return this.litMask;
  }

  // The island as a map, drawn from far (map.ts): the roads wide and pale, a glow over each lit
  // window at night, dust over what is being built and smoke over what burnt by day. None of it
  // near (the island as it was), none in the eye view.
  private placeMap(time: number): void {
    const { world, map } = this;
    const night = daylight(time).night;
    // Roads: the same cells as the real ones, placed again only when the map is read again.
    const wide = fade(this.cover, FAR.roads);
    this.farRoads.visible = wide > 0.01 && map.roads.length > 0;
    if (this.farRoads.visible && this.roadsMapped !== map.version) {
      this.roadsMapped = map.version;
      const mesh = this.ensureCapacity(map.roads.length);
      for (let k = 0; k < map.roads.length; k++) {
        const i = map.roads[k];
        const deck = world.cover[i] === C.BRIDGE ? world.walkLevel(i) * V : columnTop(world, i);
        const p = this.toScene((i % world.w) + 0.5, Math.floor(i / world.w) + 0.5, deck);
        this.m.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(k, this.m);
      }
      mesh.count = map.roads.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    // A road two and a half cells wide from the whole island, raised clear of the ground's steps.
    this.farWide.value = wide * 2.6;
    // Glows: over the lit windows, larger the farther the camera, as many as the village's people light.
    const glow = fade(this.cover, FAR.glows) * Math.max(0, (night - 0.15) / 0.85);
    const lights = world.settlements.length ? this.buildings.lights : null;
    if (glow > 0.01 && lights) {
      const geo = this.glowPoints.geometry;
      const pos = geo.getAttribute("position") as BufferAttribute;
      const col = geo.getAttribute("color") as BufferAttribute;
      const size = geo.getAttribute("size") as BufferAttribute;
      let n = geo.drawRange.count;
      const lit = this.markLit(lights.windows);
      const s = 2.5 + 7 * glow;
      for (let k = 0; k < lights.windows.length && n < pos.count; k++) {
        // One in two lit windows: a house is a glow, not a dozen.
        if (!lit[k] || k % 2) continue;
        const w = lights.windows[k];
        pos.setXYZ(n, w.x, w.y + 0.6, w.z);
        col.setXYZW(n, 1, 0.7, 0.32, 0.55 * glow);
        size.setX(n, s);
        n++;
      }
      geo.setDrawRange(0, n);
      pos.needsUpdate = true;
      col.needsUpdate = true;
      size.needsUpdate = true;
    }
    // Plumes: three puffs rising over each, by day, larger from far.
    const far = fade(this.cover, FAR.plumes) * Math.max(0, 1 - night * 1.4);
    let n = 0;
    if (far > 0.01) {
      const s = 0.8 + 4 * far;
      for (const pl of map.plumes) {
        if (n + 3 > this.plumes.instanceMatrix.count) break;
        const i = Math.max(0, Math.min(world.n - 1, Math.floor(pl.y) * world.w + Math.floor(pl.x)));
        const base = columnTop(world, i) + 1.2;
        const h = cellHash(i);
        for (let j = 0; j < 3; j++) {
          const t = (time * (pl.kind === "smoke" ? 0.22 : 0.3) + j / 3 + (h % 100) / 100) % 1;
          const r = s * (0.55 + t * 0.9);
          const p = this.toScene(pl.x + world.wind.x * t * 3, pl.y + world.wind.y * t * 3, base + (0.3 + t * 3.2) * s);
          this.m.makeScale(r, r * 0.8, r);
          this.m.setPosition(p.x, p.y, p.z);
          this.plumes.setMatrixAt(n, this.m);
          this.plumes.setColorAt(n, this.col.setHex(pl.kind === "smoke" ? 0x3d3734 : 0xf6eedb));
          n++;
        }
      }
    }
    this.plumes.count = n;
    this.plumes.visible = n > 0;
    this.plumes.instanceMatrix.needsUpdate = true;
    if (this.plumes.instanceColor) this.plumes.instanceColor.needsUpdate = true;
  }

  private ensureCapacity(need: number): InstancedMesh {
    if (this.farRoads.instanceMatrix.count >= need) return this.farRoads;
    const bigger = new InstancedMesh(this.farRoads.geometry, this.farRoads.material, Math.ceil(need * 1.5));
    bigger.frustumCulled = false;
    this.scene.remove(this.farRoads);
    this.farRoads.dispose();
    this.scene.add(bigger);
    this.farRoads = bigger;
    return bigger;
  }

  // The names over the villages (map.ts), lettered as on a map, on the overlay: from far only,
  // never over each other or the story line, none while the tour's card is up or in the eye view.
  private drawNames(ctx: CanvasRenderingContext2D): void {
    const alpha = this.mapHide.all ? 0 : fade(this.cover, FAR.names);
    if (alpha <= 0.01) return;
    const villages = this.map.villages;
    const cam = this.orbit.camera;
    const { world } = this;
    // A little larger on a wide screen, where the island is larger too.
    const big = this.cssW >= 1000 ? 1.3 : this.cssW >= 600 ? 1.12 : 1;
    const fonts = villages.map((v) => {
      const L = LETTERING[v.tier];
      return `${L.italic ? "italic " : ""}${L.weight} ${Math.round(L.px * big * 2) / 2}px Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif`;
    });
    const labels: Label[] = nameLabels(
      villages,
      (v) => {
        const i = Math.max(0, Math.min(world.n - 1, Math.round(v.y) * world.w + Math.round(v.x)));
        const p = this.toScene(v.x + 0.5, v.y + 0.5, columnTop(world, i) + 2).project(cam);
        return { x: ((p.x + 1) / 2) * this.cssW, y: ((1 - p.y) / 2) * this.cssH, behind: p.z > 1 };
      },
      (v) => {
        const L = LETTERING[v.tier];
        const font = fonts[villages.indexOf(v)];
        const text = L.caps ? v.name.toUpperCase() : v.name;
        const key = `${font}|${text}`;
        let w = this.nameWidths.get(key);
        if (w === undefined) {
          ctx.font = font;
          ctx.letterSpacing = `${L.spacing}px`;
          w = ctx.measureText(text).width;
          this.nameWidths.set(key, w);
        }
        return w;
      },
      big,
    );
    const shown = placeNames(labels, nameOrder(villages), { w: this.cssW, h: this.cssH }, this.mapHide.blocked);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    villages.forEach((v, k) => {
      if (!shown[k]) return;
      const L = LETTERING[v.tier];
      const text = L.caps ? v.name.toUpperCase() : v.name;
      ctx.font = fonts[k];
      ctx.letterSpacing = `${L.spacing}px`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(24, 17, 30, 0.82)";
      ctx.strokeText(text, labels[k].x, labels[k].y);
      ctx.fillStyle = "#fff2cf";
      ctx.fillText(text, labels[k].x, labels[k].y);
    });
    ctx.restore();
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

  // Through its eyes (2026-11-12, eyes.ts): the creature the player sees
  // from, which is not drawn while the camera is at its head.
  eyeId = -1;

  // The eye at its head, where the creature is drawn this frame (between two
  // ticks, on the ground as its feet are eased up and down steps).
  private placeEye(): void {
    const { world } = this;
    const c = world.creatures.find((o) => o.id === this.eyeId);
    if (!c) return;
    const k = kindOf(c);
    const rig = this.rigFor(c, k);
    const size = drawScale(k.body, k.radius, rig, c.size);
    const g = this.gaits.get(c.id);
    const a = this.between;
    const x = g ? g.px + (c.x - g.px) * a : c.x;
    const y = g ? g.py + (c.y - g.py) * a : c.y;
    const ground = g && Number.isFinite(g.gy) ? g.gy : walkGround(world, x, y);
    // Eyes sit a little under the top of the head (a hat or antlers above them),
    // kept clear of walls, trunks and steps of ground (eyes.ts clearEye): pressed
    // to a cliff or a house the view was one flat colour (the playtest of 12 November).
    const e = clearEye(x, y, ground + c.z + Math.max(0.35, rig.height * size * 0.88), this.groundAt, this.solidCell);
    this.orbit.eyeAt(e.x, e.y, e.h);
    this.eyeCell.x = e.x;
    this.eyeCell.y = e.y;
  }

  // Where the eye is, in cells, for hiding what stands right against it.
  private eyeCell = { x: NaN, y: NaN };

  // A wall or a trunk in the cell (cx, cy): what a walker cannot enter (paths.ts solidCovers).
  solidCell = (cx: number, cy: number): boolean => {
    const { world } = this;
    if (cx < 0 || cy < 0 || cx >= world.w || cy >= world.h) return false;
    return solidCovers(world)[world.cover[cy * world.w + cx]] === 1;
  };

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
      // Sized against a villager and a house (3.7, rigs.ts), not from the
      // simulation's radius, which is a creature's reach.
      const size = drawScale(k.body, k.radius, rig, c.size);
      const i = Math.max(0, Math.min(world.w - 1, Math.floor(c.x))) + Math.max(0, Math.min(world.h - 1, Math.floor(c.y))) * world.w;
      let g = this.gaits.get(c.id);
      if (!g) {
        g = {
          x: c.x,
          y: c.y,
          px: c.x,
          py: c.y,
          t: time,
          speed: 0,
          phase: c.id,
          pphase: c.id,
          yaw: Math.atan2(Math.cos(c.hd), Math.sin(c.hd)),
          pyaw: Math.atan2(Math.cos(c.hd), Math.sin(c.hd)),
          seen: frame,
          gy: NaN,
          vy: 0,
          gt: time,
          graze: 0,
          lie: 0,
          look: 0,
        };
        this.gaits.set(c.id, g);
      }
      g.seen = frame;
      // The stride comes from how far it moved since the last tick; the
      // heading is the simulation's own (4.3, steer.ts), which turns at the
      // creature's pace and on the spot before it walks off the other way.
      const walking = k.speed * Math.sqrt(c.size);
      if (time > g.t) {
        const dt = time - g.t;
        g.px = g.x;
        g.py = g.y;
        g.pphase = g.phase;
        g.pyaw = g.yaw;
        const dx = c.x - g.x;
        const dy = c.y - g.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) {
          // A jump (a teleport, a spawn far off): drawn there at once.
          g.speed = 0;
          g.px = c.x;
          g.py = c.y;
        } else {
          g.speed += (d / dt - g.speed) * Math.min(1, dt * 8);
          if (!c.dead) {
            let turn = Math.atan2(Math.cos(c.hd), Math.sin(c.hd)) - g.yaw;
            turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            g.yaw += turn * Math.min(1, dt * 14);
          }
          g.phase += Math.min(g.speed, 12) * dt * strideRate(gaitOf(g.speed, walking), size);
        }
        // Standing: head down to its food or work, lying down, looking round.
        const idle = c.dead ? undefined : (c.data.idle as string | undefined);
        const ease = Math.min(1, dt * 3);
        g.graze += ((idle === "graze" ? 1 : 0) - g.graze) * ease;
        g.lie += ((idle === "lie" && !k.flying && !k.aquatic ? 1 : 0) - g.lie) * Math.min(1, dt * 1.5);
        g.look += ((idle === "look" ? 1 : 0) - g.look) * ease;
        g.x = c.x;
        g.y = c.y;
        g.t = time;
      }
      // Part way from the last tick to this one: 1 at a tick, or without
      // GRAPHICS.smooth (the engine's between).
      const a = this.between;
      const rx = g.px + (c.x - g.px) * a;
      const ry = g.py + (c.y - g.py) * a;
      const yaw = g.pyaw + Math.atan2(Math.sin(g.yaw - g.pyaw), Math.cos(g.yaw - g.pyaw)) * a;
      const phase = g.pphase + (g.phase - g.pphase) * a;

      // Fish swim under the surface, also under ice (a frozen lake: they used
      // to be drawn standing on it, as if on land); a dead one floats. The
      // rest walk up and down the island's steps instead of jumping between
      // levels (walk.ts).
      const underwater = k.aquatic && !c.dead && world.depth[i] > 0.3 && (world.fluid[i] === FLUID.WATER || world.fluid[i] === FLUID.ICE);
      const ground = underwater ? this.groundAt(rx, ry) : easeGround(g, walkGround(world, rx, ry), time - (1 - a) * TICK);
      const y = underwater ? ground - Math.min(0.7, world.depth[i] * 0.5) - size * 0.15 : ground + c.z;
      const p = this.toScene(rx, ry, y);
      this.sphere.center.set(p.x, p.y + rig.height * size * 0.5, p.z);
      this.sphere.radius = Math.max(rig.height, 1.4) * size;
      // The one the player sees from is not drawn: its own head would fill the view.
      // Nor anyone closer than a cell to the eye: a face or a back filled the screen.
      if (this.orbit.eye && (c.id === this.eyeId || Math.hypot(rx - this.eyeCell.x, ry - this.eyeCell.y) < 1.1)) continue;
      const seen = this.frustum.intersectsSphere(this.sphere);

      // The mark over its head, then the figure, when the camera sees it.
      // The creature the player inspects wears a white mark (3.6).
      const mood = c.dead ? null : c.data.inspected ? "inspected" : (c.data.mood as string | null | undefined);
      if (mood && marks < 900 && seen) {
        const color = mood === "carry" ? ((c.data.carry as number | undefined) ?? 0xffd36a) : (MOOD_COLORS[mood] ?? 0xffffff);
        const s = Math.max(0.22, size * 0.28) * (mood === "lured" || mood === "angry" ? 0.9 + 0.2 * Math.sin(time * 8 + c.id) : 1);
        this.m.makeScale(s, s, s);
        this.m.setPosition(p.x, p.y + rig.height * size + s * 1.4, p.z);
        this.markMesh.setMatrixAt(marks, this.m);
        this.markMesh.setColorAt(marks, this.col.setHex(color));
        marks++;
      }
      // A villager on a market trip pulls a cart (map.ts onTrip): larger from far, so the roads move. None in the eye view.
      if (marks + 5 <= 900 && !this.orbit.eye && onTrip(c)) {
        const s = 1 + 2.6 * fade(this.cover, FAR.carts);
        marks = this.placeCart(marks, rx, ry, ground, c.hd, s, c.mind?.carry === "food" ? 0xe8c25a : 0xb4483a);
      }
      if (!seen) continue;
      const still = c.dead || c.frozen > 0 || c.stun > 0;
      const asleep = c.sleep > 0 || c.data.mood === "asleep";
      pose.x = p.x;
      pose.y = p.y;
      pose.z = p.z;
      pose.yaw = yaw;
      pose.scale = size;
      pose.phase = phase;
      pose.moving = still ? 0 : Math.min(1, g.speed / 1.4);
      // A walk, a trot or a run by its speed: longer strides, a body that
      // bobs and leans into a run (4.3).
      const gait = still ? 0 : gaitOf(g.speed, walking) * pose.moving;
      pose.gait = gait;
      pose.graze = still ? 0 : g.graze;
      pose.lie = c.dead ? 0 : g.lie;
      pose.look = still ? 0 : g.look * lookAround(time, c.id);
      pose.still = still;
      pose.flying = !c.dead && (k.flying || c.levitate > 0) && c.z > 0.5;
      pose.nod = asleep ? 0.35 : 0;
      pose.pitch = rig.lean + (still ? 0 : pose.moving * 0.05 + gait * 0.04 + Math.sin(phase * 2) * 0.03 * gait);
      if (!still && gait > 0) pose.y += Math.abs(Math.sin(phase)) * 0.05 * gait * size;
      if (g.lie > 0.01 && !c.dead) pose.y -= hipHeight(rig) * 0.75 * g.lie * size;
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
      pose.close = !!this.orbit.eye && camPos.distanceToSquared(this.sphere.center) < CLOSE_CELLS * CLOSE_CELLS;
      this.figures.add(rig, paletteOf(this.palette, rig, k.body, c.color, c.look), pose);
    }
    this.figures.end();
    this.markMesh.count = marks;
    this.markMesh.instanceMatrix.needsUpdate = true;
    if (this.markMesh.instanceColor) this.markMesh.instanceColor.needsUpdate = true;
    // Forget creatures that are gone, now and then.
    if (frame % 120 === 0) for (const [id, g] of this.gaits) if (g.seen !== frame) this.gaits.delete(id);
  }

  // A small voxel cart behind (x, y) facing `heading` (radians along +x), `s` times its size: a bed,
  // its load, a shaft, two wheels. Into the marks' mesh, so it costs no draw call of its own.
  private placeCart(marks: number, x: number, y: number, ground: number, heading: number, s: number, load: number): number {
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const { x: cx, y: cy } = cartCenter(x, y, heading, s);
    const turn = Math.atan2(-fy, fx);
    const box = (along: number, side: number, up: number, l: number, w: number, h: number, color: number) => {
      const p = this.toScene(cx + fx * along * s - fy * side * s, cy + fy * along * s + fx * side * s, ground + up * s);
      CART.makeRotationY(turn);
      SCALE.makeScale(l * s, h * s, w * s);
      CART.multiply(SCALE);
      CART.setPosition(p.x, p.y, p.z);
      this.markMesh.setMatrixAt(marks, CART);
      this.markMesh.setColorAt(marks, this.col.setHex(color));
      marks++;
    };
    box(0, 0, 0.42, 0.95, 0.62, 0.2, 0x7a4f2a);
    box(0, 0, 0.62, 0.72, 0.5, 0.24, load);
    box(0.62, 0, 0.42, 0.55, 0.08, 0.06, 0x5c3a1e);
    box(0, 0.36, 0.22, 0.38, 0.08, 0.38, 0x2e2420);
    box(0, -0.36, 0.22, 0.38, 0.08, 0.38, 0x2e2420);
    return marks;
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
    this.drawNames(ctx);
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

  // With bottom faces: seen from under a storm (the eye view), boxes without them were thin grey bars.
  private makeClouds(): InstancedMesh {
    const geometry = geometryOf(MODELS.puff, true);
    // A cloud's underside is lit by the land and the sky around it: 0.8, not the 0.42 of a box's
    // shaded bottom, which made a storm overhead black. The bottom face is the last six vertices.
    const col = geometry.getAttribute("color").array as Float32Array;
    for (let k = col.length - 18; k < col.length; k++) col[k] *= 0.8 / 0.42;
    const mesh = new InstancedMesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }), 300);
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
    // A front of rain or snow (weather.ts) is a storm cloud in the island's own blocks: a dark flat
    // base where it rains, lighter layers heaped toward the middle, a bright top. Seen from afar
    // it is a shape that crosses the map with the wind, with thin shafts of rain under it.
    let shafts = 0;
    const held = LAB_SKY.time === null ? null : LAB_SKY.front ? [{ kind: "rain" as const, amount: 1, ...LAB_SKY.front }] : [];
    for (const f of held ?? (GRAPHICS.weather ? fronts(world, time).slice(0, 2) : [])) {
      const grow = 0.45 + 0.55 * f.amount;
      const snow = f.kind === "snow";
      const fx = f.x - world.w / 2;
      const fz = f.y - world.h / 2;
      // The same blocks in the same places of the front every frame: a hash of the block's number.
      const h = (k: number, salt: number) => {
        const v = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453;
        return v - Math.floor(v);
      };
      const layer = (count: number, reach: number, y: number, size: number, thick: number, color: number, salt: number) => {
        for (let k = 0; k < count; k++) {
          const a = h(k, salt) * Math.PI * 2;
          const d = Math.sqrt(h(k, salt + 1)) * f.r * reach;
          const sx = size * (0.8 + h(k, salt + 2) * 0.7) * grow;
          const sz = size * (0.7 + h(k, salt + 3) * 0.6) * grow;
          this.m.makeScale(sx, thick * (0.8 + h(k, salt + 4) * 0.5), sz);
          this.m.setPosition(fx + Math.cos(a) * d, y + h(k, salt + 5) * thick * 0.5, fz + Math.sin(a) * d);
          this.clouds.setMatrixAt(n, this.m);
          this.clouds.setColorAt(n, this.col.setHex(color));
          n++;
        }
      };
      layer(30, 0.9, 46, f.r * 0.34, 3, snow ? 0xb9c3d1 : 0x566173, 1);
      layer(22, 0.68, 50, f.r * 0.3, 4.5, snow ? 0xd5dce6 : 0x7f8a9c, 11);
      layer(14, 0.42, 55, f.r * 0.26, 5.5, snow ? 0xeef2f7 : 0xb7c0cd, 21);
      layer(6, 0.2, 61, f.r * 0.2, 5, 0xffffff, 31);
      // From under it, in the eye view, the base showed the sky through its gaps (broken grey
      // slabs, 12 November): a belly of wide, low blocks closes it, darker toward the middle.
      if (this.orbit.eye) {
        layer(10, 0.72, 44.6, f.r * 0.5, 1.8, snow ? 0xa9b3c1 : 0x4d5767, 51);
        layer(5, 0.3, 44.2, f.r * 0.45, 1.6, snow ? 0x9aa4b2 : 0x434c5a, 61);
      }
      if (snow) continue;
      // Shafts of rain from the base to the ground, a third of them resting at any moment.
      const beat = Math.floor(time * 5);
      for (let k = 0; k < 40 && shafts < 80; k++) {
        if (h(k + beat * 7, 41) < 0.34) continue;
        const a = h(k, 42) * Math.PI * 2;
        const d = Math.sqrt(h(k, 43)) * f.r * 0.8;
        this.m.makeScale(0.5, 46, 0.5);
        this.m.setPosition(fx + Math.cos(a) * d, 23, fz + Math.sin(a) * d);
        this.rainShafts.setMatrixAt(shafts++, this.m);
      }
    }
    this.rainShafts.count = shafts;
    this.rainShafts.instanceMatrix.needsUpdate = true;
    this.clouds.count = n;
    // From the eyes a storm overhead is 40 cells up, past the mist of the eye view: without
    // this it was a blank grey. The clouds take no mist there; from the sky they do, as before.
    const cm = this.clouds.material as MeshBasicMaterial;
    if (cm.fog === !!this.orbit.eye) {
      cm.fog = !this.orbit.eye;
      cm.needsUpdate = true;
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    if (this.clouds.instanceColor) this.clouds.instanceColor.needsUpdate = true;
  }

  // Frees every geometry, material and texture, not only the renderer: the
  // next engine reuses the same canvas and so the same WebGL context.
  dispose(): void {
    this.domes.dispose();
    this.buildings.dispose();
    this.wonderModels.dispose();
    this.propModels.dispose();
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

// Waves on water tops (4.4, redrawn in 4.4.5 part C on the owner's report:
// "the animation for the water waves is bad"). Until then each vertex of the
// one-cell tops rode sines about seven cells long and glinted by vertex, which
// read as flashing triangles and dots. Now the surface barely heaves (long,
// slow swells, so tops stay flat like the voxels around them) and the waves
// are drawn in the fragment shader: two wave trains of the world position,
// read on a quarter-cell grid so they look like the voxels, their fronts bent
// by a slow warp, their crests thin lines broken by a mask that hands the
// light from one train to the other. A few multiply-adds and five sines
// per water pixel: no geometry, no texture, no draw call. The `wave` weight
// (terrain.ts) keeps the shore, walls and shallows calm.
function withWaves<T extends MeshBasicMaterial>(material: T, time: { value: number }): T {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.waveTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float wave;\nuniform float waveTime;\nvarying float vWave;\nvarying vec2 vSea;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vWave = wave;
vSea = (modelMatrix * vec4(position, 1.0)).xz;
if (wave > 0.0) {
  float swell = sin(vSea.x * 0.21 + vSea.y * 0.13 + waveTime * 0.8) + sin(vSea.y * 0.17 - vSea.x * 0.07 - waveTime * 0.6);
  transformed.y += wave * swell * 0.02;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float waveTime;\nvarying float vWave;\nvarying vec2 vSea;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
if (vWave > 0.01) {
  vec2 q = floor(vSea * 4.0) * 0.25;
  float bend = sin(q.y * 0.23 + q.x * 0.11) * 1.3 + sin(q.x * 0.17 - q.y * 0.07 + waveTime * 0.2);
  float a = sin(dot(q, vec2(0.55, 0.32)) + bend + waveTime * 1.1);
  float b = sin(dot(q, vec2(-0.21, 0.63)) - bend * 0.8 - waveTime * 0.8 + 1.9);
  float m = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(dot(q, vec2(0.47, -0.38)) + waveTime * 0.4));
  float crest = smoothstep(0.94, 1.0, a) * m + smoothstep(0.95, 1.0, b) * (1.0 - m) * 0.7;
  gl_FragColor.rgb *= 1.0 + (a + b) * 0.02 * vWave;
  gl_FragColor.rgb += crest * 0.07 * vWave;
}`,
      );
  };
  // Three caches programs by onBeforeCompile's source, which the darkness
  // wrapper makes the same for land and water: name this one apart.
  material.customProgramCacheKey = () => "water-waves-2";
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

// The roads drawn from far (map.ts): a flat pale tile on every road cell, widened in the shader by
// `wide` (0 near, where the mesh is not drawn at all), lifted a little clear of the ground's steps.
function farRoadMesh(wide: { value: number }): InstancedMesh {
  // The colour is in the vertices: the material's own colour is the daylight's tint (applyDaylight).
  const material = new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wide = wide;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float wide;")
      .replace("#include <begin_vertex>", "vec3 transformed = vec3(position.x * wide, position.y + 0.18 * wide, position.z * wide);");
  };
  const geometry = new BoxGeometry(1, 0.1, 1);
  const sand = new Color(0xe2c98c);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let k = 0; k < colors.length; k += 3) [colors[k], colors[k + 1], colors[k + 2]] = [sand.r, sand.g, sand.b];
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const mesh = new InstancedMesh(geometry, material, 1024);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

// Instance colors must exist before the first render, or the shader is built without them.
function withColors(mesh: InstancedMesh): void {
  const white = new Color(0xffffff);
  for (let k = 0; k < mesh.instanceMatrix.count; k++) mesh.setColorAt(k, white);
}

const FLORA_MODELS = floraModels();
// Within this many cells of the eye, creatures show the parts seen only up close (rigs.ts lod 2).
const CLOSE_CELLS = 5;
// An instance drawn as nothing: a tree near the eye, drawn by its near model instead.
const FOLDED = new Matrix4().makeScale(0, 0, 0);
// Where water that flooded a damp cell may grow lily pads (4.4.5).
const LILY_LANDS = new Set(["temperate", "swamp", "jungle"]);

// A fixed number per cell, for choosing shapes and tints that stay put.
function cellHash(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

const LEAN = new Matrix4();
const CART = new Matrix4();
const TURN = new Matrix4();
const SCALE = new Matrix4();
const AXIS = new Vector3();
// A model on its cell: turned by quarter turns around the cell's middle,
// scaled (wide, tall), leaned a little toward `dir`, standing at p.
function placeLeaning(m: Matrix4, p: Vector3, quarter: number, sw: number, sh: number, lean: number, dir: number): void {
  m.makeTranslation(-0.5, 0, -0.5);
  SCALE.makeScale(sw, sh, sw);
  m.premultiply(SCALE);
  TURN.makeRotationY(quarter * (Math.PI / 2));
  m.premultiply(TURN);
  if (lean > 0) {
    AXIS.set(Math.cos(dir), 0, Math.sin(dir));
    LEAN.makeRotationAxis(AXIS, lean);
    m.premultiply(LEAN);
  }
  m.elements[12] += p.x;
  m.elements[13] += p.y;
  m.elements[14] += p.z;
}

// Flowers grow in drifts of one color (4.4.5): the drift's, by place.
const DRIFTS = [0xf28ab0, 0xf2c94c, 0xf4f0ea, 0xa98cf0, 0xe8584a, 0x6aa8f0, 0xf09a4a];
function driftColor(x: number, y: number, seed: number): number {
  return DRIFTS[Math.floor(valueNoise(x / 6, y / 6, seed + 4517) * DRIFTS.length * 1.6) % DRIFTS.length];
}

function scaleHex(c: number, k: number): number {
  const ch = (s: number) => Math.min(255, Math.round(((c >> s) & 255) * k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
