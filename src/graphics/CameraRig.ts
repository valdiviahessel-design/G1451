import * as THREE from 'three';
import { damp } from '../core/math';

export interface CameraTarget {
  x: number;
  s: number;
  psi: number;
  speed: number;
  latAccel: number;
  longAccel: number;
  length: number;
  height: number;
}

export type CameraMode = 'chase' | 'far' | 'bumper';

/** Speed used to normalise speed-driven effects (FOV, shake). */
const REF_SPEED = 300 / 3.6;

/**
 * Chase camera with inertia: trails the car laterally and in heading, pulls
 * back under acceleration, leans with cornering load, widens FOV with speed,
 * and opens with a crane shot. `C` toggles a low bumper view.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private introT = 0;
  private readonly introDuration = 4.2;
  private fov = 58;
  private roll = 0;
  private lagX = 0;
  private lagPsi = 0;
  private pull = 0;
  private shake = 0;
  private time = 0;
  private primed = false;
  private readonly look = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly crane = new THREE.Vector3();

  constructor(aspect: number, skipIntro = false) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.3, 4000);
    if (skipIntro) this.introT = 1;
  }

  get introDone(): boolean {
    return this.introT >= 1;
  }

  toggleMode(): void {
    this.mode = this.mode === 'chase' ? 'far' : this.mode === 'far' ? 'bumper' : 'chase';
  }

  /** 0 = rigid follow, 1 = loose, cinematic lag. */
  inertia = 0.5;

  /** Slow orbit around the car behind the main menu. */
  showcase = false;

  /** Replays the crane shot into the chase position (run start). */
  restartIntro(): void {
    this.introT = 0;
  }

  /** Kick the camera, e.g. on a barrier hit (m/s of impact). */
  bump(strength: number): void {
    this.shake = Math.min(1, this.shake + strength * 0.08);
  }

  update(dt: number, t: CameraTarget, origin: number): void {
    this.time += dt;
    this.introT = Math.min(1, this.introT + dt / this.introDuration);
    const speed01 = Math.min(1, t.speed / REF_SPEED);
    if (!this.primed) {
      this.lagX = t.x;
      this.lagPsi = t.psi;
      this.primed = true;
    }

    // Lag behind lateral moves and heading changes: sells the weight of a switch-back.
    this.lagX += (t.x - this.lagX) * damp(THREE.MathUtils.lerp(13, 3.5, this.inertia), dt);
    this.lagPsi += (t.psi - this.lagPsi) * damp(THREE.MathUtils.lerp(9, 2.2, this.inertia), dt);
    this.pull += (THREE.MathUtils.clamp(t.longAccel, -10, 8) * 0.055 - this.pull) * damp(3, dt);
    this.shake *= Math.exp(-5 * dt);

    const z = -(t.s - origin);
    const sin = Math.sin(this.lagPsi);
    const cos = Math.cos(this.lagPsi);
    const jitter = speed01 * speed01 * 0.01 + this.shake * 0.12;
    const jx = Math.sin(this.time * 31) * jitter;
    const jy = Math.sin(this.time * 23.7) * jitter * 0.6;

    if (this.mode !== 'bumper') {
      const far = this.mode === 'far';
      const back = (far ? 8.4 : 5.6) + t.length * 0.25 + this.pull;
      const up = (far ? 2.35 : 1.45) + t.height * 0.32;
      this.pos.set(this.lagX - sin * back + jx, up + jy, z + cos * back);
      this.look.set(t.x + sin * 7, far ? 1.1 : 0.95, z - cos * 7);
    } else {
      const nose = t.length / 2 + 0.1;
      this.pos.set(t.x + Math.sin(t.psi) * nose + jx * 0.5, 0.62 + jy * 0.5, z - Math.cos(t.psi) * nose);
      this.look.set(t.x + Math.sin(t.psi) * 40, 0.55, z - Math.cos(t.psi) * 40);
    }

    // Intro: crane from high off the front quarter down into the chase position.
    const e = 1 - Math.pow(1 - this.introT, 3);
    if (this.showcase) {
      // Sweeps rear ↔ side three-quarters, always looking down the road: the HDRIs are
      // framed for that direction (the night one has a lit promenade behind the camera).
      const a = Math.PI + Math.sin(this.time * 0.09) * 1.75;
      const r = 6.2 + t.length * 0.35;
      this.pos.set(t.x + Math.sin(a) * r, 1.25 + Math.sin(this.time * 0.21) * 0.35, z - Math.cos(a) * r * 0.9 - 1.0);
      this.look.set(t.x, 0.75, z - 0.6);
      this.introT = 0;
    } else if (e < 1) {
      this.crane.set(t.x + 9, 7.5, z - 16);
      this.pos.lerpVectors(this.crane, this.pos, e);
      this.look.lerpVectors(new THREE.Vector3(t.x, 0.7, z), this.look, e);
    }
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);

    this.roll += (-t.latAccel * 0.0035 - this.roll) * damp(5, dt);
    this.camera.rotateZ(this.roll * e);

    const base = this.mode === 'bumper' ? 66 : 58;
    const targetFov = THREE.MathUtils.lerp(48, base + 22 * Math.pow(speed01, 1.6), e);
    this.fov += (targetFov - this.fov) * damp(3, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
