import { AdditiveBlending, Color, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Scene, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { DOME_SQUASH, wardDamage } from "../wards";
import type { World } from "../world";

// Wards (wards.ts) drawn as clear domes: nearly invisible from the front, a
// bright rim where the glass is seen edge on, faint rising bands, and a flash
// when something hits it. What is under it stays in plain sight, which is the
// point: an opaque shell of blocks hid the village it was meant to guard.
// One draw call per ward plus its ring on the ground.

const VERTEX = `
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
varying vec3 vPos;
void main() {
  vPos = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  vHeight = position.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = `
uniform vec3 color;
uniform float alpha;
uniform float hit;
uniform float time;
uniform float crack;
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
varying vec3 vPos;
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// Cracks (4.7): the edges of a cell pattern on the glass, more of them as
// the ward wears down, starting where the cells' own seeds say.
float cracks(vec3 p) {
  vec3 g = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float seed = 0.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 h = hash3(g + o);
        float d = length(o + h - f);
        if (d < d1) { d2 = d1; d1 = d; seed = h.x; }
        else if (d < d2) d2 = d;
      }
  float line = 1.0 - smoothstep(0.0, 0.06, d2 - d1);
  return line * step(seed, crack * 1.3);
}
void main() {
  float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(edge, 2.6);
  float band = smoothstep(0.93, 1.0, sin(vHeight * 36.0 - time * 1.6) * 0.5 + 0.5) * 0.22 * (1.0 - crack);
  float c = crack > 0.0 ? cracks(vPos * 5.0) : 0.0;
  float a = (0.05 + rim * 0.6 + band + hit * 0.35 + c * 0.75) * alpha;
  gl_FragColor = vec4(mix(color * (0.85 + rim * 0.5 + hit * 0.7), vec3(1.0), c * 0.6), a);
}`;

interface DomeMesh {
  glass: Mesh;
  ring: Mesh;
}

export class Domes {
  private pool: DomeMesh[] = [];
  private geometry = new SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  private ringGeometry = new RingGeometry(0.97, 1, 72);
  private color = new Color();

  constructor(private scene: Scene) {}

  update(world: World, time: number, toScene: (x: number, y: number, h: number) => Vector3, groundAt: (x: number, y: number) => number): void {
    const wards = world.wards;
    while (this.pool.length < wards.length) {
      const glass = new Mesh(
        this.geometry,
        new ShaderMaterial({
          uniforms: { color: { value: new Color() }, alpha: { value: 1 }, hit: { value: 0 }, time: { value: 0 }, crack: { value: 0 } },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      const ring = new Mesh(this.ringGeometry, new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      glass.renderOrder = 5;
      this.scene.add(glass, ring);
      this.pool.push({ glass, ring });
    }
    this.pool.forEach((d, k) => {
      const ward = wards[k];
      d.glass.visible = d.ring.visible = !!ward;
      if (!ward) return;
      // Fades in as it rises, out over its last second.
      const rise = Math.min(1, (time - ward.from) * 1.5);
      const alpha = Math.max(0, Math.min(rise, ward.until - time));
      const base = groundAt(ward.x, ward.y) - 1.5;
      d.glass.position.copy(toScene(ward.x, ward.y, base));
      d.glass.scale.set(ward.r, Math.max(0.1, ward.r * DOME_SQUASH * rise + 1.5), ward.r);
      const mat = d.glass.material as ShaderMaterial;
      (mat.uniforms.color.value as Color).setHex(ward.color);
      mat.uniforms.alpha.value = alpha;
      mat.uniforms.hit.value = Math.max(0, 1 - (time - ward.hit) * 2.5);
      mat.uniforms.time.value = time;
      mat.uniforms.crack.value = wardDamage(ward);
      d.ring.position.copy(toScene(ward.x, ward.y, groundAt(ward.x, ward.y) + 0.3));
      d.ring.scale.setScalar(ward.r);
      const ringMat = d.ring.material as MeshBasicMaterial;
      ringMat.color.copy(this.color.setHex(ward.color));
      ringMat.opacity = 0.55 * alpha;
    });
  }

  dispose(): void {
    for (const d of this.pool) {
      this.scene.remove(d.glass, d.ring);
      (d.glass.material as ShaderMaterial).dispose();
      (d.ring.material as MeshBasicMaterial).dispose();
    }
    this.pool = [];
    this.geometry.dispose();
    this.ringGeometry.dispose();
  }
}
