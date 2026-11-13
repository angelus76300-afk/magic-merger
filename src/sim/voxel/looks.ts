import {
  BasicShadowMap,
  Camera,
  Color,
  CustomToneMapping,
  DepthTexture,
  DirectionalLight,
  Fog,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { GRAPHICS } from "./graphics";

// The looks of 5.2.5, render side: what makes the owner's reference dioramas
// beautiful and can run on a phone. Each part has its own switch in
// graphics.ts and costs nothing when it is off.
//
//   shadows  a sun that casts soft shadows, warm in its light, cool in shade
//   grade    a filmic curve and a colour grade, and haze over the far side
//   bloom    glow that spills around bright parts, at night only
//   tilt     the miniature's depth of field in the sky view, focused where the camera looks

// The colour grade, the same in GLSL and in JavaScript (the fog's colour is
// added after the materials' grade, so it is graded here first). Colours are
// authored as they should look (no colour management, view.ts), so the curve
// works on them as they are. As in the reference dioramas: a little deeper
// (a gamma that darkens the middle tones), greens held back rather than
// pushed (the greener a colour, the more it is muted), and a split tone in
// place of a saturation lift: warm in the light, cool in the shade.
const GRADE = { gamma: 1.12, greenMute: 0.45, warm: [1.03, 1.0, 0.93], cool: [-0.012, 0.0, 0.022] } as const;
const f3 = (v: readonly number[]) => v.map((x) => x.toFixed(3)).join(", ");

const GRADE_GLSL = `
vec3 mmGrade(vec3 c) {
  c = pow(clamp(c, 0.0, 1.0), vec3(${GRADE.gamma.toFixed(3)}));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float green = clamp((c.g - max(c.r, c.b)) * 2.5, 0.0, 1.0);
  c = mix(vec3(l), c, 1.0 - ${GRADE.greenMute.toFixed(3)} * green);
  c *= mix(vec3(1.0), vec3(${f3(GRADE.warm)}), l);
  c += vec3(${f3(GRADE.cool)}) * (1.0 - l);
  return clamp(c, 0.0, 1.0);
}`;

export function gradeColor(c: Color, out = new Color()): Color {
  const s = [c.r, c.g, c.b].map((v) => Math.min(1, Math.max(0, v)) ** GRADE.gamma);
  const l = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  const green = Math.min(1, Math.max(0, (s[1] - Math.max(s[0], s[2])) * 2.5));
  const keep = 1 - GRADE.greenMute * green;
  const [r, g, b] = s.map((v, i) => {
    const muted = l + (v - l) * keep;
    return Math.min(1, Math.max(0, muted * (1 + (GRADE.warm[i] - 1) * l) + GRADE.cool[i] * (1 - l)));
  });
  return out.setRGB(r, g, b);
}

// three's tone mapping hook, applied by every material that draws to the
// screen when the renderer's toneMapping is CustomToneMapping: the grade costs
// no extra pass. Set once, before any program is compiled.
const HOOK = "vec3 CustomToneMapping( vec3 color ) { return color; }";
if (ShaderChunk.tonemapping_pars_fragment.includes(HOOK))
  ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(
    HOOK,
    `${GRADE_GLSL}\nvec3 CustomToneMapping( vec3 color ) { return mmGrade(color); }`,
  );

// The sun's shadow map: 1024 texels a side, laid over what the camera holds
// (the whole island from afar), so a texel is a fifth of a cell or less.
export const SHADOW_SIZE = 1024;

// What the view tells the looks each frame.
export interface LooksFrame {
  // 0 in full day, 1 at the darkest of night; a spell's darkness, 0 to 1.
  night: number;
  dark: number;
  // Rain and cloud, 0 to 1 (sky.ts).
  overcast: number;
  // The sun's height (0 at the horizon, 1 overhead, below 0 at night) and its
  // bearing, as sky.ts draws it.
  sunHeight: number;
  sunAz: number;
  eye: boolean;
  // How much of the island the camera holds (1 whole, map.ts), and the
  // camera's tilt (0 straight down).
  cover: number;
  phi: number;
  // Where the camera looks, the radius of ground it shows, in scene units;
  // the island's side and the highest thing on it.
  cx: number;
  cz: number;
  radius: number;
  side: number;
  top: number;
  dist: number;
}

// The tint of the land in shade and in the sun.
const SHADE = new Vector3(0.58, 0.64, 0.86);
const LIT = new Vector3(1.03, 0.99, 0.92);

export class Looks {
  readonly sun = new DirectionalLight(0xffffff, 0);
  // Shared by every material that receives the sun's shadow.
  private readonly uniforms = {
    sunMap: { value: null as Texture | null },
    sunMatrix: { value: new Matrix4() },
    sunStrength: { value: 0 },
    sunDir: { value: new Vector3(0, 1, 0) },
    sunTexel: { value: 1 / SHADOW_SIZE },
    sunOffset: { value: 0.2 },
    sunShade: { value: SHADE },
    sunLit: { value: LIT },
  };
  private receivers: Material[] = [];
  // Draw calls into the shadow map and through the passes after the scene, last frame.
  passes = 0;
  // The switches the materials were compiled for.
  private built = { shadows: false, grade: false };
  private shadowOn = false;
  private post: Post | null = null;
  private bloomAmount = 0;
  private tiltAmount = 0;
  private tiltCenter = 0.5;
  private tiltSharp = 0.1;
  private fogRaw = new Color();
  private fogGraded = new Color();
  private axisX = new Vector3();
  private axisY = new Vector3();
  private axisZ = new Vector3();
  private p = new Vector3();

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    // Meshes that never cast a shadow (flat roads, sparks, windows).
    private noCast: Set<Object3D>,
  ) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    this.sun.visible = false;
    scene.add(this.sun, this.sun.target);
    renderer.shadowMap.type = BasicShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // The shadow map is made by three on its first pass.
    const sun = this.sun;
    Object.defineProperty(this.uniforms.sunMap, "value", { get: () => sun.shadow.map?.texture ?? null });
    this.uniforms.sunMatrix.value = sun.shadow.matrix;
  }

  // Adds the sun's light and shade to a material that receives it (the land,
  // trees, houses, props, wonders, creatures), after whatever it already does.
  receive<T extends Material>(material: T): T {
    const before = material.onBeforeCompile;
    const beforeKey = material.customProgramCacheKey.bind(material);
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      if (!GRAPHICS.shadows) return;
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vSunWorld;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 sunW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
sunW = instanceMatrix * sunW;
#endif
vSunWorld = (modelMatrix * sunW).xyz;`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vSunWorld;
uniform sampler2D sunMap;
uniform mat4 sunMatrix;
uniform float sunStrength;
uniform vec3 sunDir;
uniform float sunTexel;
uniform float sunOffset;
uniform vec3 sunShade;
uniform vec3 sunLit;
float sunDepth(vec2 uv) { return dot(texture2D(sunMap, uv), vec4(255. / 256., 255. / 65536., 255. / 16777216., 1. / 16777216.)); }
// Soft: four taps a texel apart, each a comparison mixed by where the point
// falls between texels.
float sunLight(vec3 n) {
  vec4 c = sunMatrix * vec4(vSunWorld + n * sunOffset, 1.0);
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  vec2 t = c.xy / sunTexel - 0.5;
  vec2 f = fract(t);
  vec2 b = (floor(t) + 0.5) * sunTexel;
  float z = c.z - 0.0008;
  float a = step(z, sunDepth(b));
  float bx = step(z, sunDepth(b + vec2(sunTexel, 0.0)));
  float by = step(z, sunDepth(b + vec2(0.0, sunTexel)));
  float bb = step(z, sunDepth(b + vec2(sunTexel)));
  return mix(mix(a, bx, f.x), mix(by, bb, f.x), f.y);
}`,
        )
        .replace(
          "#include <opaque_fragment>",
          `if (sunStrength > 0.001) {
  vec3 sunN = normalize(cross(dFdx(vSunWorld), dFdy(vSunWorld)));
  if (dot(sunN, cameraPosition - vSunWorld) < 0.0) sunN = -sunN;
  float ndl = dot(sunN, sunDir);
  // Sides turned from the sun are already shaded in their baked colours: half the shade.
  float lit = ndl > 0.02 ? sunLight(sunN) * smoothstep(0.02, 0.25, ndl) : 0.45;
  outgoingLight *= mix(vec3(1.0), mix(sunShade, sunLit, lit), sunStrength);
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => `sun${GRAPHICS.shadows ? 1 : 0}:${beforeKey()}`;
    this.receivers.push(material);
    return material;
  }

  // Before the frame is drawn: what is on, where the sun is, how strong.
  frame(f: LooksFrame): void {
    const { renderer } = this;
    // Switches changed: materials compiled again (once), the shadow pass on or off.
    if (this.built.shadows !== GRAPHICS.shadows || this.built.grade !== GRAPHICS.grade) {
      if (this.built.shadows !== GRAPHICS.shadows) for (const m of this.receivers) m.needsUpdate = true;
      this.built = { shadows: GRAPHICS.shadows, grade: GRAPHICS.grade };
      renderer.shadowMap.enabled = GRAPHICS.shadows;
      this.sun.visible = GRAPHICS.shadows;
    }
    renderer.toneMapping = GRAPHICS.grade ? CustomToneMapping : NoToneMapping;

    // The sun: its strength fades at dusk, under cloud, and is nothing in the eye view or at night.
    const rise = Math.min(1, Math.max(0, f.sunHeight / 0.18));
    const strength = GRAPHICS.shadows && !f.eye ? rise * (1 - f.night) * (1 - 0.75 * f.overcast) * (1 - f.dark) : 0;
    this.uniforms.sunStrength.value = strength;
    this.shadowOn = strength > 0.01;
    if (this.shadowOn) this.placeSun(f);

    // Glow at night, and in a spell's darkness.
    this.bloomAmount = GRAPHICS.bloom ? Math.min(1, Math.max(Math.max(0, f.night - 0.2) / 0.6, f.dark)) : 0;
    // The miniature's depth of field: at every zoom of the sky view, in focus at the point under
    // the middle of the screen, blurred in front of it and behind it; stronger, and with a
    // shallower focus, the more of the island the camera holds. Never in the eye view.
    const whole = Math.min(1, Math.max(0, (f.cover - 0.15) / 0.75));
    this.tiltAmount = GRAPHICS.tilt && !f.eye ? 0.75 + 0.25 * whole : 0;
    this.tiltCenter = 0.5;
    // How far in front or behind the focus stays sharp, as a share of the focus distance.
    this.tiltSharp = 0.035 + 0.05 * (1 - whole);
  }

  // Lays the shadow map over what the camera holds, from the sun's side. The
  // sun follows the hour across the sky as sky.ts draws it, never lower than
  // 20 degrees, so shadows stay short enough to read.
  private placeSun(f: LooksFrame): void {
    const h = Math.max(0, Math.min(1, f.sunHeight));
    const el = 0.32 + 0.5 * h;
    let hx = Math.cos(f.sunAz);
    let hz = -0.6;
    const hl = Math.hypot(hx, hz);
    hx /= hl;
    hz /= hl;
    const dir = this.axisZ.set(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
    this.uniforms.sunDir.value.copy(dir);
    // The light's own axes, as three's lookAt makes them.
    const x = this.axisX.set(0, 1, 0).cross(dir).normalize();
    const y = this.axisY.copy(dir).cross(x).normalize();
    const r = Math.min(f.side * 0.75, Math.max(24, f.radius * 1.6));
    // The ground it covers, seen from the sun: half its width, in steps of 8 so it does not swim.
    const across = r + (f.top + 6) * Math.abs(dir.y > 0.99 ? 0 : Math.sqrt(1 - dir.y * dir.y) / Math.max(0.2, dir.y)) * 0.5;
    const half = Math.ceil(Math.max(r, across) / 8) * 8;
    const texel = (half * 2) / SHADOW_SIZE;
    // The middle, snapped to the texel grid so the edges of shadows stand still while the camera moves.
    const c = this.p.set(f.cx, 0, f.cz);
    const cx = Math.round(c.dot(x) / texel) * texel;
    const cy = Math.round(c.dot(y) / texel) * texel;
    const cz = c.dot(dir);
    c.copy(x).multiplyScalar(cx).addScaledVector(y, cy).addScaledVector(dir, cz);
    const far = f.side * 2 + f.top + 40;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, far / 2);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera as OrthographicCamera;
    cam.left = -half;
    cam.right = half;
    cam.bottom = -half;
    cam.top = half;
    cam.near = 1;
    cam.far = far;
    cam.updateProjectionMatrix();
    // A point is moved a texel out of its face before it is looked up, so a face does not shade itself.
    this.uniforms.sunOffset.value = texel * 1.5;
    this.uniforms.sunTexel.value = 1 / SHADOW_SIZE;
    // What casts: what is solid. Looked at every frame the map is drawn; the scene holds a few hundred objects.
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      const m = mesh.material as Material;
      mesh.castShadow = !this.noCast.has(o) && !Array.isArray(m) && (m as MeshBasicMaterial).isMeshBasicMaterial === true && !m.transparent;
    });
  }

  // Draws the frame: the shadow map when the sun casts, then the scene,
  // straight to the screen or through the passes of bloom and blur.
  render(camera: Camera): void {
    const { renderer, scene } = this;
    renderer.shadowMap.needsUpdate = this.shadowOn;
    this.passes = 0;
    const fog = scene.fog as Fog | null;
    const posting = this.bloomAmount > 0.01 || this.tiltAmount > 0.01;
    // The fog is added after the materials' grade: grade its colour here, and set it back after.
    const grading = GRAPHICS.grade && !posting && fog;
    if (grading) {
      this.fogRaw.copy(fog.color);
      fog.color.copy(gradeColor(this.fogRaw, this.fogGraded));
    }
    if (!posting) {
      renderer.render(scene, camera);
      if (grading) fog.color.copy(this.fogRaw);
      return;
    }
    this.post ??= new Post();
    this.passes = this.post.draw(renderer, scene, camera, {
      bloom: this.bloomAmount,
      tilt: this.tiltAmount,
      center: this.tiltCenter,
      sharp: this.tiltSharp,
      grade: GRAPHICS.grade,
    });
  }

  // Haze for depth (with the grade): from the sky, the mist begins at the
  // near side of the island, so its far side and the sea beyond go softly
  // toward the sky's colour, as in an aerial view.
  haze(fog: Fog, f: { eye: boolean; dist: number; side: number }): void {
    if (!GRAPHICS.grade || f.eye) return;
    fog.near = Math.min(fog.near, Math.max(1, f.dist - f.side * 0.2));
    fog.far = Math.min(fog.far, f.dist + f.side * 3.6);
  }

  dispose(): void {
    this.post?.dispose();
    this.sun.shadow.map?.dispose();
  }
}

// The passes after the scene: the frame is drawn into a texture; bloom takes
// its bright parts at a quarter of the width (a sixteenth of the pixels) and
// blurs them, the depth of field's blur at half the width; one last pass mixes them and
// grades the colour on the way to the screen.
class Post {
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad = new Mesh(new PlaneGeometry(2, 2));
  private full: WebGLRenderTarget;
  private halfA: WebGLRenderTarget;
  private halfB: WebGLRenderTarget;
  private quarterA: WebGLRenderTarget;
  private quarterB: WebGLRenderTarget;
  private size = new Vector2();
  private blur = blurMaterial(false);
  private bright = blurMaterial(true);
  private mixers = new Map<string, ShaderMaterial>();

  constructor() {
    const opts = { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, type: UnsignedByteType };
    // Its depth is kept as a texture for the depth of field: written by the scene's own pass, no pass more.
    this.full = new WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true, depthTexture: new DepthTexture(1, 1) });
    this.halfA = new WebGLRenderTarget(1, 1, opts);
    this.halfB = new WebGLRenderTarget(1, 1, opts);
    // Bloom adds light: kept in half floats where the device has them, so faint glow does not band.
    this.quarterA = new WebGLRenderTarget(1, 1, { ...opts, type: HalfFloatType });
    this.quarterB = new WebGLRenderTarget(1, 1, { ...opts, type: HalfFloatType });
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private resize(renderer: WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    if (this.full.width === w && this.full.height === h) return;
    this.full.setSize(w, h);
    this.halfA.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.halfB.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.quarterA.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.quarterB.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
  }

  private pass(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  // Returns the passes drawn after the scene.
  draw(renderer: WebGLRenderer, scene: Scene, camera: Camera, o: { bloom: number; tilt: number; center: number; sharp: number; grade: boolean }): number {
    this.resize(renderer);
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.full);
    renderer.render(scene, camera);
    let passes = 0;
    const bloom = o.bloom > 0.01;
    const tilt = o.tilt > 0.01;
    if (tilt) {
      this.step(renderer, this.blur, this.full, this.halfA, 1, 0, 2.2);
      this.step(renderer, this.blur, this.halfA, this.halfB, 0, 1, 2.2);
      passes += 2;
    }
    if (bloom) {
      this.step(renderer, this.bright, this.full, this.quarterA, 1, 0, 1.6);
      this.step(renderer, this.blur, this.quarterA, this.quarterB, 0, 1, 1.6);
      this.step(renderer, this.blur, this.quarterB, this.quarterA, 1, 0, 3.2);
      passes += 3;
    }
    const mixer = this.mixer(bloom, tilt, o.grade);
    mixer.uniforms.tScene.value = this.full.texture;
    mixer.uniforms.tBlur.value = this.halfB.texture;
    mixer.uniforms.tBloom.value = this.quarterA.texture;
    mixer.uniforms.bloom.value = o.bloom;
    mixer.uniforms.tilt.value = o.tilt;
    mixer.uniforms.center.value = o.center;
    mixer.uniforms.sharp.value = o.sharp;
    mixer.uniforms.tDepth.value = this.full.depthTexture;
    const cam = camera as PerspectiveCamera;
    mixer.uniforms.camNear.value = cam.near ?? 0.1;
    mixer.uniforms.camFar.value = cam.far ?? 1000;
    this.pass(renderer, mixer, before);
    return passes + 1;
  }

  // One blur along x (dx 1) or y (dy 1), `spread` texels of the source between taps.
  private step(renderer: WebGLRenderer, m: ShaderMaterial, from: WebGLRenderTarget, to: WebGLRenderTarget, dx: number, dy: number, spread: number): void {
    m.uniforms.tSrc.value = from.texture;
    m.uniforms.dir.value.set((dx * spread) / from.width, (dy * spread) / from.height);
    this.pass(renderer, m, to);
  }

  private mixer(bloom: boolean, tilt: boolean, grade: boolean): ShaderMaterial {
    const key = `${+bloom}${+tilt}${+grade}`;
    let m = this.mixers.get(key);
    if (m) return m;
    const defines: Record<string, string> = {};
    if (bloom) defines.BLOOM = "";
    if (tilt) defines.TILT = "";
    if (grade) defines.GRADE = "";
    m = new ShaderMaterial({
      defines,
      uniforms: {
        tScene: { value: null },
        tBlur: { value: null },
        tBloom: { value: null },
        bloom: { value: 0 },
        tilt: { value: 0 },
        center: { value: 0.5 },
        sharp: { value: 0.1 },
        tDepth: { value: null },
        camNear: { value: 0.1 },
        camFar: { value: 1000 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: `
uniform sampler2D tScene;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform float bloom;
uniform float tilt;
uniform float center;
uniform float sharp;
uniform sampler2D tDepth;
uniform float camNear;
uniform float camFar;
varying vec2 vUv;
float viewDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return 2.0 * camNear * camFar / (camFar + camNear - z * (camFar - camNear));
}
${GRADE_GLSL}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
#ifdef TILT
  // In focus at the point under the middle of the screen; the farther in front or behind, the
  // more of the blurred frame shows.
  float focus = viewDepth(vec2(center, 0.5));
  float rel = abs(viewDepth(vUv) - focus) / max(focus, 1e-3);
  float k = smoothstep(sharp, sharp * 3.0 + 0.12, rel) * tilt;
  c = mix(c, texture2D(tBlur, vUv).rgb, k);
#endif
#ifdef BLOOM
  c += texture2D(tBloom, vUv).rgb * bloom * 1.8;
#endif
#ifdef GRADE
  c = mmGrade(c);
#endif
  gl_FragColor = vec4(c, 1.0);
}`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mixers.set(key, m);
    return m;
  }

  dispose(): void {
    for (const t of [this.full, this.halfA, this.halfB, this.quarterA, this.quarterB]) t.dispose();
    for (const m of [this.blur, this.bright, ...this.mixers.values()]) m.dispose();
    this.quad.geometry.dispose();
  }
}

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// A nine tap Gaussian along one direction, using the texture's own linear
// filter between taps. `bright`: only what is brighter than the glow's
// threshold passes (bloom's first step).
function blurMaterial(bright: boolean): ShaderMaterial {
  return new ShaderMaterial({
    defines: bright ? { BRIGHT: "" } : {},
    uniforms: { tSrc: { value: null }, dir: { value: new Vector2() } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: `
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
vec3 tap(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
#ifdef BRIGHT
  float l = max(c.r, max(c.g, c.b));
  c *= smoothstep(0.5, 0.8, l);
#endif
  return c;
}
void main() {
  vec3 c = tap(vUv) * 0.227;
  c += (tap(vUv + dir * 1.384) + tap(vUv - dir * 1.384)) * 0.316;
  c += (tap(vUv + dir * 3.230) + tap(vUv - dir * 3.230)) * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
