import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { LightingPreset } from '../core/EventBus';

/**
 * Speed-driven lens effects, applied in linear HDR before tone mapping:
 * radial motion blur and chromatic aberration grow toward the screen edges
 * as speed rises; vignette and film grain are constant.
 */
const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSpeed: { value: 0 },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.025 },
    uAspect: { value: 1 },
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
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // Focus point sits slightly above centre, roughly where the road vanishes.
      vec2 dir = vUv - vec2(0.5, 0.54);
      float dist = length(dir * vec2(uAspect, 1.0));
      float edge = smoothstep(0.25, 0.9, dist);

      float blur = uSpeed * uSpeed * 0.035 * edge;
      float ca = uSpeed * uSpeed * uSpeed * 0.009 * edge;
      vec3 col = vec3(0.0);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 uv = vUv - dir * blur * t;
        col.r += texture2D(tDiffuse, uv - dir * ca).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv + dir * ca).b;
      }
      col /= float(N);

      float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, dist);
      col *= vig;
      col += (hash(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (0.25 + col);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private cinematic: ShaderPass;

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
    this.cinematic = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematic);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.cinematic.uniforms.uAspect.value = width / height;
  }

  applyPreset(preset: LightingPreset): void {
    const night = preset === 'night';
    // Bloom runs on scene-linear HDR before exposure. By day sunlit asphalt, paint and
    // markings reach 2–4, so a low threshold veils the whole frame; only true light
    // sources (sun glints, brake lights, indicators, lamps) should cross it.
    this.bloom.strength = night ? 0.24 : 0.22;
    this.bloom.radius = night ? 0.4 : 0.45;
    this.bloom.threshold = night ? 1.7 : preset === 'day' ? 3.6 : 3.0;
    this.cinematic.uniforms.uVignette.value = night ? 0.45 : 0.35;
  }

  /** Graphics quality: MSAA samples, bloom and the speed lens effects. */
  setQuality(samples: number, bloom: boolean, lens: boolean): void {
    this.bloom.enabled = bloom;
    this.cinematic.enabled = lens;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === samples) continue;
      rt.samples = samples;
      rt.dispose();
    }
  }

  /** speed01: 0 at standstill, 1 at top speed. */
  update(speed01: number, time: number): void {
    this.cinematic.uniforms.uSpeed.value = THREE.MathUtils.clamp(speed01, 0, 1);
    this.cinematic.uniforms.uTime.value = time;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
