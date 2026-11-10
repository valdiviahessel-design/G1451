import { BASE_HALF_WIDTH, LANE_WIDTH, POCKET } from '../config';
import { Rng, smootherstep } from '../core/math';

export type Side = -1 | 1;

/**
 * One overtake pocket: a 4th lane that opens on `side` (-1 left, +1 right).
 * All values are distances `s` along the road in meters.
 */
export interface PocketZone {
  id: number;
  side: Side;
  /** Widening taper begins. */
  start: number;
  /** Full four-lane width reached. */
  fullStart: number;
  /** Narrowing taper begins. */
  fullEnd: number;
  /** Back to three lanes. */
  end: number;
  /** Warning signs and merge arrows start here (150 m before the narrowing). */
  warningStart: number;
}

export interface CrossSection {
  left: number;
  right: number;
  /** Pocket side active at this s (0 if none). */
  side: Side | 0;
  /** 0 = closed, 1 = fully open pocket lane. */
  open: number;
  zone: PocketZone | null;
}

/** Lane ids: -1 left pocket, 0..2 main lanes (left to right), 3 right pocket. */
export type LaneId = -1 | 0 | 1 | 2 | 3;

/**
 * Procedural, endless road description. Pure data: geometry, traffic and
 * gameplay all query it so they agree on where lanes are.
 */
export class RoadLayout {
  private zones: PocketZone[] = [];
  private cursor: number;
  private nextId = 1;
  private rng: Rng;

  constructor(seed = 1337, firstPocketAt = 140) {
    this.rng = new Rng(seed);
    this.cursor = firstPocketAt;
  }

  /** Generate zones until at least `sMax` is covered. */
  ensure(sMax: number): void {
    while (this.cursor < sMax) {
      const r = this.rng;
      const side: Side = r.chance(0.5) ? 1 : -1;
      const start = this.cursor;
      const fullStart = start + r.range(POCKET.taperMin, POCKET.taperMax);
      const fullEnd = fullStart + r.range(POCKET.lengthMin, POCKET.lengthMax);
      const end = fullEnd + r.range(POCKET.taperMin, POCKET.taperMax);
      this.zones.push({
        id: this.nextId++,
        side,
        start,
        fullStart,
        fullEnd,
        end,
        warningStart: fullEnd - POCKET.warningDistance,
      });
      this.cursor = end + r.range(POCKET.gapMin, POCKET.gapMax);
    }
  }

  /** Drop zones that ended well behind the camera. */
  prune(sMin: number): void {
    while (this.zones.length && this.zones[0].end < sMin) this.zones.shift();
  }

  zoneAt(s: number): PocketZone | null {
    for (const z of this.zones) {
      if (s < z.start) return null;
      if (s <= z.end) return z;
    }
    return null;
  }

  zonesIn(s0: number, s1: number): PocketZone[] {
    return this.zones.filter((z) => z.end >= s0 && z.start <= s1);
  }

  openness(zone: PocketZone, s: number): number {
    if (s <= zone.fullStart) return smootherstep(zone.start, zone.fullStart, s);
    return 1 - smootherstep(zone.fullEnd, zone.end, s);
  }

  crossSection(s: number, out: CrossSection = { left: 0, right: 0, side: 0, open: 0, zone: null }): CrossSection {
    const zone = this.zoneAt(s);
    const open = zone ? this.openness(zone, s) : 0;
    out.zone = zone;
    out.open = open;
    out.side = zone && open > 0 ? zone.side : 0;
    out.left = -BASE_HALF_WIDTH - (zone?.side === -1 ? open * LANE_WIDTH : 0);
    out.right = BASE_HALF_WIDTH + (zone?.side === 1 ? open * LANE_WIDTH : 0);
    return out;
  }

  leftEdge(s: number): number {
    return this.crossSection(s, scratch).left;
  }

  rightEdge(s: number): number {
    return this.crossSection(s, scratch).right;
  }

  /** Lateral center of a lane. Pocket lane centers slide in with the taper. */
  laneCenter(lane: LaneId, s: number): number {
    if (lane >= 0 && lane <= 2) return -BASE_HALF_WIDTH + LANE_WIDTH * (lane + 0.5);
    const cs = this.crossSection(s, scratch);
    const sign = lane === 3 ? 1 : -1;
    const wanted: Side = lane === 3 ? 1 : -1;
    const open = cs.side === wanted ? cs.open : 0;
    return sign * (BASE_HALF_WIDTH + (open * LANE_WIDTH) / 2);
  }

  /** Lanes a vehicle may occupy at `s` (pocket requires `minOpen`). */
  availableLanes(s: number, minOpen = 0.9): LaneId[] {
    const cs = this.crossSection(s, scratch);
    const lanes: LaneId[] = [0, 1, 2];
    if (cs.side === -1 && cs.open >= minOpen) lanes.unshift(-1);
    if (cs.side === 1 && cs.open >= minOpen) lanes.push(3);
    return lanes;
  }
}

const scratch: CrossSection = { left: 0, right: 0, side: 0, open: 0, zone: null };
