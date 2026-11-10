import * as THREE from 'three';
import { TRAFFIC_CARS, type TrafficSpec } from '../assets/vehicles';
import type { VehicleLoader, VehicleModel } from '../assets/VehicleLoader';
import type { TrafficCar, TrafficType } from './TrafficSystem';

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
    const p = new Pooled(model, spec);
    p.model.materials.lights.setNight(this.night);
    if (this.ghost) ghostModel(model.root, true);
    return p;
  }

  private release(p: Pooled): void {
    p.model.root.removeFromParent();
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
    for (const p of this.active.values()) ghostModel(p.model.root, on);
    for (const list of this.free.values()) for (const p of list) ghostModel(p.model.root, on);
  }

  update(dt: number, cars: readonly TrafficCar[], origin: number): void {
    this.time += dt;
    // ~1.5 Hz indicator cadence, per-car phase so a queue doesn't flash in sync.
    for (const c of cars) {
      const p = this.active.get(c.id);
      if (!p) continue;
      const { root, body, wheels, wheelRadius } = p.model;
      root.position.set(c.x, 0, -(c.s - origin));
      root.rotation.y = -c.psi;
      body.rotation.x = THREE.MathUtils.clamp(c.accel, -8, 3) * 0.0045;
      body.rotation.z = -c.bumpV * 0.02;
      const spin = (c.v / wheelRadius) * dt;
      for (const w of wheels) {
        w.spin.rotation.x -= spin;
        if (w.front) w.steer.rotation.y = -c.psi * 2.5;
      }
      p.model.materials.lights.setBrake(c.braking);
      p.setBlink(c.signal, (this.time + c.id * 0.137) % 0.68 < 0.36);
    }
  }

  dispose(): void {
    this.clear();
    for (const list of this.free.values()) for (const p of list) p.dispose();
    this.free.clear();
  }
}
