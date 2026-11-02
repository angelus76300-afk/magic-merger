import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ColorManagement,
  DoubleSide,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  OctahedronGeometry,
  Points,
  RingGeometry,
  Scene,
  ShaderMaterial,
  LinearSRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { kindOf } from "../creatures";
import { BUILTIN, C, F, S } from "../materials";
import { envelope, type Body, type Visuals } from "../visuals";
import type { World } from "../world";
import { MODELS, geometryOf } from "./models";
import { OrbitCamera } from "./orbit";
import { CHUNK, Terrain, columnTop, surfaceY } from "./terrain";

// Colors are authored as they should look, with lighting baked in: no color
// management, no conversion, what is written is what is shown.
ColorManagement.enabled = false;

const SKY_TOP = "#5fa8e8";
const SKY_LOW = "#cfe8f7";
const DECAL_SCALE = 4; // decal pixels per cell

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
  private bodyMesh: InstancedMesh;
  private headMesh: InstancedMesh;
  private flames: InstancedMesh;
  private puffs: InstancedMesh;
  private glowPoints: Points;
  private dullPoints: Points;
  private bodies = new Map<number, Object3D>();
  private rings: Mesh[] = [];
  private lights: Sprite[] = [];
  private clouds: InstancedMesh;
  private decorMesh: InstancedMesh;
  private decorVersion = -1;
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
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: !!options.preserveDrawingBuffer });
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
    this.terrain = new Terrain(world, land, fluid, (m) => this.scene.add(m), (m) => this.scene.remove(m));

    const basic = new MeshBasicMaterial({ vertexColors: true });
    for (const key of ["tree", "pine", "bush", "crop", "house", "rubble", "powder", "stump", "flower", "boulder", "block", "slab"]) {
      const mesh = new InstancedMesh(geometryOf(MODELS[key]), basic, 64);
      withColors(mesh);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.covers.set(key, mesh);
      this.scene.add(mesh);
    }
    this.bodyMesh = this.instanced("body", basic, 900);
    this.headMesh = this.instanced("head", basic, 900);
    this.flames = this.instanced("flame", new MeshBasicMaterial({ vertexColors: true }), 5000);
    this.puffs = this.instanced("puff", new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false }), 4000);
    this.glowTexture = glowTexture();
    this.glowPoints = pointCloud(world.particles.capacity, true, this.glowTexture);
    this.dullPoints = pointCloud(world.particles.capacity, false, this.glowTexture);
    this.scene.add(this.glowPoints, this.dullPoints);
    this.clouds = this.makeClouds();
    this.decorMesh = this.instanced("puff", basic, 20000);
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
    const { world } = this;
    this.orbit.update(dt, time, this.groundAt, reducedMotion);
    this.terrain.scan();
    this.terrain.rebuild(this.firstBuild);
    this.firstBuild = false;
    if (this.terrain.coversChanged && time - this.lastCovers > 0.25) {
      this.terrain.coversChanged = false;
      this.lastCovers = time;
      this.placeCovers();
    }
    if (world.decorVersion !== this.decorVersion) {
      this.decorVersion = world.decorVersion;
      this.placeDecor();
    }
    this.placeCreatures(time);
    this.placeFireAndGas(time);
    this.placeParticles();
    this.placeBodies(visuals, time);
    this.placeRingsAndLights(visuals);
    this.paintDecal(visuals);
    this.moveClouds(time);
    this.renderer.render(this.scene, this.orbit.camera);
    this.drawOverlay(visuals);
    this.adapt(performance.now() - started, dt);
  }

  // Lower the pixel density when frames are slow, raise it back when they are fast.
  private adapt(ms: number, dt: number): void {
    this.frameTimes.push(Math.max(ms, dt * 1000));
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    const max = Math.min(2, window.devicePixelRatio || 1);
    let next = this.pixelRatio;
    if (avg > 26) next = Math.max(0.6, this.pixelRatio - 0.25);
    else if (avg < 14) next = Math.min(max, this.pixelRatio + 0.25);
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

  private placeDecor(): void {
    const { world } = this;
    let n = 0;
    for (const [key, color] of world.decor) {
      if (n >= 20000) break;
      const level = (key % 512) - 128;
      const cell = Math.floor(key / 512);
      const x = cell % 1024;
      const y = Math.floor(cell / 1024);
      this.m.makeTranslation(x - world.w / 2 + 0.5, level + 0.5, y - world.h / 2 + 0.5);
      this.decorMesh.setMatrixAt(n, this.m);
      this.decorMesh.setColorAt(n, this.col.setHex(color));
      n++;
    }
    this.decorMesh.count = n;
    this.decorMesh.instanceMatrix.needsUpdate = true;
    if (this.decorMesh.instanceColor) this.decorMesh.instanceColor.needsUpdate = true;
  }

  private placeCreatures(time: number): void {
    const { world } = this;
    let n = 0;
    for (const c of world.creatures) {
      if (n >= 900) break;
      const k = kindOf(c);
      const size = k.radius * 1.6 * c.size;
      const ground = this.groundAt(c.x, c.y);
      const p = this.toScene(c.x, c.y, ground + c.z);
      let color = c.color;
      if (c.dead) color = 0x5a5560;
      else if (c.frozen > 0) color = 0xbfe6ff;
      else if (c.burning > 0 && Math.sin(time * 30 + c.id) > 0) color = 0xff8c1a;
      const tall = c.kind === "villager" ? 1.1 : c.kind === "golem" ? 1.4 : 0.8;
      if (c.dead) this.m.makeScale(size * tall, size * 0.4, size);
      else this.m.makeScale(size * 0.8, size * tall, size * 0.8);
      // A little bob while walking.
      const bob = c.dead ? 0 : Math.abs(Math.sin(time * 9 + c.id)) * 0.08 * size;
      this.m.setPosition(p.x, p.y + bob, p.z);
      this.bodyMesh.setMatrixAt(n, this.m);
      this.bodyMesh.setColorAt(n, this.col.setHex(color));
      // Head: skin for people, the body color for the rest.
      const head = size * 0.55;
      this.m.makeScale(head, head, head);
      this.m.setPosition(p.x + (c.dead ? size * 0.6 : 0), p.y + bob + (c.dead ? 0 : size * tall), p.z);
      this.headMesh.setMatrixAt(n, this.m);
      const headColor = c.kind === "villager" ? (c.dead ? 0x777070 : 0xf1c27d) : c.kind === "golem" ? 0x9dfcff : scaleHex(color, 1.1);
      this.headMesh.setColorAt(n, this.col.setHex(c.fear > 0 && Math.floor(time * 4) % 2 === 0 ? 0xffe066 : c.sleep > 0 ? 0xa9c8ff : headColor));
      n++;
    }
    this.bodyMesh.count = n;
    this.headMesh.count = n;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
    if (this.headMesh.instanceColor) this.headMesh.instanceColor.needsUpdate = true;
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
    const scale = this.renderer.getPixelRatio() * this.cssH * 0.5 / Math.tan((this.orbit.camera.fov * Math.PI) / 360);
    (this.glowPoints.material as ShaderMaterial).uniforms.scale.value = scale;
    (this.dullPoints.material as ShaderMaterial).uniforms.scale.value = scale;
  }

  private placeBodies(visuals: Visuals, time: number): void {
    const alive = new Set<number>();
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
      const p = this.toScene(b.x, b.y, ground + b.z + b.r);
      obj.position.copy(p);
      obj.scale.setScalar(Math.max(0.2, b.r));
      if (b.look === "vortex" || b.look === "ring" || b.look === "star") obj.rotation.y = time * 3;
      if (b.look === "flame") obj.scale.multiplyScalar(0.9 + Math.random() * 0.2);
    }
    for (const [id, obj] of this.bodies) {
      if (alive.has(id)) continue;
      this.scene.remove(obj);
      obj.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      this.bodies.delete(id);
    }
  }

  private makeBody(b: Body): Object3D {
    const group = new Group();
    const color = new Color(b.color);
    const color2 = new Color(b.color2);
    const mat = new MeshBasicMaterial({ color });
    switch (b.look) {
      case "cloud":
        for (let k = 0; k < 7; k++) {
          const m = new Mesh(new IcosahedronGeometry(0.55, 0), new MeshBasicMaterial({ color: k % 2 ? color : color2, transparent: true, opacity: 0.85 }));
          m.position.set(Math.cos(k) * 0.6, (k % 3) * 0.15, Math.sin(k * 1.3) * 0.5);
          group.add(m);
        }
        break;
      case "ring":
        group.add(new Mesh(new TorusGeometry(1, 0.12, 6, 24), mat));
        group.children[0].rotation.x = Math.PI / 2;
        break;
      case "vortex":
        // A funnel: rings widening as they rise.
        for (let k = 0; k < 9; k++) {
          const t = new Mesh(new TorusGeometry(0.2 + k * 0.17, 0.07, 4, 16), new MeshBasicMaterial({ color: k % 2 ? color : color2, transparent: true, opacity: 0.55 + (k % 3) * 0.12 }));
          t.rotation.x = Math.PI / 2;
          t.position.set(Math.sin(k * 0.9) * 0.12, k * 0.38 - 1, Math.cos(k * 0.9) * 0.12);
          group.add(t);
        }
        break;
      case "shard":
        group.add(new Mesh(new OctahedronGeometry(1, 0), mat));
        group.children[0].scale.set(0.5, 1.2, 0.5);
        break;
      case "star":
        group.add(new Mesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial({ color: color2 })));
        break;
      default:
        group.add(new Mesh(new IcosahedronGeometry(1, 1), mat));
        group.add(new Mesh(new IcosahedronGeometry(0.6, 1), new MeshBasicMaterial({ color: color2 })));
    }
    if (b.glow) {
      const glow = new Sprite(new SpriteMaterial({ map: this.glowTexture, color, blending: AdditiveBlending, depthWrite: false, transparent: true }));
      glow.scale.setScalar(5);
      group.add(glow);
    }
    return group;
  }

  private placeRingsAndLights(visuals: Visuals): void {
    while (this.rings.length < visuals.shockwaves.length) {
      const ring = new Mesh(new RingGeometry(0.92, 1, 64), new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }));
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
    const dark = visuals.darknessLevel();
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(4,2,16,${Math.min(0.95, dark)})`;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalCompositeOperation = "destination-out";
      const hole = (x: number, y: number, h: number, r: number, a: number) => {
        const p = this.toScene(x, y, h).project(this.orbit.camera);
        if (p.z > 1) return;
        const sx = ((p.x + 1) / 2) * this.cssW;
        const sy = ((1 - p.y) / 2) * this.cssH;
        const rr = (r / this.orbit.dist) * this.cssH * 1.4;
        if (rr < 1) return;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      };
      for (const l of visuals.lights) hole(l.x, l.y, this.groundAt(l.x, l.y), l.r, envelope(l.t, l.dur));
      for (const b of visuals.bodies) if (b.glow && b.look !== "none") hole(b.x, b.y, this.groundAt(b.x, b.y) + b.z, Math.max(3, b.r * 4), 0.9);
      for (const c of this.world.creatures) if (!c.dead && kindOf(c).glow) hole(c.x, c.y, this.groundAt(c.x, c.y), 4, 0.8);
      const { world } = this;
      for (let y = 0; y < world.h; y += 3) {
        for (let x = 0; x < world.w; x += 3) {
          const i = y * world.w + x;
          if (world.fire[i] > 0.3 || world.fluid[i] === F.LAVA || world.materials.get("ground", world.ground[i]).glow) hole(x, y, columnTop(world, i), 5, 0.6);
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }
    for (const t of visuals.tints) {
      ctx.globalAlpha = t.alpha * envelope(t.t, t.dur);
      ctx.fillStyle = `#${t.color.toString(16).padStart(6, "0")}`;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    if (visuals.flash > 0) {
      ctx.globalAlpha = Math.min(1, visuals.flash);
      ctx.fillStyle = `#${visuals.flashColor.toString(16).padStart(6, "0")}`;
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

  dispose(): void {
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
// painted at that spot.
function withDecal<T extends MeshBasicMaterial>(material: T, texture: CanvasTexture, world: World): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.decalMap = { value: texture };
    shader.uniforms.worldSize = { value: [world.w, world.h] };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D decalMap;\nuniform vec2 worldSize;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\nvec2 decalUv = (vWorldPos.xz + worldSize * 0.5) / worldSize;\nvec4 decal = texture2D(decalMap, vec2(decalUv.x, 1.0 - decalUv.y));\ngl_FragColor.rgb = mix(gl_FragColor.rgb, decal.rgb, decal.a);",
      );
  };
  return material;
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

function scaleHex(c: number, k: number): number {
  return (Math.min(255, Math.round(((c >> 16) & 255) * k)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));
}
