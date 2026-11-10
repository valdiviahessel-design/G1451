/**
 * Oriented boxes in road space: x lateral, s along the road, psi heading
 * (> 0 = nose to the right). Used for traffic contacts and near-miss gaps.
 */
export interface Obb {
  x: number;
  s: number;
  psi: number;
  /** Half width / half length, m. */
  hw: number;
  hl: number;
}

type V2 = [number, number];

export function corners(b: Obb, out: V2[] = [[0, 0], [0, 0], [0, 0], [0, 0]]): V2[] {
  const c = Math.cos(b.psi);
  const sn = Math.sin(b.psi);
  // Forward axis f = (sin, cos), right axis r = (cos, -sin) in (x, s).
  const fx = sn * b.hl;
  const fs = c * b.hl;
  const rx = c * b.hw;
  const rs = -sn * b.hw;
  out[0][0] = b.x + fx + rx;
  out[0][1] = b.s + fs + rs;
  out[1][0] = b.x + fx - rx;
  out[1][1] = b.s + fs - rs;
  out[2][0] = b.x - fx - rx;
  out[2][1] = b.s - fs - rs;
  out[3][0] = b.x - fx + rx;
  out[3][1] = b.s - fs + rs;
  return out;
}

const ca: V2[] = [[0, 0], [0, 0], [0, 0], [0, 0]];
const cb: V2[] = [[0, 0], [0, 0], [0, 0], [0, 0]];

export interface Contact {
  /** Penetration depth, m. */
  depth: number;
  /** Unit normal pointing from b to a. */
  nx: number;
  ns: number;
  /** Approximate contact point. */
  px: number;
  ps: number;
}

/** Separating-axis test; returns the minimum translation for `a` or null. */
export function overlap(a: Obb, b: Obb): Contact | null {
  corners(a, ca);
  corners(b, cb);
  let best = Infinity;
  let bx = 0;
  let bs = 0;
  for (const box of [a, b]) {
    const c = Math.cos(box.psi);
    const sn = Math.sin(box.psi);
    for (const [ax, as] of [
      [sn, c],
      [c, -sn],
    ] as V2[]) {
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of ca) {
        const d = p[0] * ax + p[1] * as;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const p of cb) {
        const d = p[0] * ax + p[1] * as;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      const o = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        const dir = (a.x - b.x) * ax + (a.s - b.s) * as >= 0 ? 1 : -1;
        bx = ax * dir;
        bs = as * dir;
      }
    }
  }
  // Contact point: the corner of either box deepest inside the other, approximated by the midpoint.
  return { depth: best, nx: bx, ns: bs, px: (a.x + b.x) / 2, ps: (a.s + b.s) / 2 };
}

function pointSegment(px: number, ps: number, a: V2, b: V2): number {
  const dx = b[0] - a[0];
  const ds = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (ps - a[1]) * ds) / (dx * dx + ds * ds || 1)));
  return Math.hypot(px - (a[0] + dx * t), ps - (a[1] + ds * t));
}

/** Shortest distance between two boxes' outlines (0 when they overlap). */
export function distance(a: Obb, b: Obb): number {
  if (overlap(a, b)) return 0;
  corners(a, ca);
  corners(b, cb);
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const a0 = ca[i];
    const a1 = ca[(i + 1) % 4];
    const b0 = cb[i];
    const b1 = cb[(i + 1) % 4];
    for (const p of cb) d = Math.min(d, pointSegment(p[0], p[1], a0, a1));
    for (const p of ca) d = Math.min(d, pointSegment(p[0], p[1], b0, b1));
  }
  return d;
}
