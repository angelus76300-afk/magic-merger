import { AdditiveBlending, Color, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Scene, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { DOME_SQUASH } from "../wards";
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
void main() {
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
varying vec3 vNormal;
varying vec3 vView;
varying float vHeight;
void main() {
  float edge = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(edge, 2.6);
  float band = smoothstep(0.93, 1.0, sin(vHeight * 36.0 - time * 1.6) * 0.5 + 0.5) * 0.22;
  float a = (0.05 + rim * 0.6 + band + hit * 0.35) * alpha;
  gl_FragColor = vec4(color * (0.85 + rim * 0.5 + hit * 0.7), a);
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
          uniforms: { color: { value: new Color() }, alpha: { value: 1 }, hit: { value: 0 }, time: { value: 0 } },
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
