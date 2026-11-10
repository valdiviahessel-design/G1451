import * as THREE from 'three';
import { isNight, type LightingPreset } from '../core/EventBus';
import type { ThemeId } from '../gameplay/maps';
import { createAsphalt, createConcrete, createDistancePlate, createGrass, createLaneSign, createMarkingWear, createMergeArrow } from './ProceduralTextures';
import { createRoadMaterial, setRoadWetness } from './RoadMaterial';
import {
  NEON_COLS,
  NEON_ROWS,
  createAdAtlas,
  createFacadeTex,
  createGantrySign,
  createGlow,
  createNeonAtlas,
  createTreeTexture,
  createWallTex,
  type FacadeStyle,
  type TreeKind,
} from './WorldTextures';

export type SignKind = 'start' | 'end';

const FACADES: Record<ThemeId, [FacadeStyle, number][]> = {
  city: [
    ['panel', 11],
    ['panel', 23],
    ['glass', 37],
    ['office', 41],
  ],
  japan: [],
  tokyo: [
    ['tokyo', 5],
    ['tokyo', 17],
    ['tokyo', 29],
    ['glass', 43],
  ],
};

/**
 * Instanced boxes share one unit geometry, so window UVs are rescaled in the
 * vertex shader from each instance's scale (one texture tile = 28 m).
 */
function patchFacadeUv(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_INSTANCING
  vec3 iScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec2 faceScale = abs(normal.x) > 0.5 ? iScale.zy : (abs(normal.z) > 0.5 ? iScale.xy : vec2(0.0));
  vec2 facadeUv = uv * faceScale / 28.0 + 0.004;
  vMapUv = facadeUv;
  vEmissiveMapUv = facadeUv;
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'facade-instanced-v1';
}

/** Per-instance atlas cell: the geometry carries an instanced `aCell` (uv offset). */
function patchAtlas<T extends THREE.Material>(mat: T, cols: number, rows: number, emissive = false): T {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  vMapUv = uv * vec2(${(1 / cols).toFixed(6)}, ${(1 / rows).toFixed(6)}) + aCell;
  ${emissive ? 'vEmissiveMapUv = vMapUv;' : ''}`,
      );
  };
  mat.customProgramCacheKey = () => `atlas-${cols}x${rows}-${emissive}`;
  return mat;
}

/** All shared materials. Geometry is rebuilt per road chunk; materials never are. */
export class Materials {
  readonly road: THREE.MeshPhysicalMaterial;
  readonly marking: THREE.MeshPhysicalMaterial;
  readonly arrow: THREE.MeshPhysicalMaterial;
  readonly guardrail: THREE.MeshStandardMaterial;
  readonly steelPost: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly grass: THREE.MeshStandardMaterial;
  readonly lampPole: THREE.MeshStandardMaterial;
  readonly lampLens: THREE.MeshStandardMaterial;
  readonly signBack: THREE.MeshStandardMaterial;
  /** Vertex-coloured architecture and props. */
  readonly props: THREE.MeshStandardMaterial;
  /** Same, self-lit: floodlit towers at night. */
  readonly propsLit: THREE.MeshBasicMaterial;
  readonly wall: THREE.MeshStandardMaterial;
  readonly glow: THREE.Texture;
  theme: ThemeId = 'city';
  private readonly signs = new Map<string, THREE.MeshStandardMaterial>();
  private readonly plates = new Map<string, THREE.MeshStandardMaterial>();
  private readonly gantries = new Map<string, THREE.MeshStandardMaterial>();
  private readonly trees = new Map<TreeKind, THREE.MeshStandardMaterial>();
  private readonly facadeSets = new Map<ThemeId, THREE.MeshStandardMaterial[]>();
  private readonly wallTex = new Map<ThemeId, { map: THREE.Texture; emissive: THREE.Texture }>();
  private neonMat: THREE.MeshBasicMaterial | null = null;
  private adMat: THREE.MeshStandardMaterial | null = null;
  private night = false;
  /** Signs are created lazily per chunk, so they read the current preset's glow. */
  private signGlow = 0.04;

  constructor(private readonly anisotropy: number, mobile: boolean) {
    const asphalt = createAsphalt(anisotropy, mobile ? 512 : 1024);
    this.road = createRoadMaterial(asphalt);

    const wear = createMarkingWear(anisotropy);
    this.marking = new THREE.MeshPhysicalMaterial({
      color: 0xf4f4ef,
      map: wear,
      roughness: 0.55,
      clearcoat: 0,
      clearcoatRoughness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.arrow = new THREE.MeshPhysicalMaterial({
      color: 0xf4f4ef,
      map: createMergeArrow(anisotropy),
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.55,
      clearcoatRoughness: 0.08,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    // Weathered galvanised steel: a near-mirror finish reflects the sunset sky as a glowing line.
    this.guardrail = new THREE.MeshStandardMaterial({
      color: 0xa4a8ad,
      metalness: 0.85,
      roughness: 0.48,
      envMapIntensity: 0.55,
      side: THREE.DoubleSide,
    });
    this.steelPost = new THREE.MeshStandardMaterial({ color: 0x8d9196, metalness: 0.9, roughness: 0.5 });

    const concreteTex = createConcrete(anisotropy);
    this.concrete = new THREE.MeshStandardMaterial({
      map: concreteTex,
      bumpMap: concreteTex,
      bumpScale: 1.5,
      roughness: 0.88,
    });

    const grassTex = createGrass(anisotropy);
    // Pushed back in depth so the road always wins where they overlap, even at 1 km.
    this.grass = new THREE.MeshStandardMaterial({
      map: grassTex,
      roughness: 0.97,
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 16,
    });

    this.lampPole = new THREE.MeshStandardMaterial({ color: 0x5b6066, metalness: 0.85, roughness: 0.45 });
    this.lampLens = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(1, 0.78, 0.5),
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    this.signBack = new THREE.MeshStandardMaterial({ color: 0x8e9399, metalness: 0.7, roughness: 0.55 });

    this.props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    this.propsLit = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.wall = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0, side: THREE.DoubleSide });
    this.glow = createGlow();
  }

  /** Retro-reflective sign face (emissive keeps it readable in headlights at night). */
  sign(kind: SignKind, side: -1 | 1): THREE.MeshStandardMaterial {
    const key = `${kind}${side}`;
    let m = this.signs.get(key);
    if (!m) {
      const tex = createLaneSign(kind, side, this.anisotropy);
      m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: this.signGlow, roughness: 0.35 });
      this.signs.set(key, m);
    }
    return m;
  }

  plate(text: string): THREE.MeshStandardMaterial {
    let m = this.plates.get(text);
    if (!m) {
      const tex = createDistancePlate(text, this.anisotropy);
      m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: this.signGlow, roughness: 0.35 });
      this.plates.set(text, m);
    }
    return m;
  }

  /** Overhead direction sign for the current theme. */
  gantrySign(variant: number): THREE.MeshStandardMaterial {
    const key = `${this.theme}${variant % 3}`;
    let m = this.gantries.get(key);
    if (!m) {
      const tex = createGantrySign(this.theme, variant, this.anisotropy);
      m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: this.signGlow, roughness: 0.4 });
      this.gantries.set(key, m);
    }
    return m;
  }

  /** Alpha-tested billboard material for one tree species. */
  tree(kind: TreeKind): THREE.MeshStandardMaterial {
    let m = this.trees.get(kind);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        map: createTreeTexture(kind, Math.min(4, this.anisotropy)),
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        roughness: 1,
        metalness: 0,
      });
      this.trees.set(kind, m);
    }
    return m;
  }

  facades(theme: ThemeId): THREE.MeshStandardMaterial[] {
    let set = this.facadeSets.get(theme);
    if (!set) {
      set = FACADES[theme].map(([style, seed]) => {
        const t = createFacadeTex(style, seed, this.anisotropy);
        const m = new THREE.MeshStandardMaterial({
          map: t.map,
          emissiveMap: t.emissive,
          emissive: 0xffffff,
          emissiveIntensity: this.night ? 2.6 : 0.08,
          roughness: style === 'glass' ? 0.25 : 0.6,
          metalness: style === 'glass' ? 0.6 : 0.15,
        });
        patchFacadeUv(m);
        return m;
      });
      this.facadeSets.set(theme, set);
    }
    return set;
  }

  /** Vertical neon boards; pair with an instanced `aCell` attribute. */
  get neon(): THREE.MeshBasicMaterial {
    this.neonMat ??= patchAtlas(new THREE.MeshBasicMaterial({ map: createNeonAtlas(this.anisotropy), side: THREE.DoubleSide }), NEON_COLS, NEON_ROWS);
    this.neonMat.color.setScalar(this.night ? 2.6 : 1);
    return this.neonMat;
  }

  /** Advert faces of roadside hoardings; pair with an instanced `aCell` attribute. */
  get ads(): THREE.MeshStandardMaterial {
    if (!this.adMat) {
      const tex = createAdAtlas(this.anisotropy);
      this.adMat = patchAtlas(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, roughness: 0.5 }), 2, 2, true);
    }
    this.adMat.emissiveIntensity = this.night ? 0.9 : 0.05;
    return this.adMat;
  }

  /** Road furniture look of a map's world; call before chunks are (re)built. */
  applyTheme(theme: ThemeId): void {
    this.theme = theme;
    let wt = this.wallTex.get(theme);
    if (!wt) {
      wt = createWallTex(theme, this.anisotropy);
      this.wallTex.set(theme, wt);
    }
    this.wall.map = wt.map;
    this.wall.emissiveMap = wt.emissive;
    this.wall.needsUpdate = true;
    // Japan paints its barriers white; elsewhere they are bare galvanised steel.
    const japan = theme !== 'city';
    this.guardrail.color.setHex(japan ? 0xe6e8ea : 0xa4a8ad);
    this.guardrail.metalness = japan ? 0.25 : 0.85;
    this.guardrail.roughness = japan ? 0.55 : 0.48;
    if (theme === 'tokyo') this.lampLens.emissive.setRGB(0.75, 0.9, 1);
    else this.lampLens.emissive.setRGB(1, 0.78, 0.5);
    this.lampPole.color.setHex(theme === 'japan' ? 0x8a9096 : 0x5b6066);
  }

  applyPreset(preset: LightingPreset): void {
    const night = isNight(preset);
    this.night = night;
    setRoadWetness(this.road, preset === 'night' ? 1 : preset === 'neon' ? 0.85 : 0);
    for (const m of [this.marking, this.arrow]) {
      m.clearcoat = night ? 0.9 : 0;
      m.color.setScalar(night ? 0.75 : 0.95);
      m.needsUpdate = true;
    }
    this.lampLens.emissiveIntensity = night ? 3.5 : 0;
    for (const set of this.facadeSets.values()) for (const m of set) m.emissiveIntensity = night ? 2.6 : 0.08;
    this.signGlow = night ? 0.35 : 0.04;
    for (const m of [...this.signs.values(), ...this.plates.values(), ...this.gantries.values()]) m.emissiveIntensity = this.signGlow;
    this.concrete.roughness = night ? 0.55 : 0.88;
    this.wall.emissiveIntensity = night ? 2.2 : 0;
    if (this.neonMat) this.neonMat.color.setScalar(night ? 2.6 : 1);
    if (this.adMat) this.adMat.emissiveIntensity = night ? 0.9 : 0.05;
    const k = night ? 0.55 : 1;
    if (this.theme === 'japan') this.grass.color.setRGB(0.74 * k, 1.12 * k, 0.6 * k);
    else if (this.theme === 'tokyo') this.grass.color.setRGB(0.3 * k, 0.32 * k, 0.4 * k);
    else this.grass.color.setScalar(k);
  }
}
