import { LANE_WIDTH } from '../config';
import { Rng, clamp, smootherstep } from '../core/math';
import type { LaneId, RoadLayout } from '../road/RoadLayout';

const KMH = 1 / 3.6;

export interface TrafficType {
  id: string;
  length: number;
  width: number;
  height: number;
  /** Spawn weight. */
  weight: number;
  /** Heavy vehicles: slow, keep right. */
  heavy: boolean;
}

export type LaneChangePhase = 'none' | 'signal' | 'move';

export interface TrafficCar {
  id: number;
  type: TrafficType;
  s: number;
  x: number;
  v: number;
  /** Personal cruising speed, m/s. */
  v0: number;
  accel: number;
  lane: LaneId;
  /** During a change: the lane being entered. */
  toLane: LaneId;
  phase: LaneChangePhase;
  phaseT: number;
  phaseDur: number;
  /** -1 left, +1 right, 0 off. */
  signal: -1 | 0 | 1;
  braking: boolean;
  /** Visual heading. */
  psi: number;
  /** Lateral knock from contacts, decays back to the lane. */
  bump: number;
  bumpV: number;
  /** Temporary speed offset used to break up rolling roadblocks. */
  wallAdj: number;
  wallT: number;
  nextDecision: number;
  /** A pocket car waiting to zipper into this lane; the car behind yields. */
  mergeInto: LaneId | null;
  mass: number;
  /** Paint index chosen at spawn (the view maps it to a colour). */
  paint: number;
}

export interface PlayerState {
  s: number;
  x: number;
  speed: number;
  psi: number;
  length: number;
  width: number;
}

export interface TrafficOptions {
  maxCars: number;
  /** Cars per km per main lane at the densest. */
  density: number;
  seed?: number;
  /** Cruise-speed multiplier for the whole flow. */
  pace?: number;
  /** Voluntary lane changes (pocket merges always happen). */
  laneChanges?: boolean;
}

/** Any window this long (m) must leave at least one lane open. */
export const WALL_WINDOW = 30;
const SPAWN_AHEAD_MIN = 560;
const SPAWN_AHEAD_MAX = 760;
const DESPAWN_BEHIND = 240;
const DESPAWN_AHEAD = 900;
/** IDM parameters. */
const IDM_A = 1.8;
const IDM_B = 3.2;
const IDM_S0 = 3;
const IDM_T = 1.0;

/** Typical flow per main lane (left fastest), km/h. */
const LANE_FLOW: Record<number, [number, number]> = {
  [-1]: [95, 110],
  0: [96, 118],
  1: [80, 100],
  2: [66, 86],
  3: [85, 100],
};

/**
 * Highway traffic: IDM car-following, signalled lane changes, pocket merges,
 * and a rule that no window of WALL_WINDOW metres ever blocks every lane, so
 * there is always a way through.
 */
export class TrafficSystem {
  readonly cars: TrafficCar[] = [];
  onSpawn: (car: TrafficCar) => void = () => {};
  onDespawn: (car: TrafficCar) => void = () => {};
  private rng: Rng;
  private nextId = 1;
  private time = 0;
  private wallTimer = 0;
  private totalWeight: number;
  /** Lane-change counters for tests/debug. */
  stats = { spawned: 0, laneChanges: 0, pocketMerges: 0, wallsBroken: 0 };

  constructor(
    private readonly layout: RoadLayout,
    private readonly types: TrafficType[],
    private readonly opts: TrafficOptions,
  ) {
    this.rng = new Rng(opts.seed ?? 91);
    this.totalWeight = types.reduce((s, t) => s + t.weight, 0);
  }

  /** Fill the road around the player at the start of a run. */
  populate(p: PlayerState): void {
    for (let i = 0; i < 400 && this.cars.length < this.opts.maxCars; i++) {
      const s = p.s + this.rng.range(60, SPAWN_AHEAD_MAX);
      this.trySpawn(s, p, this.pickLane(s));
    }
  }

  update(dt: number, p: PlayerState): void {
    this.time += dt;
    this.despawn(p);
    this.spawn(p);
    this.sortBySpace();
    for (const car of this.cars) this.think(car, p);
    for (const car of this.cars) this.drive(car, dt, p);
    this.wallTimer -= dt;
    if (this.wallTimer <= 0) {
      this.wallTimer = 0.2;
      this.breakWalls(p);
    }
  }

  // ---------------------------------------------------------------- spawning

  private densityAt(s: number): number {
    // Slow waves of heavy and light traffic.
    const w = 0.5 + 0.5 * Math.sin(s / 900) * Math.sin(s / 2300 + 1.3);
    return this.opts.density * (0.55 + 0.75 * w);
  }

  private pickLane(s: number): LaneId {
    const lanes = this.layout.availableLanes(s, 0.95);
    const weights = lanes.map((l) => (l === -1 || l === 3 ? 0.35 : 1));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lanes.length; i++) {
      r -= weights[i];
      if (r <= 0) return lanes[i];
    }
    return 1;
  }

  private pickType(lane: LaneId): TrafficType {
    for (let tries = 0; tries < 6; tries++) {
      let r = this.rng.next() * this.totalWeight;
      for (const t of this.types) {
        r -= t.weight;
        if (r <= 0) {
          // Heavy vehicles keep to the right-hand lane (and a right pocket).
          if (t.heavy && lane !== 2 && lane !== 3) break;
          return t;
        }
      }
    }
    return this.types.find((t) => !t.heavy) ?? this.types[0];
  }

  private spawn(p: PlayerState): void {
    if (this.cars.length >= this.opts.maxCars) return;
    const span = (SPAWN_AHEAD_MAX + DESPAWN_BEHIND) / 1000;
    for (const lane of [0, 1, 2, -1, 3] as LaneId[]) {
      if (this.cars.length >= this.opts.maxCars) return;
      const sAhead = p.s + this.rng.range(SPAWN_AHEAD_MIN, SPAWN_AHEAD_MAX);
      if (!this.layout.availableLanes(sAhead, 0.95).includes(lane)) continue;
      const pocket = lane === -1 || lane === 3;
      // Pockets are deliberately sparse: they are the player's escape route.
      const target = this.densityAt(sAhead) * span * (pocket ? 0.25 : 1);
      const count = this.cars.filter((c) => c.lane === lane && c.s > p.s - DESPAWN_BEHIND).length;
      if (count < target) this.trySpawn(sAhead, p, lane);
      // Traffic catching up from behind when the player is slower than the flow.
      const flow = LANE_FLOW[lane][0] * KMH * (this.opts.pace ?? 1);
      if (!pocket && p.speed < flow - 2 && this.cars.length < this.opts.maxCars) {
        const behind = this.cars.some((c) => c.lane === lane && c.s < p.s && c.s > p.s - DESPAWN_BEHIND);
        if (!behind) this.trySpawn(p.s - this.rng.range(170, 220), p, lane);
      }
    }
  }

  private trySpawn(s: number, p: PlayerState, lane: LaneId): boolean {
    if (!this.layout.availableLanes(s, 0.95).includes(lane)) return false;
    // A pocket car needs room to merge out before its lane ends.
    const zone = this.layout.zoneAt(s);
    if ((lane === -1 || lane === 3) && (!zone || zone.fullEnd - s < 260)) return false;
    const type = this.pickType(lane);
    const [lo, hi] = LANE_FLOW[lane];
    const v0 = (type.heavy ? this.rng.range(60, 76) : this.rng.range(lo, hi)) * KMH * (this.opts.pace ?? 1);
    // Same-lane spacing.
    const minGap = Math.max(26, v0 * 1.6);
    for (const c of this.cars) {
      if ((c.lane === lane || c.toLane === lane) && Math.abs(c.s - s) < minGap + (c.type.length + type.length) / 2) return false;
    }
    // Never on top of the player.
    if (Math.abs(p.s - s) < 40 && Math.abs(p.x - this.layout.laneCenter(lane, s)) < LANE_WIDTH) return false;
    if (this.wouldWall(s, lane, null) || this.wallSoon(s, lane, v0)) return false;
    const car: TrafficCar = {
      id: this.nextId++,
      type,
      s,
      x: this.layout.laneCenter(lane, s),
      v: v0,
      v0,
      accel: 0,
      lane,
      toLane: lane,
      phase: 'none',
      phaseT: 0,
      phaseDur: 0,
      signal: 0,
      braking: false,
      psi: 0,
      bump: 0,
      bumpV: 0,
      wallAdj: 0,
      wallT: 0,
      nextDecision: this.time + this.rng.range(1, 4),
      mergeInto: null,
      mass: 1350 * clamp((type.length * type.width * type.height) / (4.6 * 1.8 * 1.45), 0.7, 4),
      paint: this.rng.int(0, 1000),
    };
    this.cars.push(car);
    this.stats.spawned++;
    this.onSpawn(car);
    return true;
  }

  private despawn(p: PlayerState): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const stranded =
        (c.lane === -1 || c.lane === 3) && c.phase === 'none' && !this.layout.availableLanes(c.s, 0.3).includes(c.lane) && (c.s < p.s - 20 || c.s > p.s + 250);
      if (c.s < p.s - DESPAWN_BEHIND || c.s > p.s + DESPAWN_AHEAD || stranded) {
        this.cars.splice(i, 1);
        this.onDespawn(c);
      }
    }
  }

  // ---------------------------------------------------------- lane occupancy

  private sortBySpace(): void {
    this.cars.sort((a, b) => a.s - b.s);
  }

  /** Lanes a car occupies (both while changing). */
  private lanesOf(c: TrafficCar): LaneId[] {
    return c.phase === 'move' ? [c.lane, c.toLane] : [c.lane];
  }

  /**
   * Would adding (or moving) a car at `s` in `lane` close every lane inside
   * some WALL_WINDOW? `ignore` is the car being moved.
   */
  wouldWall(s: number, lane: LaneId, ignore: TrafficCar | null, extraLane?: LaneId, margin = 10): boolean {
    const later = this.layout.availableLanes(s + WALL_WINDOW + 70, 0.3);
    const avail = this.layout.availableLanes(s, 0.3).filter((l) => later.includes(l));
    // Any window containing s lies within [s - W, s + W]; check each window anchored at a car.
    const w = WALL_WINDOW + margin;
    const near = this.cars.filter((c) => c !== ignore && Math.abs(c.s - s) < w);
    const points = [{ s, lanes: extraLane === undefined ? [lane] : [lane, extraLane] }, ...near.map((c) => ({ s: c.s, lanes: this.lanesOf(c) }))];
    for (const start of points) {
      const w0 = Math.min(start.s, s);
      if (s - w0 > w) continue;
      const covered = new Set<number>();
      for (const q of points) if (q.s >= w0 && q.s <= w0 + w) q.lanes.forEach((l) => covered.add(l));
      if (avail.every((l) => covered.has(l))) return true;
    }
    return false;
  }

  /** Finds any window ahead of the player that blocks every lane and nudges it apart. */
  private breakWalls(p: PlayerState): void {
    const ahead = this.cars.filter((c) => c.s > p.s - 5 && c.s < p.s + 650);
    for (let i = 0; i < ahead.length; i++) {
      const w0 = ahead[i].s;
      const group = [];
      const covered = new Set<number>();
      for (let j = i; j < ahead.length && ahead[j].s <= w0 + WALL_WINDOW; j++) {
        group.push(ahead[j]);
        this.lanesOf(ahead[j]).forEach((l) => covered.add(l));
      }
      const avail = this.layout.availableLanes(w0, 0.3);
      if (group.length < 2 || !avail.every((l) => covered.has(l))) continue;
      // Spread the group: the front runs away (the back holds itself via wallObstacle).
      const lead = group[group.length - 1];
      lead.wallAdj = 3;
      lead.wallT = 5;

      // A car mid-change would close the gap for good: cancel a change that hasn't started moving.
      for (const c of group) if (c.phase === 'signal') this.cancelChange(c);
      this.stats.wallsBroken++;
    }
  }

  // ------------------------------------------------------------- behaviour

  /**
   * The rearmost car of a would-be roadblock is responsible for it: it treats
   * the point where it would close the last free lane as a moving obstacle.
   * Returns that obstacle's gap (m, <= 0 when already closed) and speed.
   */
  private wallObstacle(car: TrafficCar): { gap: number; v: number } | null {
    const own = this.lanesOf(car);
    // A closing pocket doesn't count as an escape: what is legal with four lanes becomes a wall at the taper.
    const later = this.layout.availableLanes(car.s + WALL_WINDOW + 70, 0.3);
    const others = this.layout.availableLanes(car.s + WALL_WINDOW / 2, 0.3).filter((l) => !own.includes(l) && later.includes(l));
    if (!others.length) return null;
    const look = car.s + WALL_WINDOW + 90;
    const ahead: TrafficCar[] = [];
    for (const o of this.cars) if (o !== car && o.s > car.s && o.s < look) ahead.push(o);
    let a = car.s;
    for (let k = 0; k <= ahead.length; k++) {
      const b = k < ahead.length ? ahead[k].s : Infinity;
      // For x in (a, b]: the nearest car ahead of x in every other lane.
      let m = -Infinity;
      let limiter: TrafficCar | null = null;
      for (const l of others) {
        let first: TrafficCar | null = null;
        for (let j = k; j < ahead.length; j++) {
          const o = ahead[j];
          if (o.lane === l || (o.phase === 'move' && o.toLane === l)) {
            first = o;
            break;
          }
        }
        if (!first) {
          m = Infinity;
          break;
        }
        if (first.s > m) {
          m = first.s;
          limiter = first;
        }
      }
      if (m !== Infinity) {
        const x = Math.max(a, m - WALL_WINDOW);
        if (x <= b) return { gap: x - car.s, v: limiter!.v };
      }
      // We can't pass our own leader, so nothing beyond it matters.
      if (k < ahead.length && own.some((l) => ahead[k].lane === l)) break;
      a = b;
    }
    return null;
  }

  private leaderIn(car: TrafficCar, lane: LaneId, p: PlayerState | null): { gap: number; v: number } {
    let gap = Infinity;
    let v = car.v0;
    for (const o of this.cars) {
      if (o === car || o.s <= car.s) continue;
      if (o.lane !== lane && !(o.phase === 'move' && o.toLane === lane) && o.mergeInto !== lane) continue;
      const g = o.s - car.s - (o.type.length + car.type.length) / 2;
      if (g < gap) {
        gap = g;
        v = o.v;
      }
    }
    if (p) {
      // The player counts as a leader when overlapping the lane band.
      const cx = this.layout.laneCenter(lane, car.s);
      if (p.s > car.s && Math.abs(p.x - cx) < (p.width + car.type.width) / 2 + 0.4) {
        const g = p.s - car.s - (p.length + car.type.length) / 2;
        if (g < gap) {
          gap = g;
          v = p.speed;
        }
      }
    }
    return { gap, v };
  }

  private followerIn(car: TrafficCar, lane: LaneId): { gap: number; v: number } {
    let gap = Infinity;
    let v = 0;
    for (const o of this.cars) {
      if (o === car || o.s >= car.s) continue;
      if (o.lane !== lane && !(o.phase === 'move' && o.toLane === lane)) continue;
      const g = car.s - o.s - (o.type.length + car.type.length) / 2;
      if (g < gap) {
        gap = g;
        v = o.v;
      }
    }
    return { gap, v };
  }

  private playerNear(p: PlayerState, lane: LaneId, s: number, behind: number, ahead: number): boolean {
    const cx = this.layout.laneCenter(lane, s);
    return Math.abs(p.x - cx) < LANE_WIDTH * 0.9 && p.s > s - behind && p.s < s + ahead;
  }

  /**
   * Gap check for entering `lane`. `urgency` 0 = optional change, 1 = a pocket
   * that is about to end: gaps shrink (the follower will brake) and the
   * roadblock rule is skipped, since merging can only remove a lane.
   */
  private safeToEnter(car: TrafficCar, lane: LaneId, p: PlayerState, urgency = 0): boolean {
    const merging = urgency > 0;
    if (!merging && !this.layout.availableLanes(car.s + 30, 0.95).includes(lane)) return false;
    const lead = this.leaderIn(car, lane, null);
    const foll = this.followerIn(car, lane);
    const k = 1 - 0.75 * urgency;
    // A yielding follower stops close behind a zipper merger, so urgent merges accept short gaps,
    // but never less than the follower needs to brake (5 m/s²) down to our speed.
    const minGap = merging ? 2.5 : 6;
    const closing = Math.max(0, foll.v - car.v);
    if (lead.gap < Math.max(minGap, car.v * 0.7 * k)) return false;
    if (foll.gap < Math.max(minGap, foll.v * 0.8 * k + closing * 2.5 * k, (closing * closing) / 10 + 2)) return false;
    // Don't cut in on the player.
    if (this.playerNear(p, lane, car.s, (35 + Math.max(0, p.speed - car.v) * 1.5) * (merging ? 0.6 : 1), 12)) return false;
    // Only a pocket about to end may close the road briefly; earlier merges wait for a stagger.
    return urgency > 0.7 || !this.wouldWall(car.s, lane, car, car.lane);
  }

  /** Would a car spawned at s with speed v drift into a roadblock within a few seconds? */
  private wallSoon(s: number, lane: LaneId, v: number): boolean {
    for (const T of [3, 6]) {
      const sNew = s + v * T;
      const covered = new Set<number>([lane]);
      for (const c of this.cars) {
        if (Math.abs(c.s + c.v * T - sNew) < WALL_WINDOW * 0.6) this.lanesOf(c).forEach((l) => covered.add(l));
      }
      if (this.layout.availableLanes(sNew, 0.3).every((l) => covered.has(l))) return true;
    }
    return false;
  }

  /** How urgently a pocket car must leave: 0 far from the end … 1 at the end. */
  private pocketUrgency(car: TrafficCar): number {
    const zone = this.layout.zoneAt(car.s);
    if (!zone) return 1;
    const toEnd = zone.fullEnd - car.s;
    return clamp(1 - (toEnd - 40) / 220, 0, 1);
  }

  private startChange(car: TrafficCar, lane: LaneId): void {
    car.toLane = lane;
    car.phase = 'signal';
    car.phaseT = 0;
    const pocket = car.lane === -1 || car.lane === 3;
    car.phaseDur = pocket ? this.rng.range(0.7, 1.1) : this.rng.range(1.1, 1.8);
    car.signal = lane < car.lane ? -1 : 1;
  }

  private cancelChange(car: TrafficCar): void {
    car.phase = 'none';
    car.toLane = car.lane;
    car.signal = 0;
  }

  private think(car: TrafficCar, p: PlayerState): void {
    const zone = this.layout.zoneAt(car.s);
    const inPocket = car.lane === -1 || car.lane === 3;

    // Pocket lane closing: scan the neighbour lane and merge early, signalling.
    if (inPocket && car.phase === 'none') {
      const target: LaneId = car.lane === 3 ? 2 : 0;
      const urgency = this.pocketUrgency(car);
      if (urgency > 0 && this.safeToEnter(car, target, p, urgency)) {
        car.mergeInto = null;
        this.startChange(car, target);
        this.stats.pocketMerges++;
      } else {
        // Late in the pocket, ask the target lane to let us in (zipper merge).
        car.mergeInto = urgency > 0.55 ? target : null;
      }
      return;
    }
    if (car.phase === 'signal') {
      // Abort if the gap closed while signalling (pocket merges only abort for a real conflict).
      const pocket = car.lane === -1 || car.lane === 3;
      if (!this.safeToEnter(car, car.toLane, p, pocket ? Math.max(0.6, this.pocketUrgency(car)) : 0)) this.cancelChange(car);
      return;
    }
    if (car.phase !== 'none' || this.time < car.nextDecision) return;
    car.nextDecision = this.time + this.rng.range(1.5, 4);
    if (this.opts.laneChanges === false) return;

    const lead = this.leaderIn(car, car.lane, p);
    const blocked = lead.gap < 70 && lead.v < car.v0 - 2.5;
    const left = (car.lane - 1) as LaneId;
    const right = (car.lane + 1) as LaneId;
    const lanes = this.layout.availableLanes(car.s + 40, 0.95);
    const canUse = (l: LaneId) =>
      lanes.includes(l) && !(car.type.heavy && l !== 2 && l !== 3) &&
      // Pockets only when they have plenty of length left.
      (!(l === -1 || l === 3) || (zone !== null && zone.fullEnd - car.s > 280 && this.rng.chance(0.4)));
    if (blocked) {
      for (const l of [left, right]) {
        if (!canUse(l)) continue;
        const ahead = this.leaderIn(car, l, p);
        if (ahead.gap > lead.gap + 25 && this.safeToEnter(car, l, p)) {
          this.startChange(car, l);
          return;
        }
      }
    } else if (lead.gap > 140 && canUse(right) && right <= 2 && this.rng.chance(0.25)) {
      // Keep right when the road ahead is clear.
      const ahead = this.leaderIn(car, right, p);
      if (ahead.gap > 120 && this.safeToEnter(car, right, p)) this.startChange(car, right);
    }
  }

  private drive(car: TrafficCar, dt: number, p: PlayerState): void {
    // Lane-change state machine.
    if (car.phase === 'signal') {
      car.phaseT += dt;
      if (car.phaseT >= car.phaseDur) {
        car.phase = 'move';
        car.phaseT = 0;
        car.phaseDur = clamp(2.2 + (car.v - 20) * 0.03, 2.2, 3.4) * (car.type.heavy ? 1.3 : 1);
        this.stats.laneChanges++;
      }
    } else if (car.phase === 'move') {
      car.phaseT += dt;
      if (car.phaseT >= car.phaseDur) {
        car.lane = car.toLane;
        car.phase = 'none';
        car.signal = 0;
      }
    }

    // Longitudinal: IDM against the leader (both lanes while moving across).
    let lead = this.leaderIn(car, car.lane, p);
    if (car.phase === 'move') {
      const l2 = this.leaderIn(car, car.toLane, p);
      if (l2.gap < lead.gap) lead = l2;
    }
    // A closing pocket acts as a stopped obstacle at its end.
    if (car.lane === -1 || car.lane === 3) {
      const zone = this.layout.zoneAt(car.s);
      if (zone && car.phase !== 'move') {
        const g = zone.fullEnd + 8 - car.s - car.type.length / 2;
        if (g < lead.gap) lead = { gap: g, v: 0 };
      }
    }
    if (car.wallT > 0) {
      car.wallT -= dt;
      if (car.wallT <= 0) car.wallAdj = 0;
    }
    let v0 = Math.max(5, car.v0 + car.wallAdj);
    if ((car.lane === -1 || car.lane === 3) && car.phase !== 'move') {
      // Match the neighbour lane before merging so a gap can open beside us.
      const u = this.pocketUrgency(car);
      if (u > 0) {
        const flow = LANE_FLOW[car.lane === 3 ? 2 : 0][0] * KMH * (this.opts.pace ?? 1);
        v0 = Math.min(v0, flow + (v0 - flow) * (1 - u));
      }
    }
    const dv = car.v - lead.v;
    const sStar = IDM_S0 + car.v * IDM_T + (car.v * dv) / (2 * Math.sqrt(IDM_A * IDM_B));
    const free = 1 - Math.pow(car.v / v0, 4);
    const inter = lead.gap === Infinity ? 0 : Math.pow(Math.max(sStar, 0) / Math.max(lead.gap, 0.5), 2);
    car.accel = clamp(IDM_A * (free - inter), -9, IDM_A);
    // Never close the last free lane: drop back behind the roadblock point with a few metres
    // of margin, braking gently since it's courtesy, not a collision.
    const wall = this.wallObstacle(car);
    if (wall) {
      const g = Math.max(0.5, wall.gap - 4 + car.v * 0.6);
      const wv = Math.min(wall.v, car.v);
      const ws = IDM_S0 + car.v * IDM_T + (car.v * (car.v - wv)) / (2 * Math.sqrt(IDM_A * IDM_B));
      const wa = IDM_A * (free - Math.pow(Math.max(ws, 0) / g, 2));
      car.accel = Math.min(car.accel, Math.max(-3.5, wa));
    }
    car.v = Math.max(0, car.v + car.accel * dt);
    car.s += car.v * dt;
    car.braking = car.accel < -0.9 || car.v < 1;

    // Lateral: follow the lane centre (pocket centres slide with the taper).
    const from = this.layout.laneCenter(car.lane, car.s);
    let target = from;
    if (car.phase === 'move') {
      const to = this.layout.laneCenter(car.toLane, car.s);
      target = from + (to - from) * smootherstep(0, 1, car.phaseT / car.phaseDur);
    }
    // Knock from contacts: a damped spring back to the lane.
    car.bumpV += (-car.bump * 9 - car.bumpV * 4.5) * dt;
    car.bump += car.bumpV * dt;
    const prevX = car.x;
    car.x = target + car.bump;
    const lateral = (car.x - prevX) / dt;
    car.psi = Math.atan2(lateral, Math.max(car.v, 3));
  }
}
