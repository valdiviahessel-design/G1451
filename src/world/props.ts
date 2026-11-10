import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly, vertex-coloured roadside props. Every builder returns one merged,
 * non-indexed geometry (position / normal / uv / color) so a whole prop type
 * renders as a single instanced draw call.
 */

const _c = new THREE.Color();

function tint(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.setHex(color);
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Box standing on y. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

export function cyl(rTop: number, rBottom: number, h: number, seg: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

/** Four-sided hip roof / tapered block with a w × d footprint; `top` is the ridge size as a fraction. */
export function hip(w: number, d: number, h: number, x: number, y: number, z: number, color: number, top = 0.12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top * Math.SQRT1_2, Math.SQRT1_2, h, 4, 1);
  g.rotateY(Math.PI / 4);
  g.scale(w, 1, d);
  g.translate(x, y + h / 2, z);
  return tint(g, color);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  out.computeBoundingSphere();
  return out;
}

const RED = 0xc23b22;
const WALL = 0xf0e6d2;
const ROOF = 0x2c3538;
const GOLD = 0xd9b04c;
const STONE = 0x8d8a82;
const WOOD = 0x4e3423;

/** Five-storey pagoda, ~31 m tall. */
export function pagodaGeometry(tiers = 5): THREE.BufferGeometry {
  const parts = [box(11, 1.2, 11, 0, 0, 0, STONE)];
  let y = 1.2;
  const w = 9;
  for (let t = 0; t < tiers; t++) {
    const bw = w * (1 - t * 0.13);
    parts.push(box(bw * 0.62, 2.7, bw * 0.62, 0, y, 0, t % 2 ? WALL : RED));
    y += 2.7;
    parts.push(hip(bw * 1.3, bw * 1.3, 1.5, 0, y - 0.25, 0, ROOF, 0.42));
    y += 1.25;
  }
  parts.push(hip(w * 0.42, w * 0.42, 2.4, 0, y - 0.2, 0, ROOF, 0.02));
  parts.push(cyl(0.1, 0.22, 5.5, 6, 0, y + 1.6, 0, GOLD));
  return merge(parts);
}

/** Tiled-roof farmhouse, 9 × 7 m footprint. */
export function houseGeometry(): THREE.BufferGeometry {
  return merge([
    box(9.2, 0.7, 7.2, 0, 0, 0, WOOD),
    box(9, 2.6, 7, 0, 0.7, 0, WALL),
    box(9.05, 0.25, 7.05, 0, 2.2, 0, WOOD),
    hip(11.4, 9.4, 2.8, 0, 3.3, 0, ROOF, 0.2),
    box(4.4, 0.5, 0.7, 0, 5.9, 0, ROOF),
  ]);
}

/** White keep on a stone base, ~38 m tall. */
export function castleGeometry(): THREE.BufferGeometry {
  const parts = [hip(34, 30, 9, 0, 0, 0, STONE, 0.78)];
  let y = 9;
  const tiers: [number, number, number][] = [
    [24, 20, 5.5],
    [17, 14, 5],
    [11, 9, 4.5],
  ];
  tiers.forEach(([w, d, h]) => {
    parts.push(box(w, h, d, 0, y, 0, 0xf4f1ea));
    y += h;
    parts.push(hip(w * 1.22, d * 1.22, 2.2, 0, y - 0.3, 0, 0x4a5a63, 0.6));
    y += 1.8;
  });
  parts.push(hip(11, 9, 3.4, 0, y - 0.3, 0, 0x4a5a63, 0.05));
  parts.push(cyl(0.2, 0.3, 1.6, 5, -3.2, y + 2.3, 0, GOLD), cyl(0.2, 0.3, 1.6, 5, 3.2, y + 2.3, 0, GOLD));
  return merge(parts);
}

/** Vermilion gate; `span` is the pillar spacing, `r` the pillar radius. */
export function toriiGeometry(span: number, height: number, r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(cyl(r * 0.85, r, height, 14, (sx * span) / 2, 0, 0, RED));
    parts.push(cyl(r * 1.25, r * 1.35, r * 1.4, 14, (sx * span) / 2, 0, 0, 0x1c1c1e));
    // Upturned tips of the top lintel.
    const tip = new THREE.BoxGeometry(span * 0.2, r * 0.9, r * 1.9);
    tip.rotateZ(sx * 0.2);
    tip.translate(sx * span * 0.74, height + r * 2.55, 0);
    parts.push(tint(tip, 0x1c1c1e));
  }
  parts.push(box(span * 1.2, r * 1.2, r * 0.9, 0, height * 0.74, 0, RED));
  parts.push(box(span * 1.34, r * 1.1, r * 1.4, 0, height, 0, RED));
  parts.push(box(span * 1.4, r * 0.9, r * 1.9, 0, height + r * 1.1, 0, 0x1c1c1e));
  parts.push(box(r * 2, height * 0.26 - r * 1.2, r * 0.6, 0, height * 0.74 + r * 1.2, 0, RED));
  return merge(parts);
}

/** Lattice tower in aviation orange and white, 333 m. */
export function towerGeometry(): THREE.BufferGeometry {
  const H = 333;
  const rAt = (y: number) => 44 * Math.pow(1 - y / H, 1.7) + 1.6;
  const parts: THREE.BufferGeometry[] = [];
  const bands = 11;
  for (let i = 0; i < bands; i++) {
    const y0 = (i / bands) * 270;
    const y1 = ((i + 1) / bands) * 270;
    const g = new THREE.CylinderGeometry(rAt(y1) * Math.SQRT2, rAt(y0) * Math.SQRT2, y1 - y0, 4, 1);
    g.rotateY(Math.PI / 4);
    g.translate(0, (y0 + y1) / 2, 0);
    parts.push(tint(g, i % 2 ? 0xf2f2f2 : 0xff5a1f));
  }
  parts.push(box(26, 8, 26, 0, 120, 0, 0xf2f2f2), box(13, 6, 13, 0, 222, 0, 0xf2f2f2));
  parts.push(cyl(0.5, 1.6, 63, 6, 0, 270, 0, 0xff5a1f));
  return merge(parts);
}

/** Slender broadcast tower, 634 m. */
export function skytreeGeometry(): THREE.BufferGeometry {
  return merge([
    cyl(7, 26, 340, 12, 0, 0, 0, 0xbcd4ff),
    cyl(17, 13, 14, 16, 0, 340, 0, 0xe8f2ff),
    cyl(15, 17, 12, 16, 0, 354, 0, 0x9fc4ff),
    cyl(5, 7, 110, 10, 0, 366, 0, 0xbcd4ff),
    cyl(0.8, 3, 158, 6, 0, 476, 0, 0xffffff),
  ]);
}

/** Simple saloon seen across the median; faces +z, white body takes the instance colour. */
export function simpleCarGeometry(): THREE.BufferGeometry {
  const parts = [
    box(1.8, 0.5, 4.4, 0, 0.3, 0, 0xffffff),
    // Bonnet and boot taper away from the cabin so the silhouette reads as a saloon, not a brick.
    hip(1.78, 4.36, 0.2, 0, 0.8, 0, 0xffffff, 0.86),
    hip(1.6, 2.5, 0.5, 0, 0.98, -0.3, 0x10161d, 0.7),
    box(1.22, 0.05, 1.6, 0, 1.47, -0.3, 0xffffff),
    box(1.5, 0.1, 0.08, 0, 0.45, 2.2, 0x1a1c1f),
  ];
  for (const x of [-0.82, 0.82]) {
    for (const z of [-1.4, 1.4]) {
      const w = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.33, z);
      parts.push(tint(w, 0x0c0c0d));
    }
    parts.push(box(0.36, 0.14, 0.06, x * 0.76, 0.66, 2.2, 0xfff6e0));
  }
  return merge(parts);
}

/** Articulated lorry, 14 m; faces +z. */
export function simpleTruckGeometry(): THREE.BufferGeometry {
  const parts = [box(2.45, 2.5, 2.3, 0, 0.6, 5.6, 0xffffff), box(2.3, 0.9, 0.1, 0, 1.9, 6.76, 0x10161d), box(2.5, 2.9, 10.6, 0, 1.0, -1.2, 0xdfe3e6), box(2.2, 0.5, 13, 0, 0.5, 0, 0x16171a)];
  for (const x of [-1.05, 1.05]) {
    for (const z of [5.4, 2.2, -4.4, -5.6]) {
      const w = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 10);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.5, z);
      parts.push(tint(w, 0x0c0c0d));
    }
    parts.push(box(0.4, 0.18, 0.06, x * 0.8, 0.95, 6.76, 0xfff6e0));
  }
  return merge(parts);
}

/** Two crossed quads for a tree billboard, w × h, rooted at the origin. Normals point up so both faces light evenly. */
export function billboardGeometry(w: number, h: number, planes = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const cx = (Math.cos(a) * w) / 2;
    const cz = (Math.sin(a) * w) / 2;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, 0, -cz, cx, h, cz, -cx, h, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    for (let i = 0; i < 6; i++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

/** Roadside hoarding: group 0 = frame and posts (vertex colours), group 1 = the 8 × 4 m advert face (+z). */
export function hoardingGeometry(): THREE.BufferGeometry {
  const frame = merge([box(0.35, 9.4, 0.35, -2.6, 0, -0.3, 0x5b6066), box(0.35, 9.4, 0.35, 2.6, 0, -0.3, 0x5b6066), box(8.3, 4.3, 0.2, 0, 5.2, -0.12, 0x2b2e33)]);
  const face = new THREE.PlaneGeometry(8, 4);
  face.translate(0, 7.35, 0);
  const faceN = tint(face, 0xffffff);
  const n0 = frame.attributes.position.count;
  const out = mergeGeometries([frame, faceN])!;
  out.addGroup(0, n0, 0);
  out.addGroup(n0, faceN.attributes.position.count, 1);
  out.computeBoundingSphere();
  return out;
}

/** Unit sign plane (1 × 3) hanging from its top edge, facing +z. */
export function neonGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 3);
  g.computeBoundingSphere();
  return g;
}

/**
 * Snow-capped volcano as a lathe. Unlit: the haze colour and a soft key light
 * are baked into vertex colours because it sits far beyond the fog.
 */
export function fujiGeometry(haze: THREE.Color, sun: THREE.Vector3): THREE.BufferGeometry {
  const profile = [
    [1250, 0],
    [860, 70],
    [560, 210],
    [330, 360],
    [200, 448],
    [150, 476],
    [118, 480],
    [0, 468],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(profile, 72);
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x4b5f96);
  const snow = new THREE.Color(0xffffff);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 480;
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const line = 0.6 + 0.06 * Math.sin(a * 7 + 1.3) + 0.035 * Math.sin(a * 19) + 0.02 * Math.sin(a * 41 + 2);
    const snowy = THREE.MathUtils.smoothstep(h, line - 0.03, line + 0.03);
    c.copy(rock).lerp(snow, snowy);
    const lit = 0.72 + 0.28 * Math.max(0, nor.getX(i) * sun.x + nor.getZ(i) * sun.z + 0.4);
    c.multiplyScalar(lit);
    // Aerial perspective: strongest at the foot, where the mountain meets the mist.
    const air = THREE.MathUtils.lerp(0.92, snowy > 0.5 ? 0.18 : 0.45, THREE.MathUtils.smoothstep(h, 0.0, 0.5));
    c.lerp(haze, air);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
