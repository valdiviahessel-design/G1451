import * as THREE from 'three';
import type { VehicleSpec } from '../assets/vehicles';
import type { VehicleLoader, VehicleModel } from '../assets/VehicleLoader';
import type { CarTuning } from '../gameplay/economy';
import { createGlow } from '../graphics/WorldTextures';

let glowTex: THREE.Texture | null = null;

interface Respray {
  uPaint: { value: THREE.Color };
  uRepaint: { value: number };
}

/**
 * Single-texture liveries have no paint material to recolour, so the respray
 * happens in the shader: strongly coloured texels take the new hue and keep
 * their own brightness (shading, dirt and panel lines survive), while neutral
 * ones (chrome, cream, rubber) are left alone.
 */
function resprayable(mat: THREE.MeshStandardMaterial): Respray {
  const existing = mat.userData.respray as Respray | undefined;
  if (existing) return existing;
  const uniforms: Respray = { uPaint: { value: new THREE.Color(1, 1, 1) }, uRepaint: { value: 0 } };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaint;\nuniform float uRepaint;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
    float lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    float sat = hi > 0.0 ? (hi - lo) / hi : 0.0;
    // Linear-space thresholds: vivid paint only, and nothing as dark as glass or rubber.
    float mask = smoothstep(0.62, 0.8, sat) * smoothstep(0.05, 0.12, hi) * uRepaint;
    diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (hi * 1.6 + 0.04), mask);
  }`,
      );
  };
  mat.customProgramCacheKey = () => prevKey + '|respray';
  mat.needsUpdate = true;
  mat.userData.respray = uniforms;
  return uniforms;
}
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
  /** Neon underglow: an additive pool of light on the road beneath the car. */
  private readonly underglow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private night = false;
  private glowColor = 0;

  private constructor(
    readonly model: VehicleModel,
    readonly spec: VehicleSpec,
  ) {
    // One shared beam for both headlamps keeps the forward light count low.
    this.beam = new THREE.SpotLight(0xfff1e0, 0, 95, 0.42, 0.55, 1.3);
    this.beam.position.copy(model.headlightPos);
    this.beam.target.position.set(0, -0.6, model.headlightPos.z - 40);
    model.root.add(this.beam, this.beam.target);
    glowTex ??= createGlow();
    const pool = new THREE.PlaneGeometry(model.width * 2.6, model.length * 1.7);
    pool.rotateX(-Math.PI / 2);
    this.underglow = new THREE.Mesh(
      pool,
      new THREE.MeshBasicMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
    );
    this.underglow.position.y = 0.02;
    this.underglow.renderOrder = 2;
    this.underglow.visible = false;
    model.root.add(this.underglow);
    this.rollCentre = model.body.position.y;
    const m = model.materials;
    this.factory = { paint: m.paint.color.clone(), rim: m.rim.color.clone(), tint: spec.tint };
    // Texture-painted liveries never use the paint material, so they can't be resprayed.
    let usesPaint = false;
    const textured = new Set<THREE.MeshStandardMaterial>();
    model.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (list.includes(m.paint)) usesPaint = true;
      const classes = (mesh.userData.classes ?? []) as string[];
      classes.forEach((cls, i) => {
        const mat = list[Math.min(i, list.length - 1)] as THREE.MeshStandardMaterial;
        if (cls === 'keep' && mat.isMeshStandardMaterial && mat.map) textured.add(mat);
      });
    });
    // No paint panels at all: the whole body is one painted texture, resprayed in its shader instead.
    if (!usesPaint) this.livery = [...textured].map(resprayable);
    this.paintable = usesPaint || this.livery.length > 0;
  }

  private livery: Respray[] = [];

  /** Tuning can respray the body (paint panels, or a textured livery recoloured in its shader). */
  paintable = false;

  static async create(loader: VehicleLoader, spec: VehicleSpec): Promise<CarView> {
    const model = await loader.load(spec.sources, spec);
    return new CarView(model, spec);
  }

  setNight(on: boolean): void {
    this.night = on;
    this.model.materials.lights.setNight(on);
    this.beam.intensity = on ? 240 : 0;
    this.applyGlow();
  }

  private applyGlow(): void {
    this.underglow.visible = this.glowColor > 0;
    // Daylight washes neon out; after dark it floods the tarmac.
    this.underglow.material.color.setHex(this.glowColor).multiplyScalar(this.night ? 3.2 : 0.9);
  }

  applyTuning(t: CarTuning): void {
    const m = this.model.materials;
    m.setPaint(t.paint ?? this.factory.paint);
    for (const l of this.livery) {
      l.uRepaint.value = t.paint === undefined ? 0 : 1;
      if (t.paint !== undefined) l.uPaint.value.setHex(t.paint);
    }
    m.rim.color.set(t.rim ?? this.factory.rim);
    m.setFinish(t.finish);
    m.setTint(t.tint ?? this.factory.tint);
    this.drop = t.drop ?? 0;
    this.glowColor = t.glow ?? 0;
    this.applyGlow();
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
    this.underglow.geometry.dispose();
    this.underglow.material.dispose();
    this.beam.dispose();
    this.model.dispose();
  }
}
