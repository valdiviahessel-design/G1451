import * as THREE from 'three';
import { TRAFFIC_CARS, type TrafficSpec } from '../assets/vehicles';
import type { VehicleLoader, VehicleModel } from '../assets/VehicleLoader';
import type { GlowSprites } from '../graphics/GlowSprites';
import { bakeTrafficLod, createLodMaterial } from './TrafficLod';
import type { TrafficCar, TrafficType } from './TrafficSystem';

/** Detailed models are only drawn this close to the player; beyond it cars use the instanced LOD. */
const NEAR_AHEAD = 105;
const NEAR_BEHIND = 28;
const LOD_CAPACITY = 32;

/** Instanced far LOD of one traffic type, plus an invisible twin that only casts shadows. */
interface LodSet {
  far: THREE.InstancedMesh;
  shadow: THREE.InstancedMesh;
  nFar: number;
  nShadow: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** Simulation types derived from the traffic model specs; vans are the slow, keep-right class. */
export const TRAFFIC_TYPES: TrafficType[] = TRAFFIC_CARS.map((t) => ({
  id: t.id,
  length: t.length,
  width: t.width,
  height: t.height,
  weight: t.weight,
  heavy: t.id === 'van',
}));

const BLINK_GEO = new THREE.BoxGeometry(0.17, 0.08, 0.05);
// HDR amber: well above the bloom threshold so indicators glow like real bulbs.
const BLINK_ON = new THREE.Color(9, 3.6, 0.3);
const GHOST_OPACITY = 0.35;

/** Fades a model to a see-through ghost and back; the original blend state is kept in userData. */
function ghostModel(root: THREE.Object3D, on: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const saved = (m.userData.ghostSaved ??= { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }) as {
        transparent: boolean;
        opacity: number;
        depthWrite: boolean;
      };
      m.transparent = on || saved.transparent;
      m.opacity = on ? saved.opacity * GHOST_OPACITY : saved.opacity;
      m.depthWrite = on ? false : saved.depthWrite;
      m.needsUpdate = true;
    }
  });
}

class Pooled {
  /** Drawn as the detailed model (true) or as an LOD instance. */
  near = true;
  readonly blinkL: THREE.MeshBasicMaterial;
  readonly blinkR: THREE.MeshBasicMaterial;

  constructor(
    readonly model: VehicleModel,
    readonly spec: TrafficSpec,
  ) {
    this.blinkL = new THREE.MeshBasicMaterial({ color: BLINK_ON });
    this.blinkR = new THREE.MeshBasicMaterial({ color: BLINK_ON });
    const { length: L, width: W, height: H } = spec;
    // Corner indicators front and rear; rear ones sit at tail-lamp height.
    for (const [side, mat] of [[-1, this.blinkL], [1, this.blinkR]] as const) {
      for (const [z, y] of [[L / 2 - 0.08, H * 0.56], [-L / 2 + 0.1, H * 0.42]]) {
        const m = new THREE.Mesh(BLINK_GEO, mat);
        m.position.set(side * (W / 2 - 0.16), y, z);
        model.root.add(m);
      }
    }
    this.setBlink(0, false);
  }

  setBlink(signal: number, on: boolean): void {
    this.blinkL.visible = on && signal < 0;
    this.blinkR.visible = on && signal > 0;
  }

  dispose(): void {
    this.blinkL.dispose();
    this.blinkR.dispose();
    this.model.dispose();
  }
}

/**
 * Renders TrafficSystem cars with a per-type object pool: despawned models go
 * back to the pool and are repainted on reuse, so steady-state traffic never
 * loads or compiles anything.
 */
export class TrafficView {
  private readonly specs = new Map(TRAFFIC_CARS.map((s) => [s.id, s]));
  private readonly free = new Map<string, Pooled[]>();
  private readonly active = new Map<number, Pooled>();
  private readonly pending = new Set<number>();
  private night = false;
  private ghost = false;
  private time = 0;
  private readonly lods = new Map<string, LodSet>();
  private readonly lodMat = createLodMaterial();
  /** Writes nothing in the colour pass; the shadow pass swaps in its own depth material. */
  private readonly shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private shadows = true;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader: VehicleLoader,
  ) {}

  /** Loads `perType` instances of every type up front (also warms shader programs). */
  async preload(perType = 2): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const spec of TRAFFIC_CARS) {
      for (let i = 0; i < perType; i++) jobs.push(this.create(spec).then((p) => this.release(p)));
    }
    await Promise.all(jobs);
  }

  /** Every pooled model, for renderer.compileAsync during loading. */
  warm(): THREE.Object3D {
    const g = new THREE.Group();
    for (const list of this.free.values()) for (const p of list) g.add(p.model.root);
    return g;
  }

  /** Hands warm()-borrowed models back to the scene graph's control. */
  unwarm(g: THREE.Object3D): void {
    for (const c of [...g.children]) g.remove(c);
  }

  private async create(spec: TrafficSpec): Promise<Pooled> {
    const model = await this.loader.load(spec.sources, { ...spec, paint: spec.paints[0], metallic: 0.35, rim: 0x9a9da3, tint: 0.55 });
    model.root.traverse((o) => {
      // Traffic receives but doesn't cast: dozens of extra shadow casters are too costly on mobile.
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
    });
    if (!this.lods.has(spec.id)) {
      const lod = bakeTrafficLod(model);
      const far = new THREE.InstancedMesh(lod.far, this.lodMat, LOD_CAPACITY);
      const shadow = new THREE.InstancedMesh(lod.full, this.shadowMat, LOD_CAPACITY);
      far.setColorAt(0, new THREE.Color(1, 1, 1));
      for (const im of [far, shadow]) {
        im.count = 0;
        im.frustumCulled = false;
        this.scene.add(im);
      }
      far.receiveShadow = true;
      shadow.castShadow = true;
      this.lods.set(spec.id, { far, shadow, nFar: 0, nShadow: 0 });
    }
    const p = new Pooled(model, spec);
    p.model.materials.lights.setNight(this.night);
    if (this.ghost) ghostModel(model.root, true);
    return p;
  }

  private release(p: Pooled): void {
    p.model.root.removeFromParent();
    p.model.root.visible = true;
    p.near = true;
    p.setBlink(0, false);
    p.model.materials.lights.setBrake(false);
    const list = this.free.get(p.spec.id) ?? [];
    list.push(p);
    this.free.set(p.spec.id, list);
  }

  add(car: TrafficCar): void {
    const spec = this.specs.get(car.type.id);
    if (!spec) return;
    const reuse = this.free.get(spec.id)?.pop();
    if (reuse) {
      this.attach(car, reuse);
      return;
    }
    this.pending.add(car.id);
    void this.create(spec).then((p) => {
      if (this.pending.delete(car.id)) this.attach(car, p);
      else this.release(p);
    });
  }

  private attach(car: TrafficCar, p: Pooled): void {
    const paint = p.spec.paints[car.paint % p.spec.paints.length];
    if (paint !== -1) p.model.materials.paint.color.setHex(paint);
    p.model.materials.lights.setNight(this.night);
    this.active.set(car.id, p);
    this.scene.add(p.model.root);
  }

  remove(car: TrafficCar): void {
    this.pending.delete(car.id);
    const p = this.active.get(car.id);
    if (!p) return;
    this.active.delete(car.id);
    this.release(p);
  }

  /** Removes every car (new run). */
  clear(): void {
    this.pending.clear();
    for (const p of this.active.values()) this.release(p);
    this.active.clear();
  }

  setNight(on: boolean): void {
    this.night = on;
    for (const p of this.active.values()) p.model.materials.lights.setNight(on);
    for (const list of this.free.values()) for (const p of list) p.model.materials.lights.setNight(on);
  }

  /** Ghost traffic: see-through bots (settings → «Прозрачные боты»). */
  setGhost(on: boolean): void {
    if (on === this.ghost) return;
    this.ghost = on;
    this.lodMat.transparent = on;
    this.lodMat.opacity = on ? GHOST_OPACITY : 1;
    this.lodMat.depthWrite = !on;
    this.lodMat.needsUpdate = true;
    for (const p of this.active.values()) ghostModel(p.model.root, on);
    for (const list of this.free.values()) for (const p of list) ghostModel(p.model.root, on);
  }

  /** Traffic shadows come from the LOD twins; off with the sun's shadow map. */
  setShadows(on: boolean): void {
    this.shadows = on;
  }

  /**
   * Cars near the player show their detailed model (lights, indicators, spinning
   * wheels); the rest go into one instanced draw per type. `glows` receives the
   * tail lights of those distant cars.
   */
  update(dt: number, cars: readonly TrafficCar[], origin: number, playerS: number, glows: GlowSprites | null = null): void {
    this.time += dt;
    for (const l of this.lods.values()) l.nFar = l.nShadow = 0;
    const castShadows = this.shadows && !this.ghost;
    for (const c of cars) {
      const p = this.active.get(c.id);
      if (!p) continue;
      const { root, body, wheels, wheelRadius } = p.model;
      const d = c.s - playerS;
      const lod = this.lods.get(p.spec.id);
      // A little hysteresis so a car pacing the boundary doesn't flicker between forms.
      const slack = p.near ? 8 : 0;
      p.near = !lod || (d < NEAR_AHEAD + slack && d > -NEAR_BEHIND - slack);
      root.visible = p.near;
      const z = -(c.s - origin);
      if (lod && (!p.near || (castShadows && d > -50 && d < 90))) {
        _m.compose(_p.set(c.x, 0, z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -c.psi), _one);
        if (!p.near && lod.nFar < LOD_CAPACITY) {
          lod.far.setMatrixAt(lod.nFar, _m);
          lod.far.setColorAt(lod.nFar++, p.model.materials.paint.color);
        }
        if (castShadows && d > -50 && d < 90 && lod.nShadow < LOD_CAPACITY) lod.shadow.setMatrixAt(lod.nShadow++, _m);
      }
      if (!p.near) {
        if (glows && (this.night || c.braking)) {
          const k = c.braking ? 2.4 : 1;
          const w = p.spec.width * 0.36;
          const y = p.spec.height * 0.52;
          const zr = z + p.spec.length / 2;
          glows.add(c.x - w, y, zr, 1.0 * k, 2.4 * k, 0.1, 0.06);
          glows.add(c.x + w, y, zr, 1.0 * k, 2.4 * k, 0.1, 0.06);
        }
        continue;
      }
      root.position.set(c.x, 0, z);
      root.rotation.y = -c.psi;
      body.rotation.x = THREE.MathUtils.clamp(c.accel, -8, 3) * 0.0045;
      body.rotation.z = -c.bumpV * 0.02;
      const spin = (c.v / wheelRadius) * dt;
      for (const w of wheels) {
        w.spin.rotation.x -= spin;
        if (w.front) w.steer.rotation.y = -c.psi * 2.5;
      }
      p.model.materials.lights.setBrake(c.braking);
      // ~1.5 Hz indicator cadence, per-car phase so a queue doesn't flash in sync.
      p.setBlink(c.signal, (this.time + c.id * 0.137) % 0.68 < 0.36);
    }
    for (const l of this.lods.values()) {
      l.far.count = l.nFar;
      l.shadow.count = l.nShadow;
      if (l.nFar) {
        l.far.instanceMatrix.needsUpdate = true;
        l.far.instanceColor!.needsUpdate = true;
      }
      if (l.nShadow) l.shadow.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
    for (const l of this.lods.values()) {
      l.far.removeFromParent();
      l.shadow.removeFromParent();
      l.far.geometry.dispose();
      l.shadow.geometry.dispose();
    }
    this.lodMat.dispose();
    this.shadowMat.dispose();
    for (const list of this.free.values()) for (const p of list) p.dispose();
    this.free.clear();
  }
}
