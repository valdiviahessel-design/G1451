import * as THREE from 'three';
import { BASE_HALF_WIDTH, LANE_WIDTH, OPP_OUTER, SHOULDER_WIDTH } from '../config';
import { isNight, type LightingPreset } from '../core/EventBus';
import { Rng } from '../core/math';
import type { ThemeId } from '../gameplay/maps';
import {
  billboardGeometry,
  castleGeometry,
  fujiGeometry,
  hoardingGeometry,
  houseGeometry,
  neonGeometry,
  pagodaGeometry,
  skytreeGeometry,
  toriiGeometry,
  towerGeometry,
} from '../world/props';
import type { Materials } from './Materials';
import { NEON_COLS, NEON_ROWS, createBackdrop, type TreeKind } from './WorldTextures';

const TERRAIN_SIZE = 4000;
/** Grass texture tile size in meters; terrain snaps to it so texels stay world-anchored. */
export const GRASS_TILE = 12;

const BEHIND = 300;
const SPAN = 2600;
/** Nearest a prop may stand to the road centre on either side (clear of pockets, shoulders and rails). */
const RIGHT_CLEAR = BASE_HALF_WIDTH + LANE_WIDTH + SHOULDER_WIDTH + 3;
const LEFT_CLEAR = -OPP_OUTER + SHOULDER_WIDTH + 3;

const BACKDROP_RADIUS = 3200;
const BACKDROP_HEIGHT = 420;

interface Placement {
  x: number;
  y: number;
  sx: number;
  sy: number;
  sz: number;
  rot: number;
  /** Instance colour multiplier. */
  r: number;
  g: number;
  b: number;
}

interface LayerDef {
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  count: number;
  place(r: Rng, o: Placement): void;
  /** Evenly spaced along the road (avenues) instead of scattered. */
  even?: boolean;
  shadow?: boolean;
  /** Atlas grid for materials patched with `aCell`. */
  cells?: [number, number];
  span?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

/** One prop type as a recycled instanced mesh: instances that fall behind the car reappear ahead. */
class Layer {
  readonly mesh: THREE.InstancedMesh;
  private readonly s: Float32Array;
  private readonly span: number;
  private readonly o: Placement = { x: 0, y: 0, sx: 1, sy: 1, sz: 1, rot: 0, r: 1, g: 1, b: 1 };

  constructor(
    private readonly def: LayerDef,
    private readonly rng: Rng,
    start: number,
  ) {
    const n = def.count;
    this.span = def.span ?? SPAN;
    let geo = def.geo;
    if (def.cells) {
      // Private copy: the instanced cell attribute is sized to this layer.
      geo = def.geo.clone();
      const cells = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        cells[i * 2] = rng.int(0, def.cells[0] - 1) / def.cells[0];
        cells[i * 2 + 1] = rng.int(0, def.cells[1] - 1) / def.cells[1];
      }
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    }
    this.mesh = new THREE.InstancedMesh(geo, def.mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!def.shadow;
    this.mesh.receiveShadow = false;
    this.s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.s[i] = start - BEHIND + (def.even ? (i + rng.next() * 0.6) / n : rng.next()) * this.span;
      this.write(i);
    }
  }

  private write(i: number): void {
    const o = this.o;
    o.y = 0;
    o.sx = o.sy = o.sz = 1;
    o.rot = 0;
    o.r = o.g = o.b = 1;
    this.def.place(this.rng, o);
    _p.set(o.x, o.y, -this.s[i]);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, o.rot);
    _s.set(o.sx, o.sy, o.sz);
    this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    this.mesh.setColorAt(i, _col.setRGB(o.r, o.g, o.b));
  }

  update(s: number): void {
    const lim = s - BEHIND;
    let dirty = false;
    for (let i = 0; i < this.s.length; i++) {
      if (this.s[i] >= lim) continue;
      while (this.s[i] < lim) this.s[i] += this.span;
      this.write(i);
      dirty = true;
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    if (this.def.cells) this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/** Lateral position `d` metres beyond the clear zone on a random (or given) side. */
function lateral(r: Rng, d: number, side = r.chance(0.5) ? 1 : -1): number {
  return side > 0 ? RIGHT_CLEAR + d : -(LEFT_CLEAR + d);
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const TREE_SIZE: Record<TreeKind, [number, number]> = {
  sakura: [10, 9],
  leafy: [9, 11],
  birch: [7, 12],
  pine: [7, 13],
  bamboo: [7, 10],
  bush: [4.2, 3],
};

/**
 * Everything beside the road: ground, instanced props for the map's theme
 * (trees, buildings, shrines, neon), and the far backdrop (mountain ranges or
 * skyline, plus Mount Fuji in Japan).
 */
export class Scenery {
  private terrain: THREE.Mesh;
  private layers: Layer[] = [];
  private backdrop: THREE.Mesh;
  private backdropTex: THREE.Texture | null = null;
  private fuji: THREE.Mesh | null = null;
  private rng = new Rng(4242);
  private theme: ThemeId | null = null;
  private preset: LightingPreset | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: THREE.Object3D,
    private readonly mats: Materials,
    private readonly mobile: boolean,
  ) {
    // Tessellated: depth interpolated across two 4 km triangles is too coarse near the camera and
    // lets the ground poke through the road, 4 cm above it.
    const plane = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 80, 80);
    plane.rotateX(-Math.PI / 2);
    mats.grass.map!.repeat.set(TERRAIN_SIZE / GRASS_TILE, TERRAIN_SIZE / GRASS_TILE);
    this.terrain = new THREE.Mesh(plane, mats.grass);
    this.terrain.position.y = -0.04;
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);

    const ring = new THREE.CylinderGeometry(BACKDROP_RADIUS, BACKDROP_RADIUS, BACKDROP_HEIGHT, 72, 1, true);
    this.backdrop = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    // The painted horizon (16 % up the texture) sits just above the ground.
    this.backdrop.position.y = BACKDROP_HEIGHT * (0.5 - 0.16) + 2;
    this.backdrop.renderOrder = -10;
    this.backdrop.frustumCulled = false;
    scene.add(this.backdrop);
  }

  private tree(kind: TreeKind, count: number, place: LayerDef['place'], opts: Partial<LayerDef> = {}): LayerDef {
    const [w, h] = TREE_SIZE[kind];
    return { geo: geo(`tree-${kind}`, () => billboardGeometry(w, h, 3)), mat: this.mats.tree(kind), count, place, ...opts };
  }

  private skyline(theme: ThemeId, perMesh: number, near: number, reach: number, lowH: number, highH: number): LayerDef[] {
    const unit = geo('unit-box', () => {
      const b = new THREE.BoxGeometry(1, 1, 1);
      b.translate(0, 0.5, 0);
      return b;
    });
    return this.mats.facades(theme).map((mat) => ({
      geo: unit,
      mat,
      count: perMesh,
      place: (r, o) => {
        const d = near + Math.pow(r.next(), 0.7) * reach;
        o.x = lateral(r, d);
        o.sx = r.range(18, 52);
        o.sz = r.range(18, 48);
        // Close buildings stay low so they never wall in the road.
        o.sy = r.range(12, THREE.MathUtils.lerp(lowH, highH, THREE.MathUtils.smoothstep(d, near, near + reach * 0.6)));
        o.rot = r.chance(0.7) ? 0 : r.range(-0.4, 0.4);
        const v = r.range(0.82, 1.08);
        o.r = o.g = o.b = v;
      },
    }));
  }

  private defs(theme: ThemeId, night: boolean): LayerDef[] {
    const k = this.mobile ? 0.55 : 1;
    const n = (v: number) => Math.max(1, Math.round(v * k));
    const grow = (r: Rng, o: Placement, lo: number, hi: number) => {
      const s = r.range(lo, hi);
      o.sx = o.sz = s * r.range(0.9, 1.1);
      o.sy = s;
      o.rot = r.next() * Math.PI;
      const v = r.range(0.82, 1.06);
      o.r = o.g = o.b = v;
    };

    if (theme === 'japan') {
      const blossom = (r: Rng, o: Placement) => {
        grow(r, o, 0.85, 1.35);
        // Some trees bloom almost white, others deep pink.
        const w = r.next();
        o.r = 1;
        o.g = 0.86 + w * 0.14;
        o.b = 0.9 + w * 0.1;
      };
      const landmark = geo('torii-small', () => toriiGeometry(5, 5.2, 0.32));
      return [
        this.tree('sakura', n(170), (r, o) => { blossom(r, o); o.x = lateral(r, r.range(1.5, 6), 1); }, { even: true, shadow: true }),
        this.tree('sakura', n(170), (r, o) => { blossom(r, o); o.x = lateral(r, r.range(1.5, 6), -1); }, { even: true }),
        this.tree('sakura', n(150), (r, o) => { blossom(r, o); o.x = lateral(r, 12 + Math.pow(r.next(), 1.4) * 170); }),
        this.tree('pine', n(110), (r, o) => { grow(r, o, 0.8, 1.5); o.x = lateral(r, 14 + r.next() * 210); }),
        this.tree('bamboo', n(80), (r, o) => { grow(r, o, 0.8, 1.3); o.x = lateral(r, 9 + r.next() * 90); }),
        this.tree('bush', n(90), (r, o) => { grow(r, o, 0.7, 1.4); o.x = lateral(r, r.next() * 40); }),
        { geo: geo('house', houseGeometry), mat: this.mats.props, count: n(46), place: (r, o) => { o.x = lateral(r, 26 + r.next() * 210); o.rot = r.int(0, 3) * (Math.PI / 2) + r.range(-0.2, 0.2); const s = r.range(0.9, 1.3); o.sx = o.sy = o.sz = s; } },
        { geo: geo('pagoda', () => pagodaGeometry()), mat: this.mats.props, count: 5, place: (r, o) => { o.x = lateral(r, 70 + r.next() * 300); const s = r.range(0.9, 1.5); o.sx = o.sy = o.sz = s; } },
        { geo: geo('castle', castleGeometry), mat: this.mats.props, count: 1, span: SPAN * 2, place: (r, o) => { o.x = lateral(r, 260 + r.next() * 200); o.rot = r.range(-0.5, 0.5); } },
        { geo: landmark, mat: this.mats.props, count: 7, place: (r, o) => { o.x = lateral(r, 7 + r.next() * 30); o.rot = r.range(0.3, 0.9) * (o.x > 0 ? -1 : 1); } },
      ];
    }

    if (theme === 'tokyo') {
      const lit = night ? this.mats.propsLit : this.mats.props;
      return [
        ...this.skyline('tokyo', n(46), 14, 420, 95, 260),
        {
          geo: geo('neon', neonGeometry),
          mat: this.mats.neon,
          count: n(120),
          cells: [NEON_COLS, NEON_ROWS],
          place: (r, o) => {
            o.x = lateral(r, 5 + r.next() * 46);
            o.y = r.range(8, 46);
            const s = r.range(2.2, 4.6);
            o.sx = o.sy = s;
            // Angled a little toward the carriageway, like boards hung off building fronts.
            o.rot = (o.x > 0 ? -1 : 1) * r.range(0.1, 0.5);
          },
        },
        { geo: geo('tower', towerGeometry), mat: lit, count: 1, span: SPAN * 2, place: (r, o) => { o.x = lateral(r, 380 + r.next() * 260); } },
        { geo: geo('skytree', skytreeGeometry), mat: lit, count: 1, span: SPAN * 3, place: (r, o) => { o.x = lateral(r, 520 + r.next() * 300); } },
        this.tree('leafy', n(40), (r, o) => { grow(r, o, 0.7, 1.1); o.x = lateral(r, 3 + r.next() * 12); o.r = o.g = o.b = 0.6; }),
      ];
    }

    return [
      ...this.skyline('city', n(40), 76, 520, 34, 150),
      this.tree('leafy', n(150), (r, o) => { grow(r, o, 0.8, 1.4); o.x = lateral(r, 3 + Math.pow(r.next(), 1.5) * 64); }, { shadow: true }),
      this.tree('birch', n(100), (r, o) => { grow(r, o, 0.8, 1.3); o.x = lateral(r, 3 + r.next() * 62); }),
      this.tree('pine', n(120), (r, o) => { grow(r, o, 0.8, 1.5); o.x = lateral(r, 6 + r.next() * 66); }),
      this.tree('bush', n(110), (r, o) => { grow(r, o, 0.7, 1.4); o.x = lateral(r, r.next() * 30); }),
      {
        geo: geo('hoarding', hoardingGeometry),
        mat: [this.mats.props, this.mats.ads],
        count: 5,
        cells: [2, 2],
        shadow: true,
        place: (r, o) => { o.x = lateral(r, 3 + r.next() * 5, 1); o.rot = -0.22; },
      },
    ];
  }

  /**
   * Rebuilds the roadside for a map. `fog` is the scene fog colour the backdrop
   * fades into; `sun` aims the baked light on Mount Fuji; `s` is the car position.
   */
  setTheme(theme: ThemeId, preset: LightingPreset, fog: THREE.Color, sun: THREE.Vector3, s: number): void {
    if (theme === this.theme && preset === this.preset) return;
    const night = isNight(preset);
    this.theme = theme;
    this.preset = preset;

    for (const l of this.layers) l.dispose();
    this.layers = this.defs(theme, night).map((d) => {
      const l = new Layer(d, this.rng, s);
      this.world.add(l.mesh);
      return l;
    });

    this.backdropTex?.dispose();
    this.backdropTex = createBackdrop(theme, fog, night, this.mobile ? 2048 : 4096);
    this.backdropTex.repeat.set(2, 1);
    const mat = this.backdrop.material as THREE.MeshBasicMaterial;
    mat.map = this.backdropTex;
    // Lit windows on the horizon should glow a little past white at night.
    mat.color.setScalar(night ? 1.8 : 1);
    mat.needsUpdate = true;

    if (this.fuji) {
      this.fuji.geometry.dispose();
      this.fuji.removeFromParent();
      this.fuji = null;
    }
    if (theme === 'japan') {
      this.fuji = new THREE.Mesh(fujiGeometry(fog, sun), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      this.fuji.frustumCulled = false;
      // Taller than life so the summit clears the roadside blossom.
      this.fuji.scale.set(1.2, 1.75, 1.2);
      this.fuji.renderOrder = -11;
      this.scene.add(this.fuji);
    }
  }

  update(cameraWorld: THREE.Vector3, s: number): void {
    this.terrain.position.x = Math.round(cameraWorld.x / GRASS_TILE) * GRASS_TILE;
    this.terrain.position.z = Math.round(cameraWorld.z / GRASS_TILE) * GRASS_TILE;
    this.backdrop.position.x = cameraWorld.x;
    this.backdrop.position.z = cameraWorld.z;
    // Fuji keeps its bearing ahead-right of the road, like a sky object.
    if (this.fuji) this.fuji.position.set(cameraWorld.x + 1050, -6, cameraWorld.z - 2950);
    for (const l of this.layers) l.update(s);
  }
}
