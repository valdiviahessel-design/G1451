import { BASE_HALF_WIDTH, LANE_WIDTH, MEDIAN_SHOULDER_WIDTH, SHOULDER_WIDTH } from '../config';
import { clamp, damp, smootherstep } from '../core/math';
import type { Drivetrain, Handling } from '../assets/vehicles';
import type { DriveOverride, DrivingStyle, Gearbox } from '../core/Settings';
import type { RoadLayout } from '../road/RoadLayout';

const G = 9.81;

export interface Controls {
  throttle: number;
  brake: number;
  /** -1 full left .. +1 full right. */
  steer: number;
}

/** Player-selectable driving aids and layout (settings → car). */
export interface DriveSetup {
  gearbox: Gearbox;
  style: DrivingStyle;
  drive: DriveOverride;
  abs: boolean;
  esp: boolean;
  tcs: boolean;
}

export const DEFAULT_SETUP: DriveSetup = { gearbox: 'auto', style: 'standard', drive: 'stock', abs: true, esp: true, tcs: true };

/** Inner faces of the median barrier and the guardrail relative to the road edges. */
const MEDIAN_FACE = MEDIAN_SHOULDER_WIDTH + 0.05;
const RAIL_FACE = SHOULDER_WIDTH + 0.37;

/** Centre-of-gravity height, m. */
const CG_HEIGHT = 0.52;
/** Static front axle load share per layout. */
const FRONT_SHARE = { RWD: 0.52, FWD: 0.61, AWD: 0.56 } as const;
/** Drive torque split to the front axle. */
const DRIVE_FRONT = { RWD: 0, FWD: 1, AWD: 0.4 } as const;
const BRAKE_FRONT = 0.66;
/**
 * Tyres: Pacejka shape factor, and a rear axle that is stiffer and grippier
 * than the front. That gives the mild understeer of a road car, which is what
 * keeps the yaw motion damped at speed instead of snapping into a spin.
 */
const TYRE_C = 1.45;
const REAR_STIFF = 1.25;
const REAR_GRIP = 1.04;
/** Friction of a locked (sliding) wheel relative to the peak. */
const SLIDE_MU = 0.8;
/** Share of the engine power that reaches the road. */
const WHEEL_POWER = 0.78;
const SHIFT_TIME = 0.22;
/** Ratio of the top gear's redline speed to the top speed: v-max sits just past peak power. */
const TOP_GEAR_OVERRUN = 1 / 0.9;

interface StyleTuning {
  grip: number;
  /** Heading return with the wheel released, 1/s (0 = none). */
  returnGain: number;
  /** Largest sideways travel speed a held key builds up, m/s. */
  latSpeed: number;
  rack: number;
  /** Stability control can't be switched off. */
  forceEsp: boolean;
}

const STYLES: Record<DrivingStyle, StyleTuning> = {
  arcade: { grip: 1.12, returnGain: 3, latSpeed: 6.5, rack: 1.15, forceEsp: true },
  standard: { grip: 1, returnGain: 2.2, latSpeed: 8, rack: 1, forceEsp: false },
  sim: { grip: 1, returnGain: 0, latSpeed: Infinity, rack: 0.9, forceEsp: false },
};

/** Relative engine power at a fraction of the redline (peak near 85 %). */
const powerCurve = (x: number) => clamp(1 - ((x - 0.85) / 0.85) ** 2, 0.1, 1);

/**
 * Player chassis in road space (s along the road, x lateral, heading psi > 0 =
 * pointing right). Dynamic bicycle model:
 *  - axle loads move with longitudinal acceleration (dive under braking, squat
 *    under power) and lateral load transfer costs grip;
 *  - each axle has a friction circle: drive or brake force eats into
 *    cornering grip;
 *  - Pacejka-style tyre curve with an understeering front/rear balance;
 *  - steering lock shrinks with speed so full lock asks for about the grip
 *    limit and never more (a tap at 200 km/h is a lane change, not a spin);
 *  - gearbox with a power curve, auto or manual;
 *  - driver aids: ABS (no locked wheels), TCS (no wheelspin), ESP (yaw-rate
 *    and slip-angle control through a corrective yaw moment).
 * The driving style adds a "virtual driver" on top (arcade/standard): it
 * caps the lane-change angle and, with the wheel released, steers the
 * direction of travel back along the road — through the tyres, so the body
 * motion stays physical.
 */
export class PlayerCar {
  s = 0;
  x = 0;
  psi = 0;
  /** Body-frame velocity: forward and to the right, m/s. */
  vx = 0;
  vy = 0;
  /** Yaw rate, rad/s (+ turning right). */
  yawRate = 0;
  /** Road-wheel angle, rad (+ right). */
  steerAngle = 0;
  latAccel = 0;
  longAccel = 0;
  /** Front axle share of the total load, 0..1 (≈0.55 static). */
  frontLoad = 0.55;
  /** 0..1: how hard the tyres are working past their peak (screech, smoke). */
  tireSlip = 0;
  /** 0..1: driven wheels spinning. */
  wheelspin = 0;
  braking = false;
  /** Lateral impact speed of the last barrier hit (m/s), cleared by the consumer. */
  impact = 0;
  gear = 1;
  rpm = 800;
  /** Aids that intervened during the last step (HUD lamps). */
  espActive = false;
  absActive = false;
  tcsActive = false;
  setup: DriveSetup = { ...DEFAULT_SETUP };
  private steerFrac = 0;
  /** Low-passed longitudinal acceleration: load transfer follows the suspension, not instantly. */
  private axLoad = 0;
  private shiftT = 0;
  private limiterT = 0;
  /** Throttle cut requested by ESP, 0..1. */
  private espCut = 0;

  constructor(
    private readonly layout: RoadLayout,
    public handling: Handling,
    public wheelbase: number,
    public width: number,
    public length: number,
  ) {
    this.setVehicle(handling, wheelbase, width, length);
  }

  setVehicle(handling: Handling, wheelbase: number, width: number, length: number): void {
    this.handling = handling;
    // Guard against bad rigs: physics divides by the wheelbase.
    this.wheelbase = Number.isFinite(wheelbase) && wheelbase > length * 0.4 ? wheelbase : length * 0.58;
    this.width = width;
    this.length = length;
    this.gear = this.gearFor(this.vx);
    this.rpm = this.handling.idleRpm;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Sets a straight-line speed (used at spawn and in tests). */
  set speed(v: number) {
    this.vx = v;
    this.vy = 0;
    this.yawRate = 0;
    this.steerFrac = 0;
    this.gear = this.gearFor(v);
    this.rpm = Math.max(this.handling.idleRpm, this.wheelRpm(v, this.gear));
  }

  get mass(): number {
    return this.handling.massKg;
  }

  get drivetrain(): Drivetrain {
    return this.setup.drive === 'stock' ? this.handling.drivetrain : this.setup.drive;
  }

  get shifting(): boolean {
    return this.shiftT > 0;
  }

  /** Body slip angle: between where the car points and where it goes. */
  get beta(): number {
    return this.vx > 0.5 ? Math.atan2(this.vy, this.vx) : 0;
  }

  /** Yaw inertia: sharper cars (low yawLag) carry their mass closer to the centre. */
  get inertia(): number {
    const h = this.handling;
    const f0 = FRONT_SHARE[h.drivetrain];
    const a = this.wheelbase * (1 - f0);
    const b = this.wheelbase * f0;
    return h.massKg * a * b * (0.85 + 2 * h.yawLag);
  }

  // ------------------------------------------------------------------ gearbox

  /** Road speed at the redline in gear g; gears spread geometrically. */
  private gearTop(g: number): number {
    const h = this.handling;
    return h.topSpeed * TOP_GEAR_OVERRUN * Math.pow(g / h.gears, 0.8);
  }

  private wheelRpm(v: number, g: number): number {
    return (v / this.gearTop(g)) * this.handling.redline;
  }

  /** The gear an automatic would pick for cruising at speed v. */
  private gearFor(v: number): number {
    const h = this.handling;
    if (h.cvt) return 1;
    let g = 1;
    while (g < h.gears && this.wheelRpm(v, g) > h.redline * 0.7) g++;
    return g;
  }

  shiftUp(): void {
    const h = this.handling;
    if (h.cvt || this.shiftT > 0 || this.gear >= h.gears) return;
    this.gear++;
    this.shiftT = SHIFT_TIME;
  }

  shiftDown(): void {
    const h = this.handling;
    if (h.cvt || this.shiftT > 0 || this.gear <= 1) return;
    // Refuse a money shift.
    if (this.wheelRpm(this.vx, this.gear - 1) > h.redline * 1.04) return;
    this.gear--;
    this.shiftT = SHIFT_TIME * 0.7;
  }

  private updateGearbox(dt: number, throttle: number, v: number): void {
    const h = this.handling;
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.limiterT = Math.max(0, this.limiterT - dt);
    if (h.cvt) {
      this.gear = 1;
      // A CVT holds the revs by load, near peak power when floored.
      const target = h.idleRpm + (h.redline * 0.85 - h.idleRpm) * clamp(0.2 + 0.8 * throttle, 0, 1) * clamp(v / 12 + 0.3, 0, 1);
      this.rpm += (target - this.rpm) * damp(5, dt);
      return;
    }
    if (this.setup.gearbox === 'auto' && this.shiftT <= 0) {
      const up = throttle > 0.5 ? 0.93 : 0.62;
      const down = throttle > 0.5 ? 0.78 : 0.42;
      if (this.gear < h.gears && this.wheelRpm(v, this.gear) > h.redline * up) {
        this.gear++;
        this.shiftT = SHIFT_TIME;
      } else if (this.gear > 1 && this.wheelRpm(v, this.gear - 1) < h.redline * down) {
        this.gear--;
        this.shiftT = SHIFT_TIME * 0.7;
      }
    }
    let target = Math.max(this.wheelRpm(v, this.gear), h.idleRpm);
    // Clutch slip lets the revs rise for a launch in first.
    if (this.gear === 1) target = Math.max(target, h.idleRpm + (h.redline * 0.55 - h.idleRpm) * throttle);
    if (target >= h.redline) {
      this.limiterT = 0.06;
      target = h.redline;
    }
    this.rpm += (target - this.rpm) * damp(this.shiftT > 0 ? 14 : 22, dt);
  }

  // ------------------------------------------------------------------ physics

  update(dt: number, c: Controls): void {
    // Two substeps keep the stiff tyre forces far inside explicit-Euler stability.
    const h = dt / 2;
    this.step(h, c);
    this.step(h, c);
    this.collideBarriers();
  }

  private step(dt: number, c: Controls): void {
    const h = this.handling;
    const style = STYLES[this.setup.style];
    const m = h.massKg;
    const L = this.wheelbase;
    const f0 = FRONT_SHARE[h.drivetrain];
    const a = L * (1 - f0);
    const b = L * f0;
    const Iz = this.inertia;
    const v = Math.max(this.vx, 0);
    const vxs = Math.max(v, 1);
    const mu = (h.grip * style.grip) / G;
    const f = clamp(v / h.topSpeed, 0, 1);

    this.updateGearbox(dt, c.throttle, v);

    // --- Tyres: sharper cars (low yawLag) have stiffer carcasses.
    const Bf = 13 + 20 * clamp(0.2 - h.yawLag, 0, 0.15);
    const Br = Bf * REAR_STIFF;
    // Linear understeer gradient of this tyre set, rad per m/s².
    const Ku = (1 / (G * TYRE_C)) * (1 / (mu * Bf) - 1 / (mu * REAR_GRIP * Br));
    const aLim = mu * G;
    // Full lock asks for just past the grip limit at any speed.
    const lock = clamp(((L * aLim) / Math.max(v * v, 1) + Ku * aLim + 0.01) * 1.1, 0.025, 0.6);

    // --- Steering: player input, shaped by the virtual driver of the style.
    let input = c.steer;
    const theta = this.psi + Math.atan2(this.vy, Math.max(this.vx, 0.5));
    if (style.returnGain > 0 && v > 3) {
      if (Math.abs(input) < 0.05) {
        // Released: steer the direction of travel back along the road.
        const rDes = -style.returnGain * theta;
        const k = L / vxs + Ku * vxs;
        input = clamp((rDes * k + (rDes - this.yawRate) * k * 0.6) / lock, -0.55, 0.55);
      } else if (Math.sign(input) === Math.sign(theta)) {
        // Held: ease off as the sideways speed nears the lane-change limit.
        const thetaMax = Math.asin(Math.min(1, style.latSpeed / Math.max(this.speed, 1)));
        input *= clamp((thetaMax - Math.abs(theta)) / (0.35 * thetaMax), -0.4, 1);
      }
    }
    const windOn = Math.abs(input) > Math.abs(this.steerFrac) && Math.sign(input) === Math.sign(this.steerFrac || input);
    const rate = (windOn ? h.rackSpeed[0] + (h.rackSpeed[1] - h.rackSpeed[0]) * f : h.rackSpeed[0] * 1.5) * style.rack;
    this.steerFrac += clamp(input - this.steerFrac, -rate * dt, rate * dt);
    const delta = this.steerFrac * lock;
    this.steerAngle = delta;

    // --- Axle loads with longitudinal and lateral transfer.
    const W = m * G;
    const transfer = (m * this.axLoad * CG_HEIGHT) / L;
    const Fzf = Math.max(W * f0 - transfer, 0.15 * W);
    const Fzr = Math.max(W * (1 - f0) + transfer, 0.15 * W);
    this.frontLoad = Fzf / (Fzf + Fzr);
    const track = Math.max(this.width - 0.25, 1.2);
    const latShift = (m * Math.abs(this.latAccel) * CG_HEIGHT) / track;
    // Tyre load sensitivity: unequal left/right loads give less total grip.
    const sens = (Fz: number, share: number) => {
      const q = clamp((latShift * share) / (Fz / 2), 0, 1);
      return 1 - 0.15 * q * q;
    };
    const capF = mu * Fzf * sens(Fzf, 0.55);
    const capR = mu * REAR_GRIP * Fzr * sens(Fzr, 0.45);

    // --- Longitudinal forces per axle.
    const cut = this.shiftT > 0 && !h.cvt ? 0 : this.limiterT > 0 ? 0 : 1 - this.espCut;
    const pw = powerCurve(this.rpm / h.redline);
    const drive = c.throttle * cut * ((h.powerW * WHEEL_POWER * pw) / Math.max(v, 4));
    const brake = c.brake * m * 11 * (v > 0.3 ? 1 : 0);
    const engineBrake = c.throttle < 0.05 && v > 1 ? m * (0.5 + 0.7 * (this.rpm / h.redline)) : 0;
    const df = DRIVE_FRONT[this.drivetrain];
    let FxF = drive * df - brake * BRAKE_FRONT - engineBrake * df;
    let FxR = drive * (1 - df) - brake * (1 - BRAKE_FRONT) - engineBrake * (1 - df);

    // Friction circle with the aids: TCS trims drive, ABS trims brake force;
    // without them the wheel spins or locks and lateral grip collapses.
    let spin = 0;
    this.tcsActive = false;
    this.absActive = false;
    const locked = [false, false];
    const capLong = (Fx: number, cap: number, axle: 0 | 1): number => {
      if (Fx > 0) {
        if (this.setup.tcs && Fx > 0.75 * cap) {
          this.tcsActive = true;
          return 0.75 * cap;
        }
        if (Fx > 0.98 * cap) spin = Math.max(spin, Math.min(1, Fx / cap - 0.9));
        return Math.min(Fx, 0.98 * cap);
      }
      if (-Fx > 0.9 * cap) {
        if (this.setup.abs) {
          this.absActive = this.absActive || c.brake > 0.05;
          return -0.9 * cap;
        }
        if (-Fx > cap && c.brake > 0.05) {
          locked[axle] = true;
          return -SLIDE_MU * cap;
        }
      }
      return Math.max(Fx, -cap);
    };
    FxF = capLong(FxF, capF, 0);
    FxR = capLong(FxR, capR, 1);
    const lateralCap = (Fx: number, cap: number, isLocked: boolean, spinning: boolean) =>
      isLocked ? 0.12 * cap : spinning ? 0.3 * cap : Math.max(Math.sqrt(Math.max(cap * cap - Fx * Fx, 0)), 0.2 * cap);
    const capYF = lateralCap(FxF, capF, locked[0], spin > 0 && df > 0);
    const capYR = lateralCap(FxR, capR, locked[1], spin > 0 && df < 1);

    // --- Lateral tyre forces (simplified Pacejka: sin(C·atan(B·α))).
    const tyre = (alpha: number, B: number) => Math.sin(TYRE_C * Math.atan(B * alpha));
    const alphaF = Math.atan2(this.vy + a * this.yawRate, vxs) - delta;
    const alphaR = Math.atan2(this.vy - b * this.yawRate, vxs);
    const FyF = -capYF * tyre(alphaF, Bf);
    const FyR = -capYR * tyre(alphaR, Br);
    const peak = Math.tan(Math.PI / 2 / TYRE_C);
    this.tireSlip = Math.max(
      clamp(Math.max((Math.abs(alphaF) * Bf) / peak, (Math.abs(alphaR) * Br) / peak) - 0.85, 0, 1),
      locked[0] || locked[1] ? Math.min(1, v / 15) : 0,
    );
    this.wheelspin = spin;

    // --- Body equations.
    const pTop = h.powerW * WHEEL_POWER * powerCurve(1 / TOP_GEAR_OVERRUN);
    const roll = 0.012 * W;
    const dragK = Math.max(pTop / h.topSpeed - roll, 0) / h.topSpeed ** 2;
    const resist = v > 0.1 ? dragK * v * v + roll : 0;
    const cosD = Math.cos(delta);
    const sinD = Math.sin(delta);
    let ax = (FxF * cosD - FyF * sinD + FxR - resist) / m;
    const ay = (FxF * sinD + FyF * cosD + FyR) / m;
    let yawM = a * (FxF * sinD + FyF * cosD) - b * FyR;

    // --- ESP: track the yaw rate the steering asks for and keep the slip angle small.
    this.espActive = false;
    this.espCut = Math.max(0, this.espCut - dt * 3);
    if ((this.setup.esp || style.forceEsp) && v > 4) {
      const rLim = (0.95 * aLim) / vxs;
      const rRef = clamp((v * delta) / (L + Ku * v * v), -rLim, rLim);
      const err = this.yawRate - rRef;
      const band = 0.03 + 0.12 * Math.abs(rRef);
      const beta = Math.atan2(this.vy, vxs);
      const betaLim = 0.05 + 0.12 * clamp(1 - v / 30, 0, 1);
      let corr = 0;
      if (Math.abs(err) > band) corr -= (err - Math.sign(err) * band) * 8 * Iz;
      if (Math.abs(beta) > betaLim) corr += (beta - Math.sign(beta) * betaLim) * 30 * Iz;
      if (corr !== 0) {
        // Braking single wheels costs a little speed and cuts the throttle.
        const maxM = 0.5 * track * (capF + capR);
        corr = clamp(corr, -maxM, maxM);
        yawM += corr;
        ax -= (Math.abs(corr) / (0.5 * track) / m) * 0.25;
        this.espCut = Math.min(0.7, Math.max(this.espCut, Math.abs(corr) / maxM));
        this.espActive = true;
      }
    }

    const vx0 = this.vx;
    this.vx = Math.max(0, this.vx + (ax + this.vy * this.yawRate) * dt);
    this.vy += (ay - vx0 * this.yawRate) * dt;
    this.yawRate += (yawM / Iz) * dt;

    // Slip angles are meaningless near standstill: blend to rolling without sliding.
    const w = smootherstep(1.5, 5, this.vx);
    if (w < 1) {
      this.yawRate = this.yawRate * w + ((this.vx * Math.tan(delta)) / L) * (1 - w);
      this.vy *= w;
    }

    // --- Integrate pose in road space (heading is relative to the road; no U-turns).
    this.psi += this.yawRate * dt;
    if (Math.abs(this.psi) > 1.1) {
      this.psi = Math.sign(this.psi) * 1.1;
      this.yawRate = 0;
    }
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    this.x += (this.vx * sinP + this.vy * cosP) * dt;
    this.s += (this.vx * cosP - this.vy * sinP) * dt;

    this.longAccel = ax;
    this.latAccel = ay;
    this.axLoad += (ax - this.axLoad) * damp(7, dt);
    this.braking = c.brake > 0.05;
  }

  /** World-frame (x, s) velocity. */
  worldVelocity(): { vxw: number; vsw: number } {
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    return { vxw: this.vx * sinP + this.vy * cosP, vsw: this.vx * cosP - this.vy * sinP };
  }

  /** Sets the world-frame velocity, converting back to the body frame (the rotation is its own inverse). */
  setWorldVelocity(vxw: number, vsw: number): void {
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    this.vx = Math.max(0, vxw * sinP + vsw * cosP);
    this.vy = vxw * cosP - vsw * sinP;
  }

  /**
   * Impulse (N·s) in world (x, s) axes applied at an offset (px, ps) from the
   * centre of mass — used for traffic contacts.
   */
  applyImpulse(jx: number, js: number, px: number, ps: number): void {
    const { vxw, vsw } = this.worldVelocity();
    const m = this.mass;
    this.setWorldVelocity(vxw + jx / m, vsw + js / m);
    this.yawRate = clamp(this.yawRate + (ps * jx - px * js) / this.inertia, -2.5, 2.5);
  }

  private collideBarriers(): void {
    // Footprint half-width grows when the car is yawed.
    const half = (this.width / 2) * Math.cos(this.psi) + (this.length / 2) * Math.abs(Math.sin(this.psi)) * 0.9;
    const min = this.layout.leftEdge(this.s) - MEDIAN_FACE + half;
    const max = this.layout.rightEdge(this.s) + RAIL_FACE - half;
    const hit = this.x < min ? -1 : this.x > max ? 1 : 0;
    if (!hit) return;
    this.x = hit < 0 ? min : max;
    const { vxw, vsw } = this.worldVelocity();
    // Only a hit if moving into the wall; a closing taper just pushes us along.
    if (Math.sign(vxw) === hit) {
      const impact = Math.abs(vxw);
      this.impact = Math.max(this.impact, impact);
      const keep = 1 - Math.min(0.45, 0.03 + impact * 0.035);
      this.psi = -this.psi * 0.3;
      this.yawRate = 0;
      this.steerFrac *= 0.3;
      this.setWorldVelocity(-vxw * 0.25, vsw * keep);
    } else {
      this.setWorldVelocity(0, vsw * 0.999);
    }
  }

  /** 0..2 main lanes, -1/3 pockets, NaN on the shoulders. */
  get laneIndex(): number {
    const i = Math.floor((this.x + BASE_HALF_WIDTH) / LANE_WIDTH);
    const pocketRight = this.x > BASE_HALF_WIDTH && this.x <= this.layout.rightEdge(this.s);
    const pocketLeft = this.x < -BASE_HALF_WIDTH && this.x >= this.layout.leftEdge(this.s);
    if (i >= 0 && i <= 2) return i;
    if (i === 3 && pocketRight) return 3;
    if (i === -1 && pocketLeft) return -1;
    return NaN;
  }
}
