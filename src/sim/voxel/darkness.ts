import { Vector4, type Material } from "three";

// A spell's darkness (w.darken), drawn by the materials themselves: whatever
// the sun lights dims, and up to MAX_LIGHTS points (spell lights, fire, lava,
// glowing creatures and voxels) light the land around them again. One shared
// set of uniforms for every lit material; the loop runs only while it is dark.
//
// It replaces a 2D canvas over the whole screen that was filled and then had
// a gradient hole cut for every light, every frame, at the screen's full
// pixel density.

export const MAX_LIGHTS = 16;

export class Darkness {
  readonly uniforms = {
    darkAmount: { value: 0 },
    darkCount: { value: 0 },
    // x, y, z in scene units, then the radius.
    darkLights: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    darkPower: { value: new Float32Array(MAX_LIGHTS) },
  };

  // Lights for this frame: call begin, then add (in order of importance).
  begin(amount: number): void {
    this.uniforms.darkAmount.value = amount;
    this.uniforms.darkCount.value = 0;
  }

  add(x: number, y: number, z: number, r: number, power: number): boolean {
    const n = this.uniforms.darkCount.value;
    if (n >= MAX_LIGHTS || r <= 0 || power <= 0) return false;
    this.uniforms.darkLights.value[n].set(x, y, z, r);
    this.uniforms.darkPower.value[n] = power;
    this.uniforms.darkCount.value = n + 1;
    return true;
  }

  get full(): boolean {
    return this.uniforms.darkCount.value >= MAX_LIGHTS;
  }

  // Adds the darkness to a material, after whatever it already does.
  apply<T extends Material>(material: T): T {
    const before = material.onBeforeCompile;
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vDarkPos;").replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 darkPos = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
darkPos = instanceMatrix * darkPos;
#endif
vDarkPos = (modelMatrix * darkPos).xyz;`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vDarkPos;
uniform float darkAmount;
uniform int darkCount;
uniform vec4 darkLights[${MAX_LIGHTS}];
uniform float darkPower[${MAX_LIGHTS}];`,
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
if (darkAmount > 0.001) {
  float lit = 0.0;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= darkCount) break;
    float d = distance(vDarkPos, darkLights[i].xyz) / darkLights[i].w;
    float k = clamp(1.0 - d, 0.0, 1.0);
    lit += darkPower[i] * k;
  }
  float keep = (1.0 - darkAmount) + darkAmount * clamp(lit, 0.0, 1.0);
  gl_FragColor.rgb *= vec3(keep, keep, min(1.0, keep + darkAmount * 0.06));
}`,
        );
    };
    // three tells programs apart by this key; the patch before ours decides it.
    material.customProgramCacheKey = () => `dark:${before.toString()}`;
    return material;
  }
}
