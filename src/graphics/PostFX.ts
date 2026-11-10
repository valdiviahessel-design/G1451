import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { isNight, type LightingPreset } from '../core/EventBus';

/**
 * The single full-screen finishing pass: speed lens effects in linear HDR
 * (radial blur and chromatic aberration toward the edges, nitro punch),
 * vignette, ACES tone mapping, a per-map colour grade, sRGB encoding and film
 * grain. Folding tone mapping and encoding in here saves a whole pass over
 * the separate output pass it replaces.
 */
const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uLens: { value: 1 },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.022 },
    uAspect: { value: 1 },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    uniform float uBoost;
    uniform float uLens;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAspect;
    uniform float uExposure;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    // ACES filmic fit, as three.js applies it (so the look matches the showroom pass).
    vec3 acesFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= uExposure / 0.6;
      return clamp(outM * acesFit(inM * color), 0.0, 1.0);
    }

    void main() {
      // Focus point sits slightly above centre, roughly where the road vanishes.
      vec2 dir = vUv - vec2(0.5, 0.54);
      float dist = length(dir * vec2(uAspect, 1.0));
      float edge = smoothstep(0.25, 0.9, dist);
      float punch = uSpeed * uSpeed + uBoost * 0.5;

      float blur = punch * 0.035 * edge * uLens;
      float ca = (uSpeed * uSpeed * uSpeed + uBoost * 0.6) * 0.009 * edge * uLens;
      vec3 col;
      if (blur + ca < 0.0004) {
        // Slow or centre of frame: one tap is all it needs.
        col = texture2D(tDiffuse, vUv).rgb;
      } else {
        col = vec3(0.0);
        // Jittered start so six taps read as a smooth smear rather than ghost copies.
        float jitter = hash(vUv * 733.0 + fract(uTime) * 17.0);
        const int N = 6;
        for (int i = 0; i < N; i++) {
          float t = (float(i) + jitter) / float(N);
          vec2 uv = vUv - dir * blur * t;
          col.r += texture2D(tDiffuse, uv - dir * ca).r;
          col.g += texture2D(tDiffuse, uv).g;
          col.b += texture2D(tDiffuse, uv + dir * ca).b;
        }
        col /= float(N);
      }

      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, dist);
      // Nitro: a cold flash creeping in from the edges.
      col += vec3(0.05, 0.22, 0.5) * uBoost * edge * edge * 0.6;

      col = aces(col) * uTint;
      col = clamp(col, 0.0, 1.0);
      col = mix(pow(col, vec3(0.41666)) * 1.055 - 0.055, col * 12.92, vec3(lessThanEqual(col, vec3(0.0031308))));
      // Grade in display space: saturation, then a soft S-curve that leaves shadows open.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
      col = clamp(col, 0.0, 1.0);
      col += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Per-map look applied after tone mapping. */
const GRADES: Record<LightingPreset, { saturation: number; contrast: number; tint: [number, number, number]; vignette: number }> = {
  golden: { saturation: 1.1, contrast: 0.16, tint: [1.03, 1.0, 0.96], vignette: 0.38 },
  day: { saturation: 1.08, contrast: 0.14, tint: [1.0, 1.0, 1.0], vignette: 0.3 },
  night: { saturation: 1.04, contrast: 0.04, tint: [0.98, 0.99, 1.03], vignette: 0.45 },
  sakura: { saturation: 1.14, contrast: 0.12, tint: [1.03, 0.99, 1.01], vignette: 0.28 },
  neon: { saturation: 1.1, contrast: 0.05, tint: [1.0, 0.98, 1.04], vignette: 0.45 },
};

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mobile: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: mobile ? 0 : 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), 0.32, 0.6, 0.95);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.finish.uniforms.uAspect.value = width / height;
  }

  applyPreset(preset: LightingPreset): void {
    const night = isNight(preset);
    // Bloom runs on scene-linear HDR before exposure. By day sunlit asphalt, paint and
    // markings reach 2–4, so a low threshold veils the whole frame; only true light
    // sources (sun glints, brake lights, indicators, lamps) should cross it.
    this.bloom.strength = preset === 'neon' ? 0.34 : night ? 0.24 : 0.22;
    this.bloom.radius = night ? 0.4 : 0.45;
    this.bloom.threshold = night ? 1.7 : preset === 'golden' ? 3.0 : 3.6;
    const g = GRADES[preset];
    const u = this.finish.uniforms;
    u.uVignette.value = g.vignette;
    u.uSaturation.value = g.saturation;
    u.uContrast.value = g.contrast;
    (u.uTint.value as THREE.Color).setRGB(...g.tint);
  }

  /** Graphics quality: MSAA samples, bloom and the speed lens effects. */
  setQuality(samples: number, bloom: boolean, lens: boolean): void {
    this.bloom.enabled = bloom;
    this.finish.uniforms.uLens.value = lens ? 1 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === samples) continue;
      rt.samples = samples;
      rt.dispose();
    }
  }

  /** speed01: 0 at standstill, 1 at top speed; boost01: nitro burn. */
  update(speed01: number, time: number, boost01 = 0): void {
    const u = this.finish.uniforms;
    u.uSpeed.value = THREE.MathUtils.clamp(speed01, 0, 1);
    u.uBoost.value = THREE.MathUtils.clamp(boost01, 0, 1);
    u.uTime.value = time;
    u.uExposure.value = this.renderer.toneMappingExposure;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
