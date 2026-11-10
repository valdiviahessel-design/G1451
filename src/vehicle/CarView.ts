import * as THREE from 'three';
import type { VehicleSpec } from '../assets/vehicles';
import type { VehicleLoader, VehicleModel } from '../assets/VehicleLoader';
import type { CarTuning } from '../gameplay/economy';
import type { PlayerCar } from './PlayerCar';

/** Damped spring for one body axis (roll or pitch). */
class BodySpring {
  angle = 0;
  vel = 0;

  step(target: number, hz: number, zeta: number, dt: number): void {
    const w = 2 * Math.PI * hz;
    // Substep: semi-implicit Euler goes unstable for w·dt ≳ 1 (e.g. a 100 ms hitch on a stiff car).
    const n = Math.ceil(dt / (1 / 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (w * w * (target - this.angle) - 2 * zeta * w * this.vel) * h;
      this.angle += this.vel * h;
    }
  }

  reset(): void {
    this.angle = 0;
    this.vel = 0;
  }
}

/**
 * Visual side of the player car: places the loaded model, swings the sprung
 * body on roll/pitch springs, spins and steers the wheels, drives the lights,
 * and applies the garage tuning (paint, rims, tint, ride height).
 */
export class CarView {
  private roll = new BodySpring();
  private pitch = new BodySpring();
  private beam: THREE.SpotLight;
  private time = 0;
  private readonly rollCentre: number;
  private readonly factory: { paint: THREE.Color; rim: THREE.Color; tint: number };
  /** Ride-height drop from tuning, m (negative = lower). */
  private drop = 0;

  private constructor(
    readonly model: VehicleModel,
    readonly spec: VehicleSpec,
  ) {
    // One shared beam for both headlamps keeps the forward light count low.
    this.beam = new THREE.SpotLight(0xfff1e0, 0, 95, 0.42, 0.55, 1.3);
    this.beam.position.copy(model.headlightPos);
    this.beam.target.position.set(0, -0.6, model.headlightPos.z - 40);
    model.root.add(this.beam, this.beam.target);
    this.rollCentre = model.body.position.y;
    const m = model.materials;
    this.factory = { paint: m.paint.color.clone(), rim: m.rim.color.clone(), tint: spec.tint };
    // Texture-painted liveries never use the paint material, so they can't be resprayed.
    model.root.traverse((o) => {
      const mat = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).material : null;
      if (mat && (Array.isArray(mat) ? mat.includes(m.paint) : mat === m.paint)) this.paintable = true;
    });
  }

  /** The body uses the paint material (tuning can respray it). */
  paintable = false;

  static async create(loader: VehicleLoader, spec: VehicleSpec): Promise<CarView> {
    const model = await loader.load(spec.sources, spec);
    return new CarView(model, spec);
  }

  setNight(on: boolean): void {
    this.model.materials.lights.setNight(on);
    this.beam.intensity = on ? 240 : 0;
  }

  applyTuning(t: CarTuning): void {
    const m = this.model.materials;
    m.setPaint(t.paint ?? this.factory.paint);
    m.rim.color.set(t.rim ?? this.factory.rim);
    m.setTint(t.tint ?? this.factory.tint);
    this.drop = t.drop ?? 0;
  }

  /** Parked pose for the showroom: level body, straight wheels, brakes off. */
  park(): void {
    const { root, body, wheels } = this.model;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    this.roll.reset();
    this.pitch.reset();
    body.rotation.set(0, 0, 0);
    body.position.y = this.rollCentre + this.drop;
    for (const w of wheels) if (w.front) w.steer.rotation.y = 0;
    this.model.materials.lights.setBrake(false);
  }

  update(dt: number, car: PlayerCar, origin: number): void {
    this.time += dt;
    const { root, body, wheels } = this.model;
    const h = car.handling;
    root.position.set(car.x, 0, -(car.s - origin));
    root.rotation.y = -car.psi;

    // Roll outward in a turn, squat on throttle, dive under braking.
    this.roll.step(car.latAccel * h.rollGain, h.suspensionHz, h.damping, dt);
    this.pitch.step(car.longAccel * h.pitchGain, h.suspensionHz * 1.1, h.damping, dt);
    const v01 = Math.min(1, car.speed / 70);
    const ripple = Math.sin(this.time * 37) * Math.sin(this.time * 13.1) * 0.0035 * v01;
    body.rotation.set(this.pitch.angle, 0, this.roll.angle);
    body.position.y = this.rollCentre + this.drop + ripple - Math.abs(this.roll.angle) * 0.15;

    const spin = (car.speed / this.model.wheelRadius) * dt;
    for (const w of wheels) {
      w.spin.rotation.x -= spin;
      if (w.front) w.steer.rotation.y = -car.steerAngle * 1.6;
    }
    this.model.materials.lights.setBrake(car.braking);
  }

  dispose(): void {
    this.beam.dispose();
    this.model.dispose();
  }
}
