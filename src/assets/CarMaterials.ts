import * as THREE from 'three';

export type PartClass =
  | 'paint'
  | 'glass'
  | 'head'
  | 'tail'
  | 'chrome'
  | 'trim'
  | 'plastic'
  | 'plate'
  | 'tire'
  | 'rim'
  | 'keep'
  // Transparent lamp covers (clear / red).
  | 'lens'
  | 'taillens'
  // Opaque lamp units that carry no detail of their own get a painted reflector texture.
  | 'headlamp'
  | 'taillamp'
  // Lamp surfaces textured by the author: keep the texture, light it from within.
  | 'headmap'
  | 'tailmap';

export interface CarPaintOptions {
  paint: THREE.ColorRepresentation;
  metallic: number;
  rim: THREE.ColorRepresentation;
  tint: number;
  /** False when the model has no cabin behind its windows: the glass then stays more opaque. */
  interior?: boolean;
}

/**
 * Caps direct specular radiance. A low sun on clear coat or chrome otherwise peaks at hundreds of
 * times the bloom threshold and paints a huge flare across the bodywork.
 */
export function limitGlare<T extends THREE.Material>(mat: T, max = 6): T {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      reflectedLight.directSpecular = min( reflectedLight.directSpecular, vec3( ${max.toFixed(1)} ) );
      #ifdef USE_CLEARCOAT
      clearcoatSpecularDirect = min( clearcoatSpecularDirect, vec3( ${max.toFixed(1)} ) );
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => `glare${max}`;
  return mat;
}

// ---------------------------------------------------------------------------
// Lamp textures

type LampTex = { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture };
const lampCache = new Map<string, LampTex>();

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** u = 0 is the inner edge (towards the car's centre line), u = 1 the outer corner. */
function drawHeadlamp(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean): void {
  g.fillStyle = lit ? '#000' : '#0d1013';
  g.fillRect(0, 0, W, H);
  if (!lit) {
    const bowl = g.createLinearGradient(0, H * 0.1, 0, H * 0.9);
    bowl.addColorStop(0, '#e4e8ee');
    bowl.addColorStop(0.5, '#8f98a3');
    bowl.addColorStop(1, '#2c3239');
    g.fillStyle = bowl;
    rrect(g, W * 0.03, H * 0.1, W * 0.94, H * 0.8, H * 0.28);
    g.fill();
    // Reflector facets.
    g.strokeStyle = 'rgba(20,24,30,0.35)';
    g.lineWidth = 1;
    for (let i = 1; i < 14; i++) {
      g.beginPath();
      g.moveTo((W * i) / 14, H * 0.12);
      g.lineTo((W * i) / 14, H * 0.88);
      g.stroke();
    }
  }
  const projector = (cx: number, cy: number, r: number) => {
    if (lit) {
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.8);
      glow.addColorStop(0, 'rgb(255,250,235)');
      glow.addColorStop(0.55, 'rgb(150,150,140)');
      glow.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      g.fill();
      return;
    }
    g.fillStyle = '#07090b';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    const ring = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ring.addColorStop(0, '#f2f4f7');
    ring.addColorStop(1, '#59606a');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    g.fill();
    const lens = g.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 0, cx, cy, r * 0.7);
    lens.addColorStop(0, '#f6f8fb');
    lens.addColorStop(0.35, '#6e7782');
    lens.addColorStop(1, '#0c0f13');
    g.fillStyle = lens;
    g.beginPath();
    g.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
    g.fill();
  };
  projector(W * 0.36, H * 0.55, H * 0.33);
  projector(W * 0.68, H * 0.58, H * 0.22);
  // Daytime-running strip along the top edge.
  g.fillStyle = lit ? 'rgb(255,250,240)' : '#ffffff';
  rrect(g, W * 0.06, H * 0.13, W * 0.88, H * 0.1, H * 0.05);
  g.fill();
  // Indicator at the outer corner.
  g.fillStyle = lit ? 'rgb(140,70,0)' : '#d9820e';
  rrect(g, W * 0.76, H * 0.76, W * 0.19, H * 0.11, H * 0.04);
  g.fill();
}

function drawTaillamp(g: CanvasRenderingContext2D, W: number, H: number, lit: boolean): void {
  g.fillStyle = lit ? '#000' : '#16090a';
  g.fillRect(0, 0, W, H);
  if (!lit) {
    const lens = g.createLinearGradient(0, 0, W, 0);
    lens.addColorStop(0, '#5a0910');
    lens.addColorStop(1, '#8a0f14');
    g.fillStyle = lens;
    rrect(g, W * 0.03, H * 0.1, W * 0.94, H * 0.8, H * 0.2);
    g.fill();
  }
  g.fillStyle = lit ? 'rgb(255,30,22)' : '#d41a14';
  for (let i = 0; i < 4; i++) {
    rrect(g, W * 0.3, H * (0.18 + i * 0.17), W * 0.64, H * 0.09, H * 0.04);
    g.fill();
  }
  g.beginPath();
  g.arc(W * 0.16, H * 0.5, H * 0.24, 0, Math.PI * 2);
  g.fill();
  if (!lit) {
    g.fillStyle = '#18090a';
    g.beginPath();
    g.arc(W * 0.16, H * 0.5, H * 0.12, 0, Math.PI * 2);
    g.fill();
    // Reverse lamp and indicator are not part of the brake light.
    g.fillStyle = '#d8d8de';
    rrect(g, W * 0.34, H * 0.76, W * 0.2, H * 0.1, H * 0.04);
    g.fill();
    g.fillStyle = '#d9820e';
    rrect(g, W * 0.7, H * 0.76, W * 0.22, H * 0.1, H * 0.04);
    g.fill();
  }
}

function lampTextures(kind: 'head' | 'tail'): LampTex {
  let t = lampCache.get(kind);
  if (t) return t;
  const make = (lit: boolean) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    (kind === 'head' ? drawHeadlamp : drawTaillamp)(g, 256, 128, lit);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  t = { map: make(false), emissive: make(true) };
  lampCache.set(kind, t);
  return t;
}

// ---------------------------------------------------------------------------

/** Light materials whose brightness changes at runtime (day/night, braking). */
export class CarLights {
  /** Bare bulbs / LED strips. */
  readonly head: THREE.MeshPhysicalMaterial;
  /** Flat red lamp surface. */
  readonly tail: THREE.MeshPhysicalMaterial;
  /** Opaque lamp units with a painted reflector texture. */
  readonly headlamp: THREE.MeshPhysicalMaterial;
  readonly taillamp: THREE.MeshPhysicalMaterial;
  /** Clear and red covers: they only glow a little. */
  readonly lens: THREE.MeshPhysicalMaterial;
  readonly taillens: THREE.MeshPhysicalMaterial;
  /** Materials derived from the author's lamp textures. */
  private readonly mapped: { mat: THREE.MeshPhysicalMaterial; tail: boolean }[] = [];
  private readonly mappedBy = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
  private night = false;
  private braking = false;

  constructor() {
    const clearcoat = { clearcoat: 1, clearcoatRoughness: 0.05 };
    this.head = limitGlare(new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, emissive: new THREE.Color(1, 0.95, 0.86), roughness: 0.05, ...clearcoat }));
    this.tail = limitGlare(new THREE.MeshPhysicalMaterial({ color: 0x2a0303, emissive: new THREE.Color(1, 0.025, 0.012), roughness: 0.1, ...clearcoat }));
    const h = lampTextures('head');
    this.headlamp = limitGlare(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: h.map, emissive: new THREE.Color(1, 0.95, 0.86), emissiveMap: h.emissive, roughness: 0.25, metalness: 0.3, ...clearcoat,
      }),
    );
    const t = lampTextures('tail');
    this.taillamp = limitGlare(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: t.map, emissive: new THREE.Color(1, 0.9, 0.9), emissiveMap: t.emissive, roughness: 0.2, metalness: 0.15, ...clearcoat,
      }),
    );
    this.lens = limitGlare(
      new THREE.MeshPhysicalMaterial({
        color: 0xdfe6ec, roughness: 0.02, ior: 1.6, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.6, ...clearcoat,
      }),
    );
    this.taillens = limitGlare(
      new THREE.MeshPhysicalMaterial({
        color: 0x8a0508, emissive: new THREE.Color(1, 0.02, 0.01), roughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false, ...clearcoat,
      }),
    );
    this.apply();
  }

  /** A lamp material that keeps the author's texture and glows through it. */
  lampFrom(src: THREE.Material, tail: boolean): THREE.MeshPhysicalMaterial {
    const cached = this.mappedBy.get(src);
    if (cached) return cached;
    const s = src as THREE.MeshStandardMaterial;
    const mat = limitGlare(new THREE.MeshPhysicalMaterial({
      color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
      map: s.map ?? null,
      emissive: tail ? new THREE.Color(1, 0.12, 0.08) : new THREE.Color(1, 0.95, 0.86),
      emissiveMap: s.emissiveMap ?? s.map ?? null,
      roughness: 0.2,
      metalness: Math.min(0.4, s.metalness ?? 0),
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transparent: s.transparent,
      opacity: s.opacity,
      alphaTest: s.alphaTest,
      side: s.side,
    }));
    this.mapped.push({ mat, tail });
    this.mappedBy.set(src, mat);
    this.apply();
    return mat;
  }

  all(): THREE.Material[] {
    return [this.head, this.tail, this.headlamp, this.taillamp, this.lens, this.taillens, ...this.mapped.map((m) => m.mat)];
  }

  setNight(on: boolean): void {
    this.night = on;
    this.apply();
  }

  setBrake(on: boolean): void {
    if (on === this.braking) return;
    this.braking = on;
    this.apply();
  }

  private apply(): void {
    // Values are HDR; the bloom threshold is high by day (≈3) and ~1.7 at night. By day the lamps read
    // as lit DRLs without blooming, at night they flare. Tail lights stay moderate because ACES
    // desaturates very bright reds towards salmon.
    const head = this.night ? 3.2 : 0.5;
    // Red luminance is ~0.21 × intensity, so braking needs a large factor to read as bright.
    const tail = this.braking ? (this.night ? 7 : 16) : this.night ? 1.1 : 0.35;
    this.head.emissiveIntensity = head;
    this.tail.emissiveIntensity = tail;
    this.headlamp.emissiveIntensity = this.night ? 3.4 : 0.9;
    this.taillamp.emissiveIntensity = tail * 0.9;
    this.lens.emissiveIntensity = 0;
    this.taillens.emissiveIntensity = tail * 0.22;
    for (const { mat, tail: isTail } of this.mapped) mat.emissiveIntensity = isTail ? tail * 0.8 : this.night ? 2.4 : 0.3;
  }
}

const DARK_GLASS = new THREE.Color(0x010203);

/** Per-car material set. Paint/lights are unique per car so they can be recoloured. */
export class CarMaterialSet {
  readonly paint: THREE.MeshPhysicalMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly trim: THREE.MeshStandardMaterial;
  readonly plastic: THREE.MeshStandardMaterial;
  readonly plate: THREE.MeshStandardMaterial;
  readonly tire: THREE.MeshStandardMaterial;
  readonly rim: THREE.MeshStandardMaterial;
  readonly lights = new CarLights();
  private readonly interior: boolean;

  constructor(opts: CarPaintOptions) {
    const m = THREE.MathUtils.clamp(opts.metallic, 0, 1);
    const tint = THREE.MathUtils.clamp(opts.tint, 0, 1);
    this.interior = opts.interior !== false;
    // Flaked base under a mirror clear coat: solid paints are dielectric, metallic ones gain metalness
    // (kept moderate: high values turn the body into coloured chrome) and a tighter base lobe.
    this.paint = limitGlare(new THREE.MeshPhysicalMaterial({
      color: opts.paint,
      metalness: 0.08 + m * 0.5,
      roughness: 0.46 - m * 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.1,
    }));
    // Glass darkens what is behind it but adds its reflections at full strength (src ONE, dst 1-α).
    this.glass = limitGlare(new THREE.MeshPhysicalMaterial({
      metalness: 0,
      roughness: 0.02,
      ior: 2,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      envMapIntensity: 1.7,
    }));
    this.setTint(tint);
    this.chrome = limitGlare(new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.22 }));
    this.trim = limitGlare(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.5 }));
    this.plastic = limitGlare(new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.05, roughness: 0.6 }));
    this.plate = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, metalness: 0.2, roughness: 0.45 });
    this.tire = limitGlare(new THREE.MeshStandardMaterial({ color: 0x1b1b1c, metalness: 0, roughness: 0.8 }));
    this.rim = limitGlare(new THREE.MeshStandardMaterial({ color: opts.rim, metalness: 0.95, roughness: 0.22 }));
  }

  get(cls: Exclude<PartClass, 'keep' | 'headmap' | 'tailmap'>): THREE.Material {
    switch (cls) {
      case 'paint':
        return this.paint;
      case 'glass':
        return this.glass;
      case 'head':
        return this.lights.head;
      case 'tail':
        return this.lights.tail;
      case 'headlamp':
        return this.lights.headlamp;
      case 'taillamp':
        return this.lights.taillamp;
      case 'lens':
        return this.lights.lens;
      case 'taillens':
        return this.lights.taillens;
      case 'chrome':
        return this.chrome;
      case 'trim':
        return this.trim;
      case 'plastic':
        return this.plastic;
      case 'plate':
        return this.plate;
      case 'tire':
        return this.tire;
      case 'rim':
        return this.rim;
    }
  }

  setPaint(color: THREE.ColorRepresentation): void {
    this.paint.color.set(color);
  }

  /** Window tint 0 (clear) .. 1 (limo). Models without a cabin keep their glass more opaque. */
  setTint(tint: number): void {
    const t = THREE.MathUtils.clamp(tint, 0, 1);
    this.glass.color.set(0x4a525b).lerp(DARK_GLASS, t);
    this.glass.opacity = THREE.MathUtils.lerp(this.interior ? 0.2 : 0.6, 0.9, t);
  }

  all(): THREE.Material[] {
    return [this.paint, this.glass, this.chrome, this.trim, this.plastic, this.plate, this.tire, this.rim, ...this.lights.all()];
  }
}

/** Soft elliptical blob that grounds the car (ambient occlusion under the chassis). */
let contactTexture: THREE.Texture | null = null;
export function createContactShadow(length: number, width: number): THREE.Mesh {
  if (!contactTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.92)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    contactTexture = new THREE.CanvasTexture(c);
  }
  const geo = new THREE.PlaneGeometry(width * 1.25, length * 1.12);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    depthWrite: false,
    color: 0x000000,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  // Texture alpha carries the falloff; colour stays black.
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  mesh.name = 'contact-shadow';
  return mesh;
}
