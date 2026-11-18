import { Color, Vector3, Vector4, type DataTexture, type Material } from "three";

// The water's light (16 November, the owner: "even water would need a light shader, I really hope
// we can continue to improve visual appearance"), in the water's own material, on the water in
// eighths only (terrain-fine.ts fineWater: its vertices carry `waterFine`, 1 on a top and
// SIDE_MARK on a side, then the foam). The water in whole cells (the low level, a chunk not built
// finely yet) has no `waterFine` and is drawn exactly as before.
//
//   colour   by the real depth under each point (Terrain.waterMap, a texel a cell, filtered
//            between cells): lighter and clearer in the shallows, darker and less clear deep down
//   foam     a soft band a few columns wide at the shore, broken; it breathes with the switch on
//   light    (GRAPHICS.waterlight) the sky at a low angle and the depth looking down (Fresnel), a
//            glint of the sun that moves with the camera on ripples an eighth of a cell wide, the
//            moon's at night, and lava and lit windows near the water reflected faintly
//
// A few dozen operations a water pixel and one texture read; no pass, no draw call.

export const WATER_LIGHTS = 8;
// A side of the water in eighths, in `waterFine`'s first number (a top is 1).
export const SIDE_MARK = 0.6;

export class WaterLight {
  readonly uniforms = {
    wlMap: { value: null as DataTexture | null },
    wlWorld: { value: [1, 1] },
    wlOn: { value: 0 },
    wlTime: { value: 0 },
    wlSunDir: { value: new Vector3(0, 1, 0) },
    wlSun: { value: 0 },
    wlSunCol: { value: new Color(1, 0.95, 0.82) },
    wlMoonDir: { value: new Vector3(0, 1, 0) },
    wlMoon: { value: 0 },
    wlSky: { value: new Color(0.8, 0.9, 0.97) },
    wlNight: { value: 0 },
    wlCount: { value: 0 },
    // x, y, z in scene units, then how far it reaches; and its colour.
    wlLights: { value: Array.from({ length: WATER_LIGHTS }, () => new Vector4()) },
    wlLightCol: { value: Array.from({ length: WATER_LIGHTS }, () => new Color()) },
  };

  constructor(map: DataTexture, w: number, h: number) {
    this.uniforms.wlMap.value = map;
    this.uniforms.wlWorld.value = [w, h];
  }

  // Lights for this frame: call begin, then add the nearest first.
  begin(): void {
    this.uniforms.wlCount.value = 0;
  }

  add(x: number, y: number, z: number, reach: number, r: number, g: number, b: number): boolean {
    const n = this.uniforms.wlCount.value;
    if (n >= WATER_LIGHTS) return false;
    this.uniforms.wlLights.value[n].set(x, y, z, reach);
    this.uniforms.wlLightCol.value[n].setRGB(r, g, b);
    this.uniforms.wlCount.value = n + 1;
    return true;
  }

  // Adds the light to the water's material, after whatever it already does.
  apply<T extends Material>(material: T): T {
    const before = material.onBeforeCompile;
    const beforeKey = material.customProgramCacheKey.bind(material);
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 waterFine;\nvarying vec2 vWaterFine;\nvarying vec3 vWlPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterFine = waterFine;\nvWlPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec2 vWaterFine;
varying vec3 vWlPos;
uniform sampler2D wlMap;
uniform vec2 wlWorld;
uniform float wlOn;
uniform float wlTime;
uniform vec3 wlSunDir;
uniform float wlSun;
uniform vec3 wlSunCol;
uniform vec3 wlMoonDir;
uniform float wlMoon;
uniform vec3 wlSky;
uniform float wlNight;
uniform int wlCount;
uniform vec4 wlLights[${WATER_LIGHTS}];
uniform vec3 wlLightCol[${WATER_LIGHTS}];
float wlHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
        )
        .replace(
          "#include <opaque_fragment>",
          `if (vWaterFine.x > 0.5) {
  float wlAlpha;
  if (vWaterFine.x > 0.8) {
    // A top: its colour by the depth under it, from the map, filtered between cells.
    vec4 wlTex = texture2D(wlMap, (vWlPos.xz + wlWorld * 0.5) / wlWorld);
    float wlDepth = wlTex.a * 8.0;
    vec3 wlShallow = mix(wlTex.rgb, vec3(0.525, 0.918, 0.863), 0.45);
    outgoingLight = mix(wlShallow, vColor.rgb, sqrt(clamp(wlDepth / 5.0, 0.0, 1.0))) * diffuse;
    wlAlpha = 0.4 + 0.56 * sqrt(clamp(wlDepth / 4.5, 0.0, 1.0));
    // Each eighth of a cell, for the foam's breaks and the ripples' glints.
    vec2 wlCube = floor(vWlPos.xz * 8.0);
    float wlH = wlHash(wlCube);
    float wlFoam = vWaterFine.y * step(0.16, wlH + vWaterFine.y * 0.3);
    // The waves (view.ts withWaves) move only where the water is deep enough, away from the foam.
    mmWaveK = smoothstep(0.3, 1.5, wlDepth) * (1.0 - vWaterFine.y);
    if (wlOn > 0.5) {
      wlFoam *= mix(0.45, 1.0, 0.5 + 0.5 * sin(wlTime * 1.6 + wlH * 6.2832));
      vec3 wlV = normalize(cameraPosition - vWlPos);
      vec2 p = wlCube * 0.125;
      // The ripples tilt the surface by 5 degrees at most (10 before 18 November: wide glints).
      vec3 wlN = normalize(vec3(
        0.035 * sin(p.x * 2.3 + p.y * 1.1 + wlTime * 1.2) + 0.025 * sin(p.y * 3.7 - p.x * 1.3 - wlTime * 0.9 + wlH * 2.0),
        1.0,
        0.035 * sin(p.y * 2.1 - p.x * 0.9 + wlTime * 1.0) + 0.025 * sin(p.x * 3.3 + p.y * 1.7 + wlTime * 1.1 + wlH * 2.0)));
      // Fresnel: the sky at a low angle, the depth looking down; from the still surface mostly, so
      // the open water does not turn to cloud.
      float wlNV = clamp(mix(wlV.y, dot(wlN, wlV), 0.3), 0.0, 1.0);
      float wlF = 0.85 * pow(1.0 - wlNV, 3.0);
      outgoingLight = mix(outgoingLight, wlSky * diffuse, wlF);
      wlAlpha = mix(wlAlpha * mix(0.85, 1.0, 1.0 - wlNV), 1.0, wlF);
      // The sun's glint and the moon's, on the ripples, moving with the camera: one eighth in ten
      // sparkle at a time, changing twice a second, soft and small (the owner, 18 November: every
      // eighth lit in white blotches that looked like noise).
      float wlSparkle = step(0.9, wlHash(wlCube + floor(wlTime * 2.0) * 7.31));
      float wlSpec = pow(max(dot(wlN, normalize(wlSunDir + wlV)), 0.0), 600.0) * wlSun * wlSparkle;
      float wlMoonSpec = pow(max(dot(wlN, normalize(wlMoonDir + wlV)), 0.0), 320.0) * wlMoon * wlSparkle;
      outgoingLight += wlSpec * wlSunCol * 0.6 + wlMoonSpec * vec3(0.7, 0.82, 1.0);
      wlAlpha = max(wlAlpha, min(wlAlpha + 0.3, (wlSpec + wlMoonSpec) * 1.5));
      // Lava and lit windows near the water, reflected faintly at night.
      if (wlNight > 0.01) {
        vec3 wlR = reflect(-wlV, wlN);
        vec3 wlGlow = vec3(0.0);
        for (int i = 0; i < ${WATER_LIGHTS}; i++) {
          if (i >= wlCount) break;
          vec3 wlL = wlLights[i].xyz - vWlPos;
          float wlD = length(wlL);
          float wlFall = clamp(1.0 - wlD / wlLights[i].w, 0.0, 1.0);
          wlGlow += wlLightCol[i] * pow(max(dot(wlR, wlL / max(wlD, 0.001)), 0.0), 12.0) * wlFall;
        }
        outgoingLight += wlGlow * wlNight * 1.3;
        wlAlpha = max(wlAlpha, min(1.0, dot(wlGlow, vec3(0.33)) * wlNight));
      }
    }
    outgoingLight = mix(outgoingLight, vec3(0.94, 0.97, 1.0) * diffuse, wlFoam * 0.62);
    wlAlpha = mix(wlAlpha, 0.9, wlFoam * 0.62);
  } else {
    // A side: darker and less clear with depth, in its vertices.
    outgoingLight = vColor.rgb * diffuse;
    wlAlpha = vColor.a;
  }
  diffuseColor.a = wlAlpha * opacity;
}
#include <opaque_fragment>`,
        );
    };
    material.customProgramCacheKey = () => `water-light-2:${beforeKey()}`;
    return material;
  }
}
