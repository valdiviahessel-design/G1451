import * as THREE from 'three';
import type { AsphaltTextures } from './ProceduralTextures';

/**
 * Asphalt shader. Base PBR comes from the tiled aggregate textures; on top of
 * that the fragment shader adds world-anchored detail that must not visibly
 * repeat: rubbered wheel paths, repair patches, skid marks, cracks, tar seals,
 * oil drips, dusty shoulders and (for the night preset) a puddled water film
 * rendered through the physical clear-coat layer.
 *
 * Required geometry attributes:
 *   uv       – x: lateral / LANE_WIDTH + 0.5 (lane i spans [i, i+1]), y: s / 3.75
 *   roadPos  – (lateral meters, s mod NOISE_PERIOD)
 *   shoulder – 0 on lanes, 1 at the outer shoulder edge
 */
export interface RoadUniforms {
  uFeatures: { value: THREE.Texture };
  uWetness: { value: number };
}

const GLSL_COMMON = /* glsl */ `
uniform sampler2D uFeatures;
uniform float uWetness;
varying vec2 vRoadPos;
varying vec2 vLaneUv;
varying float vShoulder;

float rHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise, periodic in y with \`period\` cells so it wraps with s mod 1000.
float rNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float y0 = mod(i.y, period);
  float y1 = mod(i.y + 1.0, period);
  float a = rHash(vec2(i.x, y0));
  float b = rHash(vec2(i.x + 1.0, y0));
  float c = rHash(vec2(i.x, y1));
  float d = rHash(vec2(i.x + 1.0, y1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float gauss(float x, float c, float w) {
  float d = (x - c) / w;
  return exp(-d * d);
}
`;

const GLSL_SURFACE = /* glsl */ `
#include <map_fragment>
float lanePos = fract(vLaneUv.x);
float laneIdx = floor(vLaneUv.x);
float inLane = 1.0 - vShoulder;

float rTrack = (gauss(lanePos, 0.27, 0.075) + gauss(lanePos, 0.73, 0.075)) * inLane;
vec4 rFeat = texture2D(uFeatures, vLaneUv * 0.25 + vec2(0.13, 0.37));
float rMacro = rNoise(vRoadPos * vec2(0.2, 0.05), 50.0) * 0.65 + rNoise(vRoadPos * vec2(0.8, 0.2), 200.0) * 0.35;

// Rectangular repair patches on an 8 m grid per lane.
vec2 pCell = vec2(laneIdx, floor(vRoadPos.y / 8.0));
vec2 pLocal = vec2(lanePos, fract(vRoadPos.y / 8.0));
vec2 pA = vec2(0.05 + 0.3 * rHash(pCell + 3.1), 0.05 + 0.3 * rHash(pCell + 5.7));
vec2 pB = vec2(0.62 + 0.33 * rHash(pCell + 9.2), 0.55 + 0.4 * rHash(pCell + 1.3));
vec4 pEdge = vec4(
  smoothstep(pA.x, pA.x + 0.012, pLocal.x), smoothstep(pB.x, pB.x - 0.012, pLocal.x),
  smoothstep(pA.y, pA.y + 0.004, pLocal.y), smoothstep(pB.y, pB.y - 0.004, pLocal.y));
float rPatch = step(0.86, rHash(pCell + 17.0)) * inLane * pEdge.x * pEdge.y * pEdge.z * pEdge.w;

// Braking skid marks: paired, nearly straight rubber streaks on a 40 m grid per lane.
vec2 sCell = vec2(laneIdx, floor(vRoadPos.y / 40.0));
float sOn = step(0.65, rHash(sCell * 1.7 + 2.3));
float sStart = 0.05 + 0.4 * rHash(sCell + 7.7);
float sLen = 0.18 + 0.4 * rHash(sCell + 4.4);
float sAlong = (fract(vRoadPos.y / 40.0) - sStart) / sLen;
float sInside = step(0.0, sAlong) * step(sAlong, 1.0);
// Slight linear yaw only: a braking car drifts, it doesn't weave.
float sDrift = (rHash(sCell + 8.8) - 0.5) * 0.1 + sAlong * (rHash(sCell + 2.2) - 0.5) * 0.05;
float sFade = smoothstep(0.0, 0.12, sAlong) * sqrt(max(0.0, 1.0 - sAlong));
float rSkid = sOn * sInside * sFade * inLane *
  (gauss(lanePos, 0.27 + sDrift, 0.03) + gauss(lanePos, 0.73 + sDrift, 0.03)) *
  (0.45 + 0.55 * rNoise(vRoadPos * vec2(3.0, 0.5), 500.0));

// Water: everything damp, puddles in ruts and low spots.
float rPuddle = smoothstep(0.5, 0.66,
  rNoise(vRoadPos * vec2(0.2, 0.12), 120.0) * 0.72 + rNoise(vRoadPos * vec2(0.9, 0.5), 500.0) * 0.28
  + rTrack * 0.16 + vShoulder * 0.1 - rPatch * 0.08);
float rWet = uWetness * mix(0.5, 1.0, rPuddle);

vec3 rCol = diffuseColor.rgb;
rCol *= 0.88 + rMacro * 0.26;
rCol *= 1.0 - rTrack * 0.16;
rCol *= 1.0 - rFeat.r * 0.6;
rCol = mix(rCol, vec3(0.016, 0.016, 0.018), rFeat.g * 0.6 * inLane);
rCol = mix(rCol, rCol * 0.5, rFeat.b * inLane * 0.85);
rCol = mix(rCol, rCol * 0.52 + 0.004, rPatch);
rCol *= 1.0 - clamp(rSkid, 0.0, 1.0) * 0.4;
rCol = mix(rCol, rCol * 1.25 + vec3(0.025, 0.021, 0.014), vShoulder * 0.85);
rCol *= mix(1.0, 0.42, rWet);
diffuseColor.rgb = rCol;
`;

const GLSL_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 - rTrack * 0.2;
roughnessFactor = mix(roughnessFactor, 0.62, rFeat.g * 0.6 * inLane);
roughnessFactor = mix(roughnessFactor, 0.45, rFeat.b * 0.6 * inLane);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.82, rPatch);
roughnessFactor = mix(roughnessFactor, 0.6, clamp(rSkid, 0.0, 1.0) * 0.5);
roughnessFactor = min(1.0, roughnessFactor + vShoulder * 0.06);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, rWet);
`;

const GLSL_CLEARCOAT = /* glsl */ `
#include <lights_physical_fragment>
material.clearcoat = clamp(rWet * 1.15, 0.0, 1.0);
material.clearcoatRoughness = min(1.0, mix(0.22, 0.045, rPuddle) + geometryRoughness);
`;

export function createRoadMaterial(tex: AsphaltTextures): THREE.MeshPhysicalMaterial {
  const uniforms: RoadUniforms = {
    uFeatures: { value: tex.features },
    uWetness: { value: 0 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex.albedo,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: tex.roughness,
    roughness: 1,
    metalness: 0,
    // Non-zero so the USE_CLEARCOAT path is compiled; the shader drives the amount.
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    specularIntensity: 0.6,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 roadPos;
attribute float shoulder;
varying vec2 vRoadPos;
varying vec2 vLaneUv;
varying float vShoulder;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vRoadPos = roadPos;
vLaneUv = uv;
vShoulder = shoulder;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace('#include <map_fragment>', GLSL_SURFACE)
      .replace('#include <roughnessmap_fragment>', GLSL_ROUGHNESS)
      .replace('#include <lights_physical_fragment>', GLSL_CLEARCOAT);
  };
  mat.customProgramCacheKey = () => 'road-asphalt-v1';
  return mat;
}

export function setRoadWetness(mat: THREE.Material, wetness: number): void {
  (mat.userData.uniforms as RoadUniforms).uWetness.value = wetness;
}
