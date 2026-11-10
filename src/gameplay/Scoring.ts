import { clamp } from '../core/math';
import { distance, overlap, type Obb } from '../core/obb';
import type { TrafficCar, TrafficSystem } from '../traffic/TrafficSystem';
import type { PlayerCar } from '../vehicle/PlayerCar';

const KMH = 1 / 3.6;

/**
 * Player ↔ traffic contacts: SAT on the real body boxes, mass-weighted
 * separation and an impulse with restitution and tyre-limited friction.
 * Returns the hardest closing speed (m/s) this step, 0 when nothing touched.
 */
export function resolveTrafficContacts(car: PlayerCar, traffic: TrafficSystem): number {
  let impact = 0;
  const a: Obb = { x: car.x, s: car.s, psi: car.psi, hw: car.width / 2, hl: car.length / 2 };
  for (const c of traffic.cars) {
    if (Math.abs(c.s - car.s) > 9) continue;
    a.x = car.x;
    a.s = car.s;
    a.psi = car.psi;
    const hit = overlap(a, { x: c.x, s: c.s, psi: c.psi, hw: c.type.width / 2, hl: c.type.length / 2 });
    if (!hit) continue;
    const mP = car.mass;
    const mT = c.mass;
    const share = mT / (mP + mT);
    car.x += hit.nx * hit.depth * share;
    car.s += hit.ns * hit.depth * share;
    c.bump -= hit.nx * hit.depth * (1 - share);
    c.s -= hit.ns * hit.depth * (1 - share);

    const { vxw, vsw } = car.worldVelocity();
    const tvx = c.bumpV + Math.sin(c.psi) * c.v;
    const tvs = c.v;
    const rx = vxw - tvx;
    const rs = vsw - tvs;
    const rel = rx * hit.nx + rs * hit.ns;
    if (rel >= 0) continue;
    const k = 1 / mP + 1 / mT;
    const j = (-(1 + 0.2) * rel) / k;
    // Tangential (scraping) impulse, capped by a friction cone.
    const tx = -hit.ns;
    const ts = hit.nx;
    const jt = clamp(-(rx * tx + rs * ts) / k, -0.35 * j, 0.35 * j);
    const jx = j * hit.nx + jt * tx;
    const js = j * hit.ns + jt * ts;
    car.applyImpulse(jx, js, hit.px - car.x, hit.ps - car.s);
    c.v = Math.max(0, c.v - js / mT);
    c.bumpV = clamp(c.bumpV - jx / mT, -4, 4);
    impact = Math.max(impact, -rel);
  }
  return impact;
}

export type ScoreEventKind = 'near' | 'crazy' | 'squeeze' | 'crash' | 'combo-lost';

export interface ScoreEvent {
  kind: ScoreEventKind;
  points: number;
  multiplier: number;
  /** Closest gap (m) for near misses. */
  gap: number;
}

interface Pass {
  minGap: number;
  side: number;
  touched: boolean;
  /** Player was above 90 km/h somewhere alongside. */
  fast: boolean;
}

const NEAR_MAX = 0.8;
const CRAZY_MAX = 0.2;
const SQUEEZE_MAX = 0.9;
const COMBO_TIME = 3.5;
const MIN_SPEED = 90 * KMH;

/**
 * Near Miss / Crazy Close / Double Squeeze detector and the combo meter.
 * Gaps are measured between the actual body boxes (OBB), not centres.
 */
export class Scoring {
  score = 0;
  multiplier = 1;
  /** Seconds left before the combo burns out. */
  comboTimer = 0;
  best = 0;
  nearMisses = 0;
  private passes = new Map<number, Pass>();
  private squeezed = new Set<string>();
  onEvent: (e: ScoreEvent) => void = () => {};

  reset(): void {
    this.score = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.nearMisses = 0;
    this.passes.clear();
    this.squeezed.clear();
  }

  /** Contact with traffic or a barrier: the combo is gone. */
  crash(): void {
    for (const p of this.passes.values()) p.touched = true;
    if (this.multiplier > 1) this.onEvent({ kind: 'crash', points: 0, multiplier: 1, gap: 0 });
    this.multiplier = 1;
    this.comboTimer = 0;
  }

  update(dt: number, car: PlayerCar, cars: readonly TrafficCar[]): void {
    const speed = car.speed;
    // Driving points: fast driving pays, multiplied by the combo.
    if (speed > 60 * KMH) this.score += speed * dt * 0.5 * this.multiplier;

    if (this.multiplier > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.multiplier = 1;
        this.onEvent({ kind: 'combo-lost', points: 0, multiplier: 1, gap: 0 });
      }
    }

    const a: Obb = { x: car.x, s: car.s, psi: car.psi, hw: car.width / 2, hl: car.length / 2 };
    const alongside: { c: TrafficCar; gap: number; side: number }[] = [];
    for (const c of cars) {
      const ds = c.s - car.s;
      const reach = (c.type.length + car.length) / 2 + 0.6;
      let pass = this.passes.get(c.id);
      if (Math.abs(ds) < reach && Math.abs(c.x - car.x) < 4.2) {
        const gap = distance(a, { x: c.x, s: c.s, psi: c.psi, hw: c.type.width / 2, hl: c.type.length / 2 });
        if (!pass) {
          pass = { minGap: Infinity, side: Math.sign(c.x - car.x), touched: false, fast: false };
          this.passes.set(c.id, pass);
        }
        if (gap <= 0.001) pass.touched = true;
        pass.minGap = Math.min(pass.minGap, gap);
        if (speed > MIN_SPEED && speed > c.v + 3) pass.fast = true;
        // Alongside = overlapping in s, so the gap is lateral.
        if (Math.abs(ds) < (c.type.length + car.length) / 2) alongside.push({ c, gap, side: Math.sign(c.x - car.x) });
      } else if (pass) {
        this.passes.delete(c.id);
        // Only count a completed overtake (car now behind us), not one that dropped back past us.
        if (ds < 0 && pass.fast && !pass.touched && pass.minGap < NEAR_MAX) this.nearMiss(pass.minGap);
      }
    }
    for (const id of this.passes.keys()) if (!cars.some((c) => c.id === id)) this.passes.delete(id);

    // Double Squeeze: threading the marking between two cars side by side.
    if (speed > MIN_SPEED) {
      const left = alongside.filter((o) => o.side < 0 && o.gap < SQUEEZE_MAX && o.gap > 0.001);
      const right = alongside.filter((o) => o.side > 0 && o.gap < SQUEEZE_MAX && o.gap > 0.001);
      for (const l of left) {
        for (const r of right) {
          const key = `${l.c.id}:${r.c.id}`;
          if (this.squeezed.has(key)) continue;
          this.squeezed.add(key);
          this.bump(1);
          const pts = Math.round(1500 * this.multiplier);
          this.score += pts;
          this.onEvent({ kind: 'squeeze', points: pts, multiplier: this.multiplier, gap: Math.min(l.gap, r.gap) });
        }
      }
      if (this.squeezed.size > 64) this.squeezed.clear();
    }
    this.best = Math.max(this.best, this.score);
  }

  private nearMiss(gap: number): void {
    const crazy = gap < CRAZY_MAX;
    this.nearMisses++;
    this.bump(crazy ? 0.5 : 0.25);
    // Crazy Close doubles the multiplier for this award.
    const mult = this.multiplier * (crazy ? 2 : 1);
    const pts = Math.round((crazy ? 600 : 250) * mult);
    this.score += pts;
    this.onEvent({ kind: crazy ? 'crazy' : 'near', points: pts, multiplier: mult, gap });
  }

  private bump(by: number): void {
    this.multiplier = Math.min(5, this.multiplier + by);
    this.comboTimer = COMBO_TIME;
  }
}
