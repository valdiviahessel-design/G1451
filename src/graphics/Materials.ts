import * as THREE from 'three';
import type { LightingPreset } from '../core/EventBus';
import {
  createAsphalt,
  createConcrete,
  createDistancePlate,
  createFacade,
  createGrass,
  createLaneSign,
  createMarkingWear,
  createMergeArrow,
  type FacadeTextures,
} from './ProceduralTextures';
import { createRoadMaterial, setRoadWetness } from './RoadMaterial';

export type SignKind = 'start' | 'end';

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
  readonly lampHead: THREE.MeshStandardMaterial;
  readonly lampLens: THREE.MeshStandardMaterial;
  readonly signBack: THREE.MeshStandardMaterial;
  readonly facades: THREE.MeshStandardMaterial[];
  private readonly signs = new Map<string, THREE.MeshStandardMaterial>();
  private readonly plates = new Map<string, THREE.MeshStandardMaterial>();
  private readonly facadeTex: FacadeTextures[];
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
    this.lampHead = new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.6, roughness: 0.5 });
    this.lampLens = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(1, 0.78, 0.5),
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    this.signBack = new THREE.MeshStandardMaterial({ color: 0x8e9399, metalness: 0.7, roughness: 0.55 });

    this.facadeTex = [11, 23, 37, 41].map((seed) => createFacade(anisotropy, seed));
    this.facades = this.facadeTex.map(
      (t) =>
        new THREE.MeshStandardMaterial({
          map: t.map,
          emissiveMap: t.emissive,
          emissive: 0xffffff,
          emissiveIntensity: 0.2,
          roughness: 0.55,
          metalness: 0.25,
        }),
    );
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

  applyPreset(preset: LightingPreset): void {
    const night = preset === 'night';
    setRoadWetness(this.road, night ? 1 : 0);
    for (const m of [this.marking, this.arrow]) {
      m.clearcoat = night ? 0.9 : 0;
      m.color.setScalar(night ? 0.75 : 0.95);
      m.needsUpdate = true;
    }
    this.lampLens.emissiveIntensity = night ? 3.5 : 0;
    for (const m of this.facades) m.emissiveIntensity = night ? 2.6 : 0.08;
    this.signGlow = night ? 0.35 : 0.04;
    for (const m of [...this.signs.values(), ...this.plates.values()]) m.emissiveIntensity = this.signGlow;
    this.concrete.roughness = night ? 0.55 : 0.88;
    this.grass.color.setScalar(night ? 0.55 : 1);
  }
}
