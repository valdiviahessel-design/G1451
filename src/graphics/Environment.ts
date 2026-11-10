import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { LightingPreset } from '../core/EventBus';

interface PresetConfig {
  hdri: string;
  exposure: number;
  envIntensity: number;
  backgroundIntensity: number;
  backgroundBlurriness: number;
  /** Detect the sun from the HDRI and rotate it to `sunYaw`; otherwise use `lightDir`. */
  detectSun: boolean;
  /** Desired world yaw of the sun (radians, atan2(z, x)); road heads toward -z. */
  sunYaw: number;
  lightDir: THREE.Vector3;
  envRotation: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  minSunElevation: number;
  fogDensity: number;
  /** Target luminance of the fog colour (hue still comes from the HDRI horizon). */
  fogLuminance: number;
  fogTint: THREE.Color;
  /** HDRI luminance cap: keeps sun discs and lit promenades from veiling the frame in bloom. */
  maxRadiance: number;
  /** Procedural sky used only when the HDRI file is missing. */
  fallbackSky: { elevation: number; azimuth: number; turbidity: number; rayleigh: number };
}

const PRESETS: Record<LightingPreset, PresetConfig> = {
  golden: {
    hdri: 'assets/hdri/golden_hour.hdr',
    exposure: 0.74,
    envIntensity: 1.0,
    backgroundIntensity: 0.6,
    backgroundBlurriness: 0.0,
    detectSun: true,
    // Sun low and ahead-left: long shadows across the lanes, backlit glare.
    sunYaw: Math.atan2(-0.8, -0.6),
    lightDir: new THREE.Vector3(-0.5, 0.25, -0.8),
    envRotation: 0,
    sunColor: new THREE.Color(1.0, 0.72, 0.45),
    sunIntensity: 4.2,
    minSunElevation: THREE.MathUtils.degToRad(9),
    fogDensity: 0.0007,
    fogLuminance: 0.3,
    fogTint: new THREE.Color(1.0, 0.92, 0.85),
    maxRadiance: 40,
    fallbackSky: { elevation: 4, azimuth: 215, turbidity: 8, rayleigh: 2.2 },
  },
  day: {
    hdri: 'assets/hdri/day_highway.hdr',
    exposure: 0.62,
    envIntensity: 0.9,
    backgroundIntensity: 0.7,
    backgroundBlurriness: 0.0,
    detectSun: true,
    // High sun behind-right: crisp short shadows, no glare straight down the road.
    sunYaw: Math.atan2(0.6, 0.8),
    lightDir: new THREE.Vector3(0.4, 0.8, 0.45),
    envRotation: 0,
    sunColor: new THREE.Color(1.0, 0.96, 0.9),
    sunIntensity: 3.2,
    minSunElevation: THREE.MathUtils.degToRad(25),
    fogDensity: 0.0005,
    fogLuminance: 0.45,
    fogTint: new THREE.Color(0.9, 0.95, 1.05),
    maxRadiance: 40,
    fallbackSky: { elevation: 45, azimuth: 150, turbidity: 4, rayleigh: 1.2 },
  },
  night: {
    hdri: 'assets/hdri/night_city.hdr',
    exposure: 0.85,
    envIntensity: 0.55,
    backgroundIntensity: 0.6,
    backgroundBlurriness: 0.0,
    detectSun: false,
    sunYaw: 0,
    // Cold moonlight from behind-right so wet asphalt picks up rim highlights.
    lightDir: new THREE.Vector3(0.45, 0.55, 0.7),
    // Puts the skyline and TV tower down the road so the wet asphalt mirrors them.
    envRotation: 2.2,
    sunColor: new THREE.Color(0.55, 0.65, 1.0),
    sunIntensity: 0.35,
    minSunElevation: 0,
    fogDensity: 0.0012,
    fogLuminance: 0.012,
    fogTint: new THREE.Color(0.8, 0.85, 1.0),
    maxRadiance: 4,
    fallbackSky: { elevation: -2, azimuth: 180, turbidity: 2, rayleigh: 0.3 },
  },
};

interface LoadedEnv {
  texture: THREE.Texture | null;
  sky: Sky | null;
  /** Direction toward the sun in HDRI texture space (before rotation). */
  sunDir: THREE.Vector3 | null;
  horizon: THREE.Color;
}

/**
 * Image-based lighting + key light. Owns the shadow-casting sun that follows
 * the camera with texel snapping so shadows don't shimmer while driving.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  preset: LightingPreset = 'golden';
  private cache = new Map<LightingPreset, Promise<LoadedEnv>>();
  private sunDirWorld = new THREE.Vector3(0, 1, 0);
  private readonly shadowExtent: number;
  private readonly loader = new HDRLoader();
  private activeSky: Sky | null = null;
  private pmrem: THREE.PMREMGenerator;
  private skyEnv: THREE.WebGLRenderTarget | null = null;
  private baseFog = 0.0007;
  private drawDistance = 1100;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    mobile: boolean,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const size = mobile ? 1024 : 4096;
    this.shadowExtent = mobile ? 35 : 55;
    const sh = this.sun.shadow;
    sh.mapSize.set(size, size);
    sh.camera.left = sh.camera.bottom = -this.shadowExtent;
    sh.camera.right = sh.camera.top = this.shadowExtent;
    sh.camera.near = 1;
    sh.camera.far = 400;
    sh.bias = -0.0002;
    sh.normalBias = 0.03;
    // PCFSoftShadowMap was removed in r18x; PCF + radius gives the soft penumbra.
    sh.radius = mobile ? 2 : 3;
    scene.add(this.sun, this.sun.target);

    // Faint fill so the fallback sky path is never pitch black.
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2420, 0);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0x000000, 0.0015);
  }

  private load(preset: LightingPreset): Promise<LoadedEnv> {
    let p = this.cache.get(preset);
    if (!p) {
      const cfg = PRESETS[preset];
      p = this.loader
        .loadAsync(import.meta.env.BASE_URL + cfg.hdri)
        .then((tex): LoadedEnv => {
          tex.mapping = THREE.EquirectangularReflectionMapping;
          const { sunDir, horizon } = analyseHdri(tex);
          clampHdri(tex, cfg.maxRadiance);
          return { texture: tex, sky: null, sunDir, horizon };
        })
        .catch((err): LoadedEnv => {
          console.warn(`HDRI "${cfg.hdri}" unavailable, using procedural sky. Run \`npm run fetch-assets\`.`, err);
          const sky = new Sky();
          sky.scale.setScalar(4500);
          const u = sky.material.uniforms;
          u.turbidity.value = cfg.fallbackSky.turbidity;
          u.rayleigh.value = cfg.fallbackSky.rayleigh;
          u.mieCoefficient.value = 0.005;
          u.mieDirectionalG.value = 0.85;
          const phi = THREE.MathUtils.degToRad(90 - cfg.fallbackSky.elevation);
          const theta = THREE.MathUtils.degToRad(cfg.fallbackSky.azimuth);
          const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
          u.sunPosition.value.copy(dir);
          return { texture: null, sky, sunDir: dir, horizon: new THREE.Color(0.9, 0.6, 0.4) };
        });
      this.cache.set(preset, p);
    }
    return p;
  }

  /** Preload both presets so toggling is instant. */
  preloadAll(): Promise<unknown> {
    return Promise.all((Object.keys(PRESETS) as LightingPreset[]).map((k) => this.load(k)));
  }

  async apply(preset: LightingPreset): Promise<void> {
    const cfg = PRESETS[preset];
    const env = await this.load(preset);
    this.preset = preset;
    const scene = this.scene;

    if (this.activeSky) scene.remove(this.activeSky);
    this.activeSky = null;
    this.skyEnv?.dispose();
    this.skyEnv = null;

    let rotation = cfg.envRotation;
    let sunDir: THREE.Vector3;
    if (env.texture) {
      if (cfg.detectSun && env.sunDir) {
        // Rotate the HDRI about Y so its sun lands at the desired yaw.
        rotation = Math.atan2(env.sunDir.z, env.sunDir.x) - cfg.sunYaw;
        sunDir = env.sunDir.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotation);
      } else {
        sunDir = cfg.lightDir.clone().normalize();
      }
      scene.background = env.texture;
      scene.environment = env.texture;
      scene.backgroundRotation.set(0, rotation, 0);
      scene.environmentRotation.set(0, rotation, 0);
      this.hemi.intensity = 0;
    } else {
      const sky = env.sky!;
      scene.add(sky);
      this.activeSky = sky;
      const skyScene = new THREE.Scene();
      const skyClone = new Sky();
      skyClone.scale.setScalar(1000);
      skyClone.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
      skyScene.add(skyClone);
      this.skyEnv = this.pmrem.fromScene(skyScene);
      scene.background = null;
      scene.environment = this.skyEnv.texture;
      scene.backgroundRotation.set(0, 0, 0);
      scene.environmentRotation.set(0, 0, 0);
      sunDir = env.sunDir!.clone();
      this.hemi.intensity = preset === 'night' ? 0.15 : 0.3;
    }

    scene.backgroundIntensity = cfg.backgroundIntensity;
    scene.backgroundBlurriness = cfg.backgroundBlurriness;
    scene.environmentIntensity = cfg.envIntensity;
    this.renderer.toneMappingExposure = cfg.exposure;

    // Clamp elevation so a horizon sun still lights the road plausibly.
    const horiz = Math.hypot(sunDir.x, sunDir.z) || 1;
    const elev = Math.max(Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)), cfg.minSunElevation);
    this.sunDirWorld.set((sunDir.x / horiz) * Math.cos(elev), Math.sin(elev), (sunDir.z / horiz) * Math.cos(elev));
    this.sun.color.copy(cfg.sunColor);
    this.sun.intensity = cfg.sunIntensity;

    const fog = scene.fog as THREE.FogExp2;
    this.baseFog = cfg.fogDensity;
    fog.density = this.fogDensity();
    // Keep the HDRI horizon hue but pin its brightness: raw horizon radiance is
    // far brighter than lit geometry and would wash the scene out.
    const lum = Math.max(1e-4, env.horizon.r * 0.2126 + env.horizon.g * 0.7152 + env.horizon.b * 0.0722);
    fog.color.copy(env.horizon).multiplyScalar(cfg.fogLuminance / lum).multiply(cfg.fogTint);
  }

  private fogDensity(): number {
    // Short draw distances get extra fog so the end of the streamed road fades out.
    return this.baseFog + Math.max(0, 1.5 / this.drawDistance - 1.5 / 1100);
  }

  setDrawDistance(m: number): void {
    this.drawDistance = m;
    (this.scene.fog as THREE.FogExp2).density = this.fogDensity();
  }

  /** Shadow map resolution; 0 turns the sun's shadows off. */
  setShadowSize(size: number): void {
    const on = size > 0;
    if (this.sun.castShadow !== on) this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
  }

  /** Keep the shadow frustum centred just ahead of the camera. */
  follow(focus: THREE.Vector3): void {
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    // Snap in light space so the shadow map only moves in whole texels.
    _basis.lookAt(_zero, _tmp.copy(this.sunDirWorld).negate(), THREE.Object3D.DEFAULT_UP);
    _inv.copy(_basis).invert();
    _tmp.copy(focus).applyMatrix4(_inv);
    _tmp.x = Math.round(_tmp.x / texel) * texel;
    _tmp.y = Math.round(_tmp.y / texel) * texel;
    _tmp.applyMatrix4(_basis);
    this.sun.target.position.copy(_tmp);
    this.sun.position.copy(_tmp).addScaledVector(this.sunDirWorld, 200);
    this.sun.target.updateMatrixWorld();
  }

  get sunDirection(): THREE.Vector3 {
    return this.sunDirWorld;
  }
}

const _basis = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _tmp = new THREE.Vector3();
const _zero = new THREE.Vector3();

/**
 * Caps texel luminance (keeping hue). A raw sun disc is thousands of units bright:
 * it blooms into a white veil and double-lights the scene on top of the
 * directional sun, which already carries that energy.
 */
function clampHdri(tex: THREE.Texture, maxLum: number): void {
  const img = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const { data, width: w, height: h } = img;
  const half = tex.type === THREE.HalfFloatType;
  const ch = data.length / (w * h);
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const write = (i: number, v: number) => (data[i] = half ? THREE.DataUtils.toHalfFloat(v) : v);
  for (let i = 0; i < data.length; i += ch) {
    const r = read(i);
    const g = read(i + 1);
    const b = read(i + 2);
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (lum <= maxLum) continue;
    const k = maxLum / lum;
    write(i, r * k);
    write(i + 1, g * k);
    write(i + 2, b * k);
  }
  tex.needsUpdate = true;
}

/**
 * Finds the sun (brightest texel in the upper hemisphere) and the average
 * horizon colour of an equirectangular HDR, used to aim the key light and tint fog.
 */
function analyseHdri(tex: THREE.Texture): { sunDir: THREE.Vector3 | null; horizon: THREE.Color } {
  const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const { data, width: w, height: h } = img;
  const half = tex.type === THREE.HalfFloatType;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const channels = data.length / (w * h);

  let best = -1;
  let bestX = 0;
  let bestY = 0;
  // Data rows run top→bottom (flipY), so rows < h/2 are the sky.
  for (let y = 0; y < h / 2; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * channels;
      const lum = read(i) * 0.2126 + read(i + 1) * 0.7152 + read(i + 2) * 0.0722;
      if (lum > best) {
        best = lum;
        bestX = x;
        bestY = y;
      }
    }
  }

  const horizon = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let y = Math.floor(h * 0.42); y < h * 0.48; y += 2) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * channels;
      horizon.r += read(i);
      horizon.g += read(i + 1);
      horizon.b += read(i + 2);
      n++;
    }
  }
  horizon.multiplyScalar(1 / n);

  // Only trust a clear peak; an overcast sky has no sun to aim at.
  if (best < 20) return { sunDir: null, horizon };
  const u = (bestX + 0.5) / w;
  const v = 1 - (bestY + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = (v - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
  return { sunDir, horizon };
}
