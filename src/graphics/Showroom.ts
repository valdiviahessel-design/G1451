import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type ShowroomView = 'lobby' | 'tuning' | 'settings';

interface Look {
  file: string;
  /** Height of the panorama camera above the ground; larger magnifies the paving. */
  groundHeight: number;
  /** Radius where the flat ground turns into the distant skyline. */
  radius: number;
  exposure: number;
  envIntensity: number;
  /** HDRI luminance cap so street lamps don't over-light the paint or flare. */
  maxRadiance: number;
  /** World azimuth (radians from +Z) of the camera looking at the best part of the panorama. */
  homeAzimuth: number;
  /** Key light: azimuth/elevation of the direction toward the light, in radians. */
  lightAzimuth: number;
  lightElevation: number;
  lightColor: number;
  lightIntensity: number;
  shadowOpacity: number;
}

/** Neuer Zollhof (Poly Haven, CC0): dusk paving with lit brick facades, shot at ~2 m. */
const LOOK: Look = {
  file: 'assets/hdri/neuer_zollhof.hdr',
  groundHeight: 2.4,
  radius: 90,
  exposure: 0.95,
  envIntensity: 1.0,
  maxRadiance: 30,
  homeAzimuth: (325 * Math.PI) / 180,
  // The sodium street lamp in the panorama (az 50°, el 37°) is the real key light.
  lightAzimuth: 0.87,
  lightElevation: 0.64,
  lightColor: 0xffb36b,
  lightIntensity: 2.0,
  shadowOpacity: 0.55,
};

interface Pose {
  azim: number;
  elev: number;
  dist: number;
  targetY: number;
  /** Fractions of the viewport the car is pushed left / up. */
  shiftX: number;
  shiftY: number;
}

const FOV = 40;
/** Angle of the car's nose away from the camera axis in the lobby view. */
const THREE_QUARTER = 0.72;
const MIN_ELEV = 0.045;
const MAX_ELEV = 1.0;

/**
 * Menu scene: the player's car parked on a ground-projected HDRI courtyard,
 * with matching reflections (the same HDRI feeds PMREM) and a soft shadow.
 */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 600);
  /** Camera azimuth that frames the nicest part of the panorama. */
  homeAzimuth = 0;

  private readonly mobile: boolean;
  private readonly base: string;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly look: Look;
  private readonly light: THREE.DirectionalLight;
  private readonly shadowCatcher: THREE.Mesh;
  private readonly disposables: { dispose(): void }[] = [];
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private loadPromise: Promise<void> | null = null;
  private fallbackGround: THREE.Mesh | null = null;

  private car: THREE.Object3D | null = null;
  private dims = { length: 4.6, width: 1.8, height: 1.45 };
  private aspect = 16 / 9;
  private view: ShowroomView = 'lobby';
  private cur: Pose;
  private goal: Pose;
  /** User orbit on top of the preset (damped like everything else). */
  private userAz = 0;
  private userEl = 0;
  private curUserAz = 0;
  private curUserEl = 0;
  private idle = 0;
  private time = 0;
  private active = false;
  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private exposure: number;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    opts: { mobile: boolean; base?: string },
  ) {
    this.mobile = opts.mobile;
    this.base = opts.base ?? '/';
    this.look = LOOK;
    this.exposure = 0.9;
    this.homeAzimuth = this.look.homeAzimuth;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const l = this.look;
    this.light = new THREE.DirectionalLight(l.lightColor, l.lightIntensity);
    this.light.castShadow = true;
    const sh = this.light.shadow;
    const size = this.mobile ? 1024 : 2048;
    sh.mapSize.set(size, size);
    sh.camera.left = sh.camera.bottom = -4.5;
    sh.camera.right = sh.camera.top = 4.5;
    sh.camera.near = 1;
    sh.camera.far = 40;
    sh.bias = -0.0004;
    sh.normalBias = 0.02;
    sh.radius = this.mobile ? 3 : 5;
    this.scene.add(this.light, this.light.target);

    const catcherGeo = new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2);
    const catcherMat = new THREE.ShadowMaterial({ opacity: l.shadowOpacity, color: 0x05060a });
    this.shadowCatcher = new THREE.Mesh(catcherGeo, catcherMat);
    this.shadowCatcher.position.y = 0.004;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);
    this.disposables.push(catcherGeo, catcherMat);

    this.setLightDirection(l.lightAzimuth, l.lightElevation);
    this.applyFallback();
    this.cur = this.poseFor('lobby');
    this.goal = { ...this.cur };
    this.applyCamera();
  }

  /** Loads and prefilters the HDRI; never rejects, falls back to a plain paved courtyard. */
  load(): Promise<void> {
    this.loadPromise ??= this.loadHdri().catch((err) => {
      console.warn(`Showroom HDRI "${this.look.file}" unavailable, using the plain fallback. Run \`npm run fetch-assets\`.`, err);
    });
    return this.loadPromise;
  }

  setCar(root: THREE.Object3D, dims: { length: number; width: number; height: number }): void {
    if (this.car && this.car !== root) this.scene.remove(this.car);
    this.car = root;
    this.dims = { ...dims };
    root.position.set(0, 0, 0);
    root.rotation.set(0, this.carYaw(), 0);
    root.scale.setScalar(1);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name !== 'contact-shadow') mesh.castShadow = true;
    });
    this.scene.add(root);
    this.goal = this.poseFor(this.view);
  }

  setView(view: ShowroomView): void {
    this.view = view;
    this.userAz = 0;
    this.userEl = 0;
    this.goal = this.poseFor(view);
  }

  /** Jumps to the current preset without easing (first show, window resize). */
  snap(): void {
    this.goal = this.poseFor(this.view);
    this.cur = { ...this.goal };
    this.curUserAz = this.userAz;
    this.curUserEl = this.userEl;
    this.applyCamera();
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const el = this.renderer.domElement;
    if (on) {
      this.idle = 0;
      window.addEventListener('pointerdown', this.onDown);
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
    } else {
      window.removeEventListener('pointerdown', this.onDown);
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
      this.dragId = null;
      el.style.cursor = '';
    }
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.goal = this.poseFor(this.view);
    this.applyCamera();
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (this.dragId === null) this.idle += dt;

    // Gentle sway around the preset once the player stops dragging.
    const ramp = THREE.MathUtils.smoothstep(this.idle, 2.5, 5);
    const sway = Math.sin(this.time * 0.35) * 0.1 * ramp;

    const k = 1 - Math.exp(-dt * 5);
    const kUser = 1 - Math.exp(-dt * 9);
    const c = this.cur;
    const g = this.goal;
    c.azim += (g.azim - c.azim) * k;
    c.elev += (g.elev - c.elev) * k;
    c.dist += (g.dist - c.dist) * k;
    c.targetY += (g.targetY - c.targetY) * k;
    c.shiftX += (g.shiftX - c.shiftX) * k;
    c.shiftY += (g.shiftY - c.shiftY) * k;
    this.curUserAz += (this.userAz + sway - this.curUserAz) * kUser;
    this.curUserEl += (this.userEl - this.curUserEl) * kUser;
    this.applyCamera();
  }

  render(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.toneMappingExposure;
    renderer.toneMappingExposure = this.exposure;
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = prev;
  }

  dispose(): void {
    this.setActive(false);
    if (this.car) this.scene.remove(this.car);
    this.envTarget?.dispose();
    this.pmrem.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  // ---------------------------------------------------------------------------

  private async loadHdri(): Promise<void> {
    const l = this.look;
    const tex = await new HDRLoader().loadAsync(this.base + l.file);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    clampRadiance(tex, l.maxRadiance);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;

    const envTarget = this.pmrem.fromEquirectangular(tex);
    this.envTarget?.dispose();
    this.envTarget = envTarget;

    const sky = new GroundedSkybox(tex, l.groundHeight, l.radius, this.mobile ? 64 : 128);
    sky.position.y = l.groundHeight;
    // Transparent so it is drawn after the opaque car (an opaque sky painted over it);
    // renderOrder keeps it first within that pass, behind the glass.
    (sky.material as THREE.MeshBasicMaterial).transparent = true;
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.disposables.push(tex, sky.geometry, sky.material as THREE.Material);

    if (this.fallbackGround) {
      this.scene.remove(this.fallbackGround);
      this.fallbackGround = null;
    }
    this.scene.background = null;
    this.scene.fog = null;
    this.scene.environment = envTarget.texture;
    this.scene.environmentIntensity = l.envIntensity;
    this.exposure = l.exposure;
  }

  /** Neutral studio-ish look used until (or instead of) the HDRI. */
  private applyFallback(): void {
    const env = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.envTarget = env;
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.7;

    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#141b30');
    grad.addColorStop(0.3, '#4a4b5a');
    grad.addColorStop(1, '#6d6670');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const bg = new THREE.CanvasTexture(c);
    bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(0x4a4b5a, 25, 80);

    const geo = new THREE.CircleGeometry(120, 48).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5b60, roughness: 0.85, metalness: 0 });
    this.fallbackGround = new THREE.Mesh(geo, mat);
    this.fallbackGround.receiveShadow = true;
    this.scene.add(this.fallbackGround);
    this.disposables.push(bg, geo, mat);
  }

  private setLightDirection(azimuth: number, elevation: number): void {
    const r = 18;
    this.light.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * r,
      Math.sin(elevation) * r,
      Math.cos(azimuth) * Math.cos(elevation) * r,
    );
    this.light.target.position.set(0, 0, 0);
  }

  private carYaw(): number {
    return this.homeAzimuth + Math.PI - THREE_QUARTER;
  }

  private poseFor(view: ShowroomView): Pose {
    const { length: L, width: W, height: H } = this.dims;
    const radius = 0.5 * Math.hypot(L, W) * 0.9;
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const tanH = tanV * this.aspect;
    // Distance at which the car spans `w` of the viewport width and `h` of its height.
    const fit = (w: number, h: number) => Math.max(radius / (w * tanH), H / (h * 2 * tanV));
    const narrow = this.aspect < 1;
    switch (view) {
      case 'tuning':
        return { azim: this.homeAzimuth + 0.24, elev: 0.1, dist: fit(narrow ? 0.95 : 0.7, 0.4), targetY: H * 0.36, shiftX: 0, shiftY: 0.1 };
      case 'settings':
        return { azim: this.homeAzimuth, elev: 0.2, dist: fit(narrow ? 0.7 : 0.36, 0.2), targetY: H * 0.4, shiftX: narrow ? 0 : 0.1, shiftY: 0 };
      default:
        return { azim: this.homeAzimuth, elev: 0.18, dist: fit(narrow ? 0.85 : 0.5, 0.26), targetY: H * 0.4, shiftX: narrow ? 0 : 0.07, shiftY: 0 };
    }
  }

  private applyCamera(): void {
    const c = this.cur;
    const az = c.azim + this.curUserAz;
    // Keep the lens above the paving even when dragged to the lowest pitch.
    const minEl = Math.max(MIN_ELEV, Math.asin(THREE.MathUtils.clamp((0.25 - c.targetY) / c.dist, -1, 1)));
    const el = THREE.MathUtils.clamp(c.elev + this.curUserEl, minEl, MAX_ELEV);
    const ce = Math.cos(el);
    this.camera.position.set(Math.sin(az) * ce * c.dist, Math.sin(el) * c.dist + c.targetY, Math.cos(az) * ce * c.dist);
    this.camera.lookAt(0, c.targetY, 0);

    // Off-axis projection moves the car on screen without changing the orbit centre.
    const w = 1000 * this.aspect;
    this.camera.setViewOffset(w, 1000, c.shiftX * w, c.shiftY * 1000, w, 1000);
    this.camera.updateProjectionMatrix();
  }

  private onDown = (e: PointerEvent): void => {
    if (e.target !== this.renderer.domElement || this.dragId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.dragId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.idle = 0;
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.idle = 0;
    this.userAz -= dx * 0.0055;
    this.userEl = THREE.MathUtils.clamp(this.userEl + dy * 0.003, -0.3, MAX_ELEV);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.dragId = null;
    this.renderer.domElement.style.cursor = '';
  };
}

/** Caps texel luminance (keeping hue); same idea as Environment's clampHdri. */
function clampRadiance(tex: THREE.Texture, maxLum: number): void {
  const { data, width: w, height: h } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
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
