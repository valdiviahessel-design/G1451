import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CarMaterialSet, createContactShadow, limitGlare, type PartClass } from './CarMaterials';

/**
 * Turns an arbitrary car .glb into a game-ready rig:
 *  1. finds wheels (by node names, clustered spatially) and the forward axis;
 *  2. classifies every surface as paint / glass / lights / trim / tyre / rim,
 *     either from node+material names or, for palette-atlas models such as
 *     Kenney's, per triangle from the sampled texel colour;
 *  3. replaces materials with the PBR set from CarMaterials;
 *  4. rescales to real-world dimensions with the pivot on the ground between
 *     the axles, front facing -Z.
 * Analysis runs once per source file; instances share geometry.
 */

export interface FitSpec {
  length: number;
  width: number;
  height: number;
  wheelDiameter: number;
  /** Paint colour, or -1 to keep the model's own livery colour. */
  paint: number;
  metallic: number;
  rim: number;
  tint: number;
  stance?: number;
  /** Turn the model around when automatic front detection gets it wrong. */
  flip?: boolean;
}

export interface WheelRig {
  /** Rotates about Y for steering; positioned at the hub. */
  steer: THREE.Object3D;
  /** Rotates about X for rolling. */
  spin: THREE.Object3D;
  front: boolean;
  left: boolean;
  radius: number;
}

export interface VehicleModel {
  /** Ground-level pivot between the axles; front faces -Z. */
  root: THREE.Group;
  /** Sprung mass: apply roll/pitch here (pivot sits at roll-centre height). */
  body: THREE.Group;
  wheels: WheelRig[];
  materials: CarMaterialSet;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  /** Where the headlights sit (for the beam light), in root space. */
  headlightPos: THREE.Vector3;
  source: string;
  dispose(): void;
}

interface PartTemplate {
  geometry: THREE.BufferGeometry;
  /** Mesh transform in oriented model space (or hub space for wheel parts). */
  matrix: THREE.Matrix4;
  /** Class per geometry group (or a single entry when ungrouped). */
  classes: PartClass[];
  originals: THREE.Material[];
  /** Source node chain, kept on the mesh for debugging. */
  label: string;
  /** Wheel parts that steer but don't roll (brake calipers). */
  fixed?: boolean;
}
interface WheelTemplate {
  hub: THREE.Vector3;
  radius: number;
  halfWidth: number;
  parts: PartTemplate[];
}

interface Template {
  body: PartTemplate[];
  wheels: WheelTemplate[];
  box: THREE.Box3;
  liveryColor: THREE.Color | null;
  headlight: THREE.Vector3 | null;
  /** The model has a cabin behind its windows. */
  interior: boolean;
}

interface TriInfo {
  region: number;
  color: [number, number, number];
  centroid: THREE.Vector3;
}

// `\brim` / `rim_` so "trim" doesn't count as a wheel part.
// `(?<![tp])rim` matches "Rims", "Meshesrim1Mtl", but not "trim" or "primer".
const WHEEL_RE = /wheel|tire|tyre|(?<![tp])rim|brake_?disc|caliper/i;
const RED = (c: number[]) => c[0] > 0.55 && c[1] < 0.42 && c[2] < 0.42;
const YELLOW = (c: number[]) => c[0] > 0.85 && c[1] > 0.65 && c[2] < 0.5;
/** Same hue family (coloured), or similar lightness (neutral). */
function sameShade(a: number[], b: number[]): boolean {
  const hue = (c: number[]) => {
    const mx = Math.max(...c);
    const d = mx - Math.min(...c);
    if (d === 0) return 0;
    const h = mx === c[0] ? ((c[1] - c[2]) / d + 6) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return h / 6;
  };
  if (sat(a) > 0.3 && sat(b) > 0.3) {
    const d = Math.abs(hue(a) - hue(b));
    return Math.min(d, 1 - d) < 0.04 && lum(a) > 0.1;
  }
  return sat(a) <= 0.2 && sat(b) <= 0.2 && Math.abs(lum(a) - lum(b)) < 0.1;
}
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c: number[]) => {
  const mx = Math.max(...c);
  return mx > 0 ? (mx - Math.min(...c)) / mx : 0;
};

export class VehicleLoader {
  private readonly gltf: GLTFLoader;
  private readonly templates = new Map<string, Promise<Template | null>>();
  private readonly base: string;

  constructor(base = import.meta.env.BASE_URL) {
    this.base = base;
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${base}assets/draco/`);
    this.gltf = new GLTFLoader();
    this.gltf.setDRACOLoader(draco);
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Tries each source in order; falls back to a procedural car so the game never blocks. */
  async load(sources: string[], spec: FitSpec): Promise<VehicleModel> {
    for (const src of sources) {
      const template = await this.template(src, spec.flip ?? false);
      if (template) return instantiate(template, spec, src);
    }
    console.warn(`No vehicle model available (${sources.join(', ')}); using procedural body.`);
    return proceduralCar(spec);
  }

  private template(src: string, flip: boolean): Promise<Template | null> {
    const key = `${src}|${flip}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.gltf
        .loadAsync(this.base + src)
        .then((gltf) => analyse(gltf.scene, { hideBadges: true, flip }))
        .catch((err: unknown) => {
          // Only the last-resort stock models must exist; drop-in and Sketchfab ones are optional.
          if (src.includes('/kenney/')) console.warn(`Vehicle "${src}" failed to load`, err);
          return null;
        });
      this.templates.set(key, t);
    }
    return t;
  }
}

// ---------------------------------------------------------------------------
// Analysis

interface Palette {
  width: number;
  height: number;
  /** Swatch region id per texel. */
  region: Int32Array;
  /** Mean sRGB colour (0..1) per region. */
  colors: [number, number, number][];
}

const paletteCache = new WeakMap<object, Palette | null>();

/**
 * Segments a colour-atlas texture into swatches: flood fill that follows
 * smooth gradients but stops at hard colour edges. Returns null for photo
 * textures (too many regions), which then fall back to name-based rules.
 */
function paletteOf(tex: THREE.Texture): Palette | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  if (paletteCache.has(img)) return paletteCache.get(img)!;
  let result: Palette | null = null;
  try {
    const w = Math.min(img.width, 1024);
    const h = Math.min(img.height, 1024);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const region = new Int32Array(w * h).fill(-1);
    const sums: number[][] = [];
    const stack: number[] = [];
    const close = (a: number, b: number) =>
      Math.abs(px[a * 4] - px[b * 4]) <= 6 && Math.abs(px[a * 4 + 1] - px[b * 4 + 1]) <= 6 && Math.abs(px[a * 4 + 2] - px[b * 4 + 2]) <= 6;
    for (let seed = 0; seed < w * h && sums.length < 4096; seed++) {
      if (region[seed] >= 0) continue;
      const id = sums.length;
      const sum = [0, 0, 0, 0];
      region[seed] = id;
      stack.push(seed);
      while (stack.length) {
        const p = stack.pop()!;
        sum[0] += px[p * 4];
        sum[1] += px[p * 4 + 1];
        sum[2] += px[p * 4 + 2];
        sum[3]++;
        const x = p % w;
        const n = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const q of n) {
          if (q >= 0 && q < w * h && region[q] < 0 && close(p, q)) {
            region[q] = id;
            stack.push(q);
          }
        }
      }
      sums.push(sum);
    }
    // A palette is a few hundred big swatches (gradients included); photo textures shatter into
    // thousands of small regions.
    const bigMin = w * h * 0.0012;
    const big = sums.filter((v) => v[3] >= bigMin);
    if (big.length <= 256 && big.reduce((acc, v) => acc + v[3], 0) >= w * h * 0.8) {
      result = { width: w, height: h, region, colors: sums.map((s) => [s[0] / s[3] / 255, s[1] / s[3] / 255, s[2] / s[3] / 255]) };
    }
  } catch {
    result = null;
  }
  paletteCache.set(img, result);
  return result;
}

/** Per-triangle swatch region, its colour and centroid; null unless the mesh uses a palette atlas. */
function sampleTriangles(mesh: THREE.Mesh, toModel: THREE.Matrix4): TriInfo[] | null {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const map = (mat as THREE.MeshStandardMaterial).map;
  const geo = mesh.geometry;
  const uv = geo.getAttribute('uv');
  if (!map || !uv) return null;
  const pal = paletteOf(map);
  if (!pal) return null;
  map.updateMatrix();
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const out: TriInfo[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const t = new THREE.Vector2();
  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    t.set((uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3, (uv.getY(ia) + uv.getY(ib) + uv.getY(ic)) / 3);
    t.applyMatrix3(map.matrix);
    // glTF textures aren't flipped: v = 0 is the top row.
    const x = Math.min(pal.width - 1, Math.max(0, Math.floor((((t.x % 1) + 1) % 1) * pal.width)));
    const y = Math.min(pal.height - 1, Math.max(0, Math.floor((((t.y % 1) + 1) % 1) * pal.height)));
    const region = Math.max(0, pal.region[y * pal.width + x]);
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    const centroid = a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(toModel).clone();
    out.push({ region, color: pal.colors[region], centroid });
  }
  return out;
}

/** Name of the mesh, its ancestors, and (for synthetic split meshes) the original chain. */
const chainOverride = new WeakMap<THREE.Object3D, string>();
function nameChain(obj: THREE.Object3D, stop: THREE.Object3D): string {
  const o = chainOverride.get(obj);
  if (o !== undefined) return o;
  const names: string[] = [];
  for (let p: THREE.Object3D | null = obj; p && p !== stop; p = p.parent) names.push(p.name);
  return names.join(' ');
}

/** Class implied by names, or null when the names say nothing useful. */
function classifyByName(name: string): PartClass | null {
  const n = name.toLowerCase();
  if (/interior|cabin|seat|dash|steering|pedal|carpet|leather|gauge|speedo/.test(n)) return 'keep';
  // Lamp lenses are often named "*_glass", so lights are matched before glass.
  if (/(?<!de|re)tail|brake_?light|rear_?light|stop_?l|lights_red|red_?lights?|backlight|reverse/.test(n)) return 'tail';
  if (/head(?!rest|liner)|(?<!high)light|lamp|\bleds?\b|leds|projector|drl|fog/.test(n)) return 'head';
  // Rubber around the glass must not become glass (or body paint, via a "body" parent).
  if (/(win|window|glass|screen)[_\s.-]?(frame|seal|rubber|gasket|molding|trim)/.test(n)) return 'trim';
  if (/glass|window|windshield|windscreen|(^|[_\s.-])win([_\s.-]|$)/.test(n)) return 'glass';
  if (/chrome/.test(n)) return 'chrome';
  if (/gr[il]l/.test(n)) return 'trim';
  if (/tire|tyre|rubber/.test(n)) return 'tire';
  if (/\brim|rim_|wheel|\bdisc|hubcap/.test(n)) return 'rim';
  if (/paint|body|carpaint|car_paint|colou?r|exterior|\bshell/.test(n) && !/under|chassis|frame/.test(n)) return 'paint';
  if (/plate|licen[cs]e/.test(n)) return 'keep';
  return null;
}

const BADGE_RE = /logo|badge|emblem|lettering|decal|brand/i;

/**
 * The material name wins over node names: materials are shared (body paint is
 * often reused on interior panels), so a node called "Interior…" must not
 * decide what the shared paint becomes.
 */
function nameClass(mat: THREE.Material, chain: string): PartClass | null {
  return classifyByName(mat.name) ?? classifyByName(chain);
}

const isTransparent = (mat: THREE.Material) => {
  const p = mat as THREE.MeshPhysicalMaterial;
  return (p.transmission ?? 0) > 0.05 || (mat.transparent && mat.opacity < 0.9);
};

/** Class of one material slot: names first, then transparency (windows, lamp covers). */
function slotClassOf(mat: THREE.Material, chain: string): PartClass | null {
  const byMat = classifyByName(mat.name);
  const cls = byMat ?? classifyByName(chain);
  if (!isTransparent(mat)) return cls;
  if (cls === 'head') return 'lens';
  if (cls === 'tail') return 'taillens';
  // A "body" parent must not turn a transparent pane into paint.
  if (cls !== null && !(cls === 'paint' && byMat === null)) return cls;
  const c = (mat as THREE.MeshStandardMaterial).color;
  if (!c) return 'glass';
  const mx = Math.max(c.r, c.g, c.b);
  const saturated = mx > 0.2 && (mx - Math.min(c.r, c.g, c.b)) / mx > 0.55;
  if (saturated && c.r > c.g * 2 && c.r > c.b * 2) return 'taillens';
  return saturated ? 'keep' : 'glass';
}
const GROUND_RE = /shadow|ground|floor|backdrop|\bplane\b|platform|stage/i;

function materialsOf(m: THREE.Mesh): THREE.Material[] {
  return Array.isArray(m.material) ? m.material : [m.material];
}

/** Splits one mesh holding several wheels into per-quadrant meshes. */
function splitByQuadrant(m: THREE.Mesh, toModel: THREE.Matrix4, cx: number, cz: number, chain: string): THREE.Mesh[] {
  const geo = m.geometry;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const out = new Map<number, { idx: number[]; groups: { start: number; count: number; materialIndex: number }[] }>();
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const g of groups) {
    const per = new Map<number, number[]>();
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
      c.set(0, 0, 0);
      const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
      for (const id of ids) c.add(v.fromBufferAttribute(pos, id));
      c.multiplyScalar(1 / 3).applyMatrix4(toModel);
      const q = (c.x > cx ? 1 : 0) + (c.z > cz ? 2 : 0);
      let list = per.get(q);
      if (!list) per.set(q, (list = []));
      list.push(...ids);
    }
    for (const [q, list] of per) {
      let entry = out.get(q);
      if (!entry) out.set(q, (entry = { idx: [], groups: [] }));
      entry.groups.push({ start: entry.idx.length, count: list.length, materialIndex: g.materialIndex ?? 0 });
      entry.idx.push(...list);
    }
  }
  return [...out.values()].map(({ idx, groups: gs }) => {
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) sub.setAttribute(name, attr);
    sub.setIndex(idx);
    if (geo.groups.length) gs.forEach((g) => sub.addGroup(g.start, g.count, g.materialIndex));
    const mesh = new THREE.Mesh(sub, m.material);
    mesh.name = m.name;
    chainOverride.set(mesh, chain);
    return mesh;
  });
}

/** Marks synthetic wheel meshes cut out of a body mesh (their materials are kept as authored). */
const GEOM_WHEEL = '#geomwheel';

const boxCache = new WeakMap<THREE.BufferGeometry, THREE.Box3>();

/**
 * Bounds of the vertices actually referenced by the index. Split meshes share
 * their parent's vertex buffer, so `computeBoundingBox()` would return the
 * whole car for every wheel.
 */
function geomBox(geo: THREE.BufferGeometry): THREE.Box3 {
  let b = boxCache.get(geo);
  if (b) return b;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  b = new THREE.Box3();
  if (index) {
    const v = new THREE.Vector3();
    for (let i = 0; i < index.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, index.getX(i)));
  } else {
    b.setFromBufferAttribute(pos as THREE.BufferAttribute);
  }
  boxCache.set(geo, b);
  geo.boundingBox = b.clone();
  return b;
}

function reorient(list: TriInfo[] | null, orient: THREE.Matrix4): TriInfo[] | null {
  list?.forEach((t) => t.centroid.applyMatrix4(orient));
  return list;
}

/** Splits a mesh by a per-triangle key (-1 = drop), keeping material groups. Shares vertex buffers. */
function partitionMesh(m: THREE.Mesh, keyOf: (tri: number) => number): Map<number, THREE.Mesh> {
  const geo = m.geometry;
  const index = geo.getIndex();
  const triCount = (index ? index.count : geo.getAttribute('position').count) / 3;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: triCount * 3, materialIndex: 0 }];
  const out = new Map<number, { idx: number[]; groups: { start: number; count: number; materialIndex: number }[] }>();
  for (const g of groups) {
    const per = new Map<number, number[]>();
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) {
      const k = keyOf(t);
      let list = per.get(k);
      if (!list) per.set(k, (list = []));
      for (let j = 0; j < 3; j++) list.push(index ? index.getX(t * 3 + j) : t * 3 + j);
    }
    for (const [k, list] of per) {
      let e = out.get(k);
      if (!e) out.set(k, (e = { idx: [], groups: [] }));
      e.groups.push({ start: e.idx.length, count: list.length, materialIndex: g.materialIndex ?? 0 });
      e.idx.push(...list);
    }
  }
  const meshes = new Map<number, THREE.Mesh>();
  for (const [k, { idx, groups: gs }] of out) {
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) sub.setAttribute(name, attr);
    sub.setIndex(idx);
    if (geo.groups.length) gs.forEach((g) => sub.addGroup(g.start, g.count, g.materialIndex));
    const mesh = new THREE.Mesh(sub, m.material);
    mesh.name = m.name;
    meshes.set(k, mesh);
  }
  return meshes;
}

interface Component {
  mesh: THREE.Mesh;
  tris: number[];
  box: THREE.Box3;
}

/** Connected triangle islands of a mesh (vertices welded by position), with model-space bounds. */
function components(m: THREE.Mesh, toModel: THREE.Matrix4): Component[] {
  const geo = m.geometry;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const triCount = (index ? index.count : pos.count) / 3;
  if (triCount > 400_000) return [];
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const q = Math.max(size.x, size.y, size.z) * 1e-5 || 1e-6;
  const ids = new Map<string, number>();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) / q)},${Math.round(pos.getY(i) / q)},${Math.round(pos.getZ(i) / q)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    vid[i] = id;
  }
  const parent = new Int32Array(ids.size).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  const vert = (t: number, j: number) => vid[index ? index.getX(t * 3 + j) : t * 3 + j];
  for (let t = 0; t < triCount; t++) {
    const a = find(vert(t, 0));
    parent[find(vert(t, 1))] = a;
    parent[find(vert(t, 2))] = a;
  }
  const byRoot = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const r = find(vert(t, 0));
    let list = byRoot.get(r);
    if (!list) byRoot.set(r, (list = []));
    list.push(t);
  }
  const v = new THREE.Vector3();
  const out: Component[] = [];
  for (const tris of byRoot.values()) {
    if (tris.length < 4) continue;
    const box = new THREE.Box3();
    for (const t of tris) {
      for (let j = 0; j < 3; j++) box.expandByPoint(v.fromBufferAttribute(pos, index ? index.getX(t * 3 + j) : t * 3 + j).applyMatrix4(toModel));
    }
    out.push({ mesh: m, tris, box });
  }
  return out;
}

/**
 * Finds four wheels baked into body meshes: per corner, the largest round
 * island touching the ground is the tyre; islands inside its disc (rim, hub,
 * brake) join it. Returns null unless all four corners agree.
 */
function extractWheelsByGeometry(
  bodyMeshes: THREE.Mesh[],
  model: Map<THREE.Mesh, THREE.Matrix4>,
  preBox: THREE.Box3,
): { replaced: Map<THREE.Mesh, THREE.Mesh | null>; wheels: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[][] } | null {
  const P = preBox.getSize(new THREE.Vector3());
  const Pc = preBox.getCenter(new THREE.Vector3());
  const all: Component[] = bodyMeshes.flatMap((m) => components(m, model.get(m)!));
  const quad = (c: THREE.Vector3) => (c.x > Pc.x ? 1 : 0) + (c.z > Pc.z ? 2 : 0);
  const cand = all.filter((k) => {
    const c = k.box.getCenter(new THREE.Vector3());
    const s = k.box.getSize(new THREE.Vector3());
    return Math.abs(c.x - Pc.x) > 0.22 * P.x && Math.abs(c.z - Pc.z) > 0.18 * P.z && c.y < preBox.min.y + 0.42 * P.y && s.y < 0.6 * P.y && s.x < 0.3 * P.x;
  });

  const anchors: (Component | null)[] = [null, null, null, null];
  for (const k of cand) {
    const s = k.box.getSize(new THREE.Vector3());
    const round = s.y / s.z > 0.75 && s.y / s.z < 1.33;
    const grounded = k.box.min.y < preBox.min.y + 0.08 * P.y;
    if (!round || !grounded || s.y < 0.18 * P.y) continue;
    const q = quad(k.box.getCenter(new THREE.Vector3()));
    const cur = anchors[q];
    if (!cur || s.y > cur.box.max.y - cur.box.min.y) anchors[q] = k;
  }
  if (anchors.some((a) => !a)) return null;
  const radii = anchors.map((a) => (a!.box.max.y - a!.box.min.y) / 2);
  const rMed = [...radii].sort((a, b) => a - b)[1];
  if (radii.some((r) => Math.abs(r - rMed) > 0.25 * rMed)) return null;

  // Assign islands to wheel quadrants.
  const assign = new Map<THREE.Mesh, Map<number, number>>();
  const mark = (k: Component, q: number) => {
    let per = assign.get(k.mesh);
    if (!per) assign.set(k.mesh, (per = new Map()));
    for (const t of k.tris) per.set(t, q);
  };
  anchors.forEach((a, q) => {
    const C = a!.box.getCenter(new THREE.Vector3());
    const R = radii[q] * 1.08;
    const halfW = Math.max((a!.box.max.x - a!.box.min.x) / 2, 0.06 * P.x);
    for (const k of cand) {
      if (k === a || quad(k.box.getCenter(new THREE.Vector3())) !== q) continue;
      const b = k.box;
      const inside = b.min.y >= C.y - R && b.max.y <= C.y + R && b.min.z >= C.z - R && b.max.z <= C.z + R;
      if (inside && Math.abs((b.min.x + b.max.x) / 2 - C.x) < halfW * 1.6) mark(k, q);
    }
    mark(a!, q);
  });

  const replaced = new Map<THREE.Mesh, THREE.Mesh | null>();
  const wheels: { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[][] = [[], [], [], []];
  for (const [src, per] of assign) {
    const parts = partitionMesh(src, (t) => per.get(t) ?? -1);
    const chain = `${chainOverride.get(src) ?? src.name} ${GEOM_WHEEL}`;
    for (const [k, mesh] of parts) {
      if (k < 0) continue;
      chainOverride.set(mesh, chain);
      wheels[k].push({ mesh, matrix: model.get(src)! });
    }
    replaced.set(src, parts.get(-1) ?? null);
  }
  return { replaced, wheels };
}

function triangleArea(
  geo: THREE.BufferGeometry,
  toModel: THREE.Matrix4,
  start: number,
  count: number,
  out: { area: number; yMax: number; yMin: number },
  /** Area counts only triangles that pass (centroid, normal), e.g. the outward-facing outer skin. */
  accept?: (centroid: THREE.Vector3, normal: THREE.Vector3) => boolean,
): void {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ctr = new THREE.Vector3();
  const step = Math.max(1, Math.floor(count / 3 / 4000)); // sample big meshes
  for (let t = start / 3; t < (start + count) / 3; t += step) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(toModel);
    b.fromBufferAttribute(pos, ib).applyMatrix4(toModel);
    c.fromBufferAttribute(pos, ic).applyMatrix4(toModel);
    out.yMax = Math.max(out.yMax, a.y, b.y, c.y);
    out.yMin = Math.min(out.yMin, a.y, b.y, c.y);
    n.subVectors(b, a).cross(ctr.subVectors(c, a));
    if (accept && !accept(ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3), n)) continue;
    out.area += n.length() * 0.5 * step;
  }
}

/**
 * Fills window openings that have no glass (AI-generated bodies ship with holes): rasterises the
 * side-facing outer skin in (z, y), finds enclosed gaps in the upper body and fills them with panes.
 */
function autoGlaze(meshes: THREE.Mesh[], model: Map<THREE.Mesh, THREE.Matrix4>, bounds: THREE.Box3): THREE.BufferGeometry | null {
  let triTotal = 0;
  for (const m of meshes) triTotal += (m.geometry.getIndex()?.count ?? m.geometry.getAttribute('position').count) / 3;
  if (triTotal > 60_000) return null;
  const size = bounds.getSize(new THREE.Vector3());
  const cell = size.z / 160;
  const W = Math.ceil(size.z / cell) + 2;
  const H = Math.ceil(size.y / cell) + 2;
  const z0 = bounds.min.z - cell;
  const y0 = bounds.min.y - cell;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const N = new THREE.Vector3();
  for (const side of [1, -1]) {
    const cov = new Uint8Array(W * H);
    const xs = new Float32Array(W * H);
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position');
      const index = m.geometry.getIndex();
      const toModel = model.get(m)!;
      const n = (index ? index.count : pos.count) / 3;
      for (let t = 0; t < n; t++) {
        A.fromBufferAttribute(pos, index ? index.getX(t * 3) : t * 3).applyMatrix4(toModel);
        B.fromBufferAttribute(pos, index ? index.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(toModel);
        C.fromBufferAttribute(pos, index ? index.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(toModel);
        // Outer skin only: seats and dashboards sit well inside the door line.
        if (((A.x + B.x + C.x) / 3 - cx) * side < 0.55 * (size.x / 2)) continue;
        N.subVectors(B, A).cross(C.clone().sub(A)).normalize();
        if (Math.abs(N.x) < 0.2) continue;
        const d = (B.y - C.y) * (A.z - C.z) + (C.z - B.z) * (A.y - C.y);
        if (Math.abs(d) < 1e-12) continue;
        const zi0 = Math.max(0, Math.floor((Math.min(A.z, B.z, C.z) - z0) / cell));
        const zi1 = Math.min(W - 1, Math.ceil((Math.max(A.z, B.z, C.z) - z0) / cell));
        const yi0 = Math.max(0, Math.floor((Math.min(A.y, B.y, C.y) - y0) / cell));
        const yi1 = Math.min(H - 1, Math.ceil((Math.max(A.y, B.y, C.y) - y0) / cell));
        for (let yi = yi0; yi <= yi1; yi++) {
          for (let zi = zi0; zi <= zi1; zi++) {
            const pz = z0 + (zi + 0.5) * cell;
            const py = y0 + (yi + 0.5) * cell;
            const l1 = ((B.y - C.y) * (pz - C.z) + (C.z - B.z) * (py - C.y)) / d;
            const l2 = ((C.y - A.y) * (pz - C.z) + (A.z - C.z) * (py - C.y)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
            const x = Math.abs(l1 * A.x + l2 * B.x + l3 * C.x - cx);
            if (!cov[yi * W + zi] || x > xs[yi * W + zi]) xs[yi * W + zi] = x;
            cov[yi * W + zi] = 1;
          }
        }
      }
    }
    // Everything not reachable from the border is enclosed.
    const outside = new Uint8Array(W * H);
    const stack: number[] = [0];
    while (stack.length) {
      const q = stack.pop()!;
      if (cov[q] || outside[q]) continue;
      outside[q] = 1;
      const x = q % W;
      const y = (q / W) | 0;
      if (x > 0) stack.push(q - 1);
      if (x < W - 1) stack.push(q + 1);
      if (y > 0) stack.push(q - W);
      if (y < H - 1) stack.push(q + W);
    }
    const seen = new Uint8Array(W * H);
    for (let start = 0; start < W * H; start++) {
      if (cov[start] || outside[start] || seen[start]) continue;
      const cells: number[] = [];
      const st = [start];
      seen[start] = 1;
      while (st.length) {
        const q = st.pop()!;
        cells.push(q);
        const x = q % W;
        const y = (q / W) | 0;
        for (const r of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1]) {
          if (r >= 0 && !cov[r] && !outside[r] && !seen[r]) {
            seen[r] = 1;
            st.push(r);
          }
        }
      }
      const yMean = y0 + (cells.reduce((acc, q) => acc + ((q / W) | 0), 0) / cells.length + 0.5) * cell;
      if (cells.length < 40 || yMean < bounds.min.y + 0.5 * size.y) continue;
      // Row runs become quads set just inside the frame.
      const inCell = new Set(cells);
      for (const q of cells) {
        if (inCell.has(q - 1) && (q - 1) % W !== W - 1) continue;
        let e = q;
        while (inCell.has(e + 1) && (e + 1) % W !== 0) e++;
        const yi = (q / W) | 0;
        const left = xs[q - 1];
        const right = xs[e + 1];
        const x = cx + side * (Math.min(left || right, right || left) - 0.012 * size.x);
        const za = z0 + (q % W) * cell;
        const zb = z0 + ((e % W) + 1) * cell;
        const ya = y0 + yi * cell;
        const yb = ya + cell;
        const quad = side > 0 ? [[za, ya], [zb, yb], [zb, ya], [za, ya], [za, yb], [zb, yb]] : [[za, ya], [zb, ya], [zb, yb], [za, ya], [zb, yb], [za, yb]];
        for (const [z, y] of quad) {
          positions.push(x, y, z);
          normals.push(side, 0, 0);
        }
      }
    }
  }
  if (!positions.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

/** Clean tyre, dished rim and hub cap for wheels that are only a lumpy blob in the source. */
function proceduralWheel(radius: number, halfWidth: number, outward: number): PartTemplate[] {
  const R = radius;
  const w = halfWidth;
  const lathe = (pts: [number, number][]) => {
    // (r, along-axis) pairs; mirrored for the left side with the winding kept.
    let list = pts.map(([r, a]) => new THREE.Vector2(r * R, a * w * outward));
    if (outward > 0) list = list.reverse();
    const g = new THREE.LatheGeometry(list, 28);
    g.rotateZ(-Math.PI / 2);
    return g;
  };
  const tyre = lathe([[0.6, -0.8], [0.78, -0.98], [0.93, -0.96], [0.99, -0.74], [1, -0.35], [1, 0.35], [0.99, 0.74], [0.93, 0.96], [0.78, 0.98], [0.6, 0.8]]);
  const rim = lathe([[0.04, 0.58], [0.24, 0.62], [0.3, 0.52], [0.5, 0.56], [0.62, 0.7], [0.66, 0.9], [0.62, 0.9]]);
  const cap = lathe([[0, 0.7], [0.1, 0.68], [0.17, 0.62]]);
  const part = (geometry: THREE.BufferGeometry, cls: PartClass): PartTemplate => ({
    geometry,
    matrix: new THREE.Matrix4(),
    classes: [cls],
    originals: [],
    label: 'procedural wheel',
  });
  return [part(tyre, 'tire'), part(rim, 'rim'), part(cap, 'chrome')];
}

/** Material slot of every triangle. */
function triangleSlots(geo: THREE.BufferGeometry): Uint16Array {
  const index = geo.getIndex();
  const tris = (index ? index.count : geo.getAttribute('position').count) / 3;
  const out = new Uint16Array(tris);
  for (const g of geo.groups) out.fill(g.materialIndex ?? 0, g.start / 3, (g.start + g.count) / 3);
  return out;
}

function usedSlots(geo: THREE.BufferGeometry): Set<number> {
  return new Set(geo.groups.length ? geo.groups.filter((g) => g.count > 0).map((g) => g.materialIndex ?? 0) : [0]);
}

/**
 * Front-projected UVs for lamp surfaces, normalised to the lamp's own bounds so one painted
 * reflector texture fits any lamp. u runs from the car's centre line outwards.
 */
function lampUV(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, slots: Set<number>, centreX: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const used = new Set<number>();
  const gs = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const g of gs) {
    if (!slots.has(g.materialIndex ?? 0)) continue;
    for (let i = g.start; i < g.start + g.count; i++) used.add(index ? index.getX(i) : i);
  }
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  for (const id of used) box.expandByPoint(v.fromBufferAttribute(pos, id).applyMatrix4(matrix));
  const outward = (box.min.x + box.max.x) / 2 >= centreX;
  const w = Math.max(1e-6, box.max.x - box.min.x);
  const h = Math.max(1e-6, box.max.y - box.min.y);
  const uv = new Float32Array(pos.count * 2);
  const old = geo.getAttribute('uv');
  if (old) for (let i = 0; i < pos.count; i++) uv.set([old.getX(i), old.getY(i)], i * 2);
  for (const id of used) {
    v.fromBufferAttribute(pos, id).applyMatrix4(matrix);
    uv[id * 2] = outward ? (v.x - box.min.x) / w : (box.max.x - v.x) / w;
    uv[id * 2 + 1] = (v.y - box.min.y) / h;
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr);
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(index);
  geo.groups.forEach((g) => out.addGroup(g.start, g.count, g.materialIndex));
  return out;
}

const rawCache = new WeakMap<object, ImageData | null>();

/** Texture pixels (downscaled to ≤256 px), for colour sampling only. */
function texturePixels(tex: THREE.Texture): ImageData | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  if (rawCache.has(img)) return rawCache.get(img)!;
  let data: ImageData | null = null;
  try {
    const w = Math.min(img.width, 256);
    const h = Math.min(img.height, 256);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    data = g.getImageData(0, 0, w, h);
  } catch {
    data = null;
  }
  rawCache.set(img, data);
  return data;
}

/**
 * +1 if red surfaces (tail lamps) cluster at the +axis end, -1 at the -axis
 * end, 0 if unclear. Per material: a material that is red at both ends (red
 * paint, side markers) cancels out; only lopsided ones vote.
 */
function redEndVote(meshes: THREE.Mesh[], along: (v: THREE.Vector3) => number, halfLength: number): number {
  const perMat = new Map<THREE.Material, { plus: number; minus: number }>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const col = new THREE.Color();
  for (const m of meshes) {
    const geo = m.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const index = geo.getIndex();
    const mats = materialsOf(m);
    const gs = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    for (const g of gs) {
      const mat = (mats[g.materialIndex ?? 0] ?? mats[0]) as THREE.MeshStandardMaterial;
      if (!mat.color) continue;
      const px = mat.map && uv ? texturePixels(mat.map) : null;
      const tris = g.count / 3;
      const step = Math.max(1, Math.floor(tris / 3000));
      for (let t = g.start / 3; t < (g.start + g.count) / 3; t += step) {
        const ia = index ? index.getX(t * 3) : t * 3;
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, ia);
        b.fromBufferAttribute(pos, ib);
        c.fromBufferAttribute(pos, ic);
        const centre = a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(m.matrixWorld);
        const d = along(centre);
        if (Math.abs(d) < halfLength * 0.84) continue;
        col.copy(mat.color);
        if (px && uv) {
          const u = (uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3;
          const v = (uv.getY(ia) + uv.getY(ib) + uv.getY(ic)) / 3;
          const x = Math.min(px.width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * px.width)));
          const y = Math.min(px.height - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * px.height)));
          const p = (y * px.width + x) * 4;
          col.r *= px.data[p] / 255;
          col.g *= px.data[p + 1] / 255;
          col.b *= px.data[p + 2] / 255;
        }
        if (col.r > 0.3 && col.g < col.r * 0.45 && col.b < col.r * 0.45) {
          const e = perMat.get(mat) ?? { plus: 0, minus: 0 };
          if (d > 0) e.plus += step;
          else e.minus += step;
          perMat.set(mat, e);
        }
      }
    }
  }
  let vote = 0;
  for (const { plus, minus } of perMat.values()) {
    if (plus + minus < 4) continue;
    if (plus > minus * 3) vote += 1;
    else if (minus > plus * 3) vote -= 1;
  }
  return Math.sign(vote);
}

function analyse(scene: THREE.Object3D, opts: { hideBadges: boolean; flip: boolean }): Template {
  scene.updateMatrixWorld(true);
  let meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh);
  });
  // Showroom floors and baked shadow planes would wreck the bounding box.
  meshes = meshes.filter((m) => {
    const b = new THREE.Box3().setFromObject(m);
    const s = b.getSize(new THREE.Vector3());
    const flat = s.y < 0.02 * Math.max(s.x, s.z);
    return !(flat && GROUND_RE.test(`${nameChain(m, scene)} ${materialsOf(m).map((x) => x.name).join(' ')}`));
  });
  if (opts.hideBadges) meshes = meshes.filter((m) => !BADGE_RE.test(`${nameChain(m, scene)} ${materialsOf(m).map((x) => x.name).join(' ')}`));
  if (!meshes.length) throw new Error('model has no meshes');

  // Single-material colour-atlas models (Kenney, many low-poly kits) are
  // classified per triangle from the texture; everything else by names.
  const materialCount = new Set(meshes.flatMap(materialsOf)).size;
  const usePalette = materialCount <= 2;

  // --- Orientation: long horizontal axis, front decided by lights.
  const rawBox = new THREE.Box3();
  meshes.forEach((m) => rawBox.expandByObject(m));
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const rawCenter = rawBox.getCenter(new THREE.Vector3());
  const longX = rawSize.x > rawSize.z;
  const along = (v: THREE.Vector3) => (longX ? v.x - rawCenter.x : v.z - rawCenter.z);

  const tris = new Map<THREE.Mesh, TriInfo[] | null>();
  for (const m of meshes) tris.set(m, usePalette ? sampleTriangles(m, m.matrixWorld) : null);

  let rearScore = 0;
  for (const m of meshes) {
    const centre = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    for (const mat of materialsOf(m)) {
      const cls = nameClass(mat, nameChain(m, scene));
      if (cls === 'tail') rearScore += Math.sign(along(centre));
      if (cls === 'head') rearScore -= Math.sign(along(centre));
    }
    for (const t of tris.get(m) ?? []) {
      if (RED(t.color) && Math.abs(along(t.centroid)) > 0.4 * (longX ? rawSize.x : rawSize.z)) rearScore += Math.sign(along(t.centroid)) * 0.05;
    }
  }
  // Names are often missing or misleading, so red surfaces at one end of the car
  // (tail lamps, from material colours or textures) get a stronger vote.
  rearScore += 2 * redEndVote(meshes, along, (longX ? rawSize.x : rawSize.z) / 2);
  // glTF convention is +Z forward, so with no evidence assume the rear is at -Z.
  const rearSign = (rearScore === 0 ? -1 : Math.sign(rearScore)) * (opts.flip ? -1 : 1);
  // Rotate so the front ends up at -Z (rear at +X → yaw -90°, rear at -X → +90°).
  const yaw = longX ? (rearSign > 0 ? -Math.PI / 2 : Math.PI / 2) : rearSign > 0 ? 0 : Math.PI;
  const orient = new THREE.Matrix4().makeRotationY(yaw);

  const model = new Map<THREE.Mesh, THREE.Matrix4>();
  for (const m of meshes) model.set(m, orient.clone().multiply(m.matrixWorld));
  for (const list of tris.values()) list?.forEach((t) => t.centroid.applyMatrix4(orient));

  const boxOf = (m: THREE.Mesh) => geomBox(m.geometry).clone().applyMatrix4(model.get(m)!);
  const preBox = new THREE.Box3();
  meshes.forEach((m) => preBox.union(boxOf(m)));
  const preSize = preBox.getSize(new THREE.Vector3());
  const preCentre = preBox.getCenter(new THREE.Vector3());

  // --- Wheels: name match; a mesh holding several wheels is split per quadrant.
  let wheelMeshes: THREE.Mesh[] = [];
  for (const m of meshes) {
    const chain = nameChain(m, scene);
    if (!WHEEL_RE.test(`${chain} ${materialsOf(m).map((x) => x.name).join(' ')}`) || /steering|spare/i.test(chain)) continue;
    const b = boxOf(m);
    const spansSides = b.min.x < preCentre.x - preSize.x * 0.2 && b.max.x > preCentre.x + preSize.x * 0.2;
    const spansAxles = b.max.z - b.min.z > preSize.z * 0.45;
    if (spansSides || spansAxles) {
      for (const sub of splitByQuadrant(m, model.get(m)!, preCentre.x, preCentre.z, chain)) {
        model.set(sub, model.get(m)!);
        tris.set(sub, null);
        wheelMeshes.push(sub);
      }
      meshes = meshes.filter((x) => x !== m);
      meshes.push(...wheelMeshes.filter((x) => !meshes.includes(x)));
    } else wheelMeshes.push(m);
  }
  wheelMeshes = wheelMeshes.filter((m) => meshes.includes(m));

  const clusters: { box: THREE.Box3; meshes: THREE.Mesh[] }[] = [];
  for (const m of wheelMeshes) {
    const b = boxOf(m);
    const c = b.getCenter(new THREE.Vector3());
    const hit = clusters.find((k) => {
      const kc = k.box.getCenter(new THREE.Vector3());
      const r = Math.max(k.box.max.y - k.box.min.y, b.max.y - b.min.y) * 0.5;
      return Math.hypot(kc.y - c.y, kc.z - c.z) < r && Math.abs(kc.x - c.x) < r * 1.2;
    });
    if (hit) {
      hit.box.union(b);
      hit.meshes.push(m);
    } else clusters.push({ box: b, meshes: [m] });
  }

  const bodyMeshes = meshes.filter((m) => !wheelMeshes.includes(m));
  const bodyBox = new THREE.Box3();
  bodyMeshes.forEach((m) => bodyBox.union(boxOf(m)));
  const bodyWidth = bodyBox.max.x - bodyBox.min.x;
  // Wheel units sit off-centre, are roughly round and touch the bottom of the car.
  const wheelUnits = clusters.filter((k) => {
    const s = k.box.getSize(new THREE.Vector3());
    const off = Math.abs(k.box.getCenter(new THREE.Vector3()).x - (bodyBox.min.x + bodyBox.max.x) / 2) > bodyWidth * 0.2;
    const round = s.y > 0.5 * s.z && s.y < 2 * s.z;
    return off && round && k.box.min.y < preBox.min.y + preSize.y * 0.15;
  });
  for (const k of clusters) if (!wheelUnits.includes(k)) bodyMeshes.push(...k.meshes);
  if (wheelUnits.length < 2) bodyMeshes.push(...wheelUnits.splice(0).flatMap((k) => k.meshes));

  // No named wheels: many exports bake the wheels into the body mesh. Cut them
  // out geometrically so they can still spin and steer.
  if (wheelUnits.length < 2) {
    const found = extractWheelsByGeometry(bodyMeshes, model, preBox);
    if (found) {
      for (const [src, rest] of found.replaced) {
        const i = bodyMeshes.indexOf(src);
        if (rest) bodyMeshes.splice(i, 1, rest);
        else bodyMeshes.splice(i, 1);
        meshes = meshes.filter((x) => x !== src);
        if (rest) {
          model.set(rest, model.get(src)!);
          meshes.push(rest);
          const list = tris.get(src);
          tris.set(rest, list ? reorient(sampleTriangles(rest, src.matrixWorld), orient) : null);
        }
      }
      for (const unit of found.wheels) {
        for (const w of unit) {
          model.set(w.mesh, w.matrix);
          tris.set(w.mesh, null);
          meshes.push(w.mesh);
        }
        const box = new THREE.Box3();
        unit.forEach((w) => box.union(boxOf(w.mesh)));
        wheelUnits.push({ box, meshes: unit.map((w) => w.mesh) });
      }
    }
  }

  const fullBox = new THREE.Box3();
  meshes.forEach((m) => fullBox.union(boxOf(m)));
  const bodyOnly = new THREE.Box3();
  bodyMeshes.forEach((m) => bodyOnly.union(boxOf(m)));
  const H = bodyOnly.max.y - bodyOnly.min.y;
  const halfL = (bodyOnly.max.z - bodyOnly.min.z) / 2;
  const midZ = (bodyOnly.max.z + bodyOnly.min.z) / 2;
  const yRel = (y: number) => (y - bodyOnly.min.y) / H;

  let liveryColor: THREE.Color | null = null;
  const headCentres: THREE.Vector3[] = [];

  // --- Palette statistics across all body meshes, so separate parts (spoiler,
  // mirrors) sharing the body's paint swatch are classified the same way.
  type Group = { n: number; color: number[]; ySum: number; yMax: number; zSum: number };
  const groups = new Map<number, Group>();
  for (const m of bodyMeshes) {
    for (const t of tris.get(m) ?? []) {
      const g = groups.get(t.region) ?? { n: 0, color: t.color, ySum: 0, yMax: -Infinity, zSum: 0 };
      g.n++;
      g.ySum += t.centroid.y;
      g.yMax = Math.max(g.yMax, t.centroid.y);
      g.zSum += t.centroid.z;
      groups.set(t.region, g);
    }
  }
  const regionClass = new Map<number, PartClass>();
  for (const [k, g] of groups) {
    if (lum(g.color) > 0.72 && g.color[2] >= g.color[0] - 0.02 && sat(g.color) < 0.35 && yRel(g.ySum / g.n) > 0.5) regionClass.set(k, 'glass');
  }
  // Paint: the biggest surface that reaches the roof.
  let paintKey = -1;
  let best = 0;
  for (const [k, g] of groups) {
    if (regionClass.has(k) || yRel(g.yMax) < 0.8 || lum(g.color) < 0.12) continue;
    if (g.n > best) {
      best = g.n;
      paintKey = k;
    }
  }
  if (paintKey >= 0) {
    regionClass.set(paintKey, 'paint');
    const c = groups.get(paintKey)!.color;
    liveryColor = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    // Gradient swatches span several regions: shades of the body colour are body.
    for (const [k, g] of groups) if (!regionClass.has(k) && sameShade(g.color, c)) regionClass.set(k, 'paint');
  }
  let totalTris = 0;
  for (const g of groups.values()) totalTris += g.n;
  for (const [k, g] of groups) {
    if (regionClass.has(k)) continue;
    const zRel = (g.zSum / g.n - midZ) / halfL;
    const headLike = YELLOW(g.color) || (lum(g.color) > 0.9 && g.color[2] < g.color[0] + 0.03 && yRel(g.ySum / g.n) > 0.35);
    if (headLike && zRel < -0.75) regionClass.set(k, 'head');
    else if ((RED(g.color) || (g.color[0] > 0.8 && g.color[1] < 0.6 && g.color[2] < 0.35)) && zRel > 0.75) regionClass.set(k, 'tail');
    else if (lum(g.color) < 0.3) regionClass.set(k, 'trim');
    // Small bright parts low on the body are number plates.
    else if (lum(g.color) > 0.72) regionClass.set(k, 'plate');
    // A big mid-tone panel group is the lower body/bumpers: body-coloured on a modern sedan.
    else if (g.n > totalTris * 0.2) regionClass.set(k, 'paint');
    else regionClass.set(k, 'plastic');
  }

  // --- Name-based classification per mesh slot (never per material: exporters reuse one
  // material across unrelated parts, e.g. a lamp's metal also lining the arches), with a
  // paint guess when no name says "paint".
  const slotClass = new Map<THREE.Mesh, (PartClass | null)[]>();
  for (const m of bodyMeshes) {
    if (tris.get(m)) continue;
    const chain = nameChain(m, scene);
    slotClass.set(m, materialsOf(m).map((mat) => slotClassOf(mat, chain)));
  }
  const paintMats = new Set<THREE.Material>();
  if (![...slotClass.values()].flat().includes('paint')) {
    // Score unnamed, untextured materials by their outward-facing outer skin: interior panels and
    // chassis span the same extents but carry little of it.
    const cx = (bodyOnly.min.x + bodyOnly.max.x) / 2;
    const cy = (bodyOnly.min.y + bodyOnly.max.y) / 2;
    const halfW = (bodyOnly.max.x - bodyOnly.min.x) / 2;
    const outer = (c: THREE.Vector3, n: THREE.Vector3) => {
      const dx = c.x - cx;
      const dy = c.y - cy;
      const dz = c.z - midZ;
      const d = (dx / halfW) ** 2 + (dy / (H / 2)) ** 2 + (dz / halfL) ** 2;
      return d > 0.7 && yRel(c.y) > 0.2 && n.x * dx + n.y * dy + n.z * dz > 0;
    };
    const stats = new Map<THREE.Material, { area: number; yMax: number; yMin: number }>();
    for (const m of bodyMeshes) {
      const list = slotClass.get(m);
      if (!list) continue;
      const mats = materialsOf(m);
      const gs = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: m.geometry.getIndex()?.count ?? m.geometry.getAttribute('position').count, materialIndex: 0 }];
      for (const g of gs) {
        const mat = mats[g.materialIndex ?? 0] ?? mats[0];
        if (list[g.materialIndex ?? 0] !== null) continue;
        const st = stats.get(mat) ?? { area: 0, yMax: -Infinity, yMin: Infinity };
        triangleArea(m.geometry, model.get(m)!, g.start, g.count, st, outer);
        stats.set(mat, st);
      }
    }
    let paint: THREE.Material | null = null;
    let area = 0;
    for (const [mat, st] of stats) {
      // Body panels run from the sills to the roofline.
      // Textured paint (AI scans, liveries) would lose its detail if repainted, so keep it.
      if ((mat as THREE.MeshStandardMaterial).map) continue;
      if (yRel(st.yMax) > 0.8 && yRel(st.yMin) < 0.45 && st.area > area) {
        area = st.area;
        paint = mat;
      }
    }
    if (paint) {
      paintMats.add(paint);
      // Bodies split over several materials (doors, shell, bumpers) are painted as one, but only
      // shades of the same colour: dark panes and trim share the extents, not the paint.
      const srgb = (m: THREE.Material) => {
        const c = new THREE.Color((m as THREE.MeshStandardMaterial).color ?? 0x808080).getRGB({ r: 0, g: 0, b: 0 } as THREE.RGB, THREE.SRGBColorSpace);
        return [c.r, c.g, c.b];
      };
      const base = srgb(paint);
      for (const [mat, st] of stats) {
        if (!(mat as THREE.MeshStandardMaterial).map && st.area > area * 0.5 && sameShade(srgb(mat), base)) paintMats.add(mat);
      }
    }
  }
  // Unnamed panels (doors, bumpers) sharing the body's paint material are paint too.
  for (const [m, list] of slotClass) materialsOf(m).forEach((mat, i) => list[i] === 'paint' && paintMats.add(mat));
  for (const [m, list] of slotClass) {
    materialsOf(m).forEach((mat, i) => {
      if (list[i] === null && paintMats.has(mat)) list[i] = 'paint';
    });
  }
  for (const [m, list] of slotClass) {
    const mats = materialsOf(m);
    list.forEach((cls, i) => {
      if (cls === 'paint' && !liveryColor && (mats[i] as THREE.MeshStandardMaterial).color) liveryColor = (mats[i] as THREE.MeshStandardMaterial).color.clone();
    });
  }

  // --- Lamps. One authored mesh often holds both headlights and tail lights, or both sides:
  // split those off so each lamp gets its own class (by position) and texture mapping.
  const LAMP = new Set<PartClass | null>(['head', 'tail', 'lens', 'taillens']);
  const lampZone = new Map<THREE.Mesh, 0 | 1 | 2>(); // front, rear, middle
  const bodyCx = (bodyOnly.min.x + bodyOnly.max.x) / 2;
  const bodyW = bodyOnly.max.x - bodyOnly.min.x;
  const zoneOf = (z: number): 0 | 1 | 2 => {
    const r = (z - midZ) / halfL;
    return r < -0.3 ? 0 : r > 0.3 ? 1 : 2;
  };
  const zoneClass = (c: PartClass, zone: 0 | 1 | 2): PartClass => {
    if (zone === 2) return 'keep';
    if (zone === 0) return c === 'tail' ? 'head' : c === 'taillens' ? 'lens' : c;
    return c === 'head' ? 'tail' : c === 'lens' ? 'taillens' : c;
  };
  for (let k = 0; k < bodyMeshes.length; k++) {
    const m = bodyMeshes[k];
    const list = slotClass.get(m);
    if (!list?.some((c) => LAMP.has(c))) continue;
    const b = boxOf(m);
    if (b.max.x - b.min.x < 0.3 * bodyW && b.max.z - b.min.z < 0.7 * halfL) {
      lampZone.set(m, zoneOf((b.min.z + b.max.z) / 2));
      continue;
    }
    const toModel = model.get(m)!;
    const geo = m.geometry;
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const slotOf = triangleSlots(geo);
    const v = new THREE.Vector3();
    const c = new THREE.Vector3();
    const subs = partitionMesh(m, (t) => {
      if (!LAMP.has(list[slotOf[t]])) return 100;
      c.set(0, 0, 0);
      for (let j = 0; j < 3; j++) c.add(v.fromBufferAttribute(pos, index ? index.getX(t * 3 + j) : t * 3 + j));
      c.multiplyScalar(1 / 3).applyMatrix4(toModel);
      return zoneOf(c.z) * 2 + (c.x > bodyCx ? 1 : 0);
    });
    const chain = nameChain(m, scene);
    const replacement: THREE.Mesh[] = [];
    for (const [key, sub] of subs) {
      model.set(sub, toModel);
      tris.set(sub, null);
      slotClass.set(sub, list);
      chainOverride.set(sub, chain);
      if (key < 100) lampZone.set(sub, (key >> 1) as 0 | 1 | 2);
      replacement.push(sub);
    }
    bodyMeshes.splice(k, 1, ...replacement);
    k += replacement.length - 1;
  }
  // A lamp made of many authored parts keeps them; a lone opaque blob gets a painted reflector.
  const lampSlots = [0, 0];
  for (const m of bodyMeshes) {
    const zone = lampZone.get(m);
    if (zone === undefined || zone === 2) continue;
    const used = usedSlots(m.geometry);
    slotClass.get(m)!.forEach((c, i) => {
      const z = c && used.has(i) ? zoneClass(c, zone) : null;
      if (z === 'head' || z === 'tail') lampSlots[zone]++;
    });
  }
  const lampStyle = (mat: THREE.Material, tail: boolean, detailed: boolean): PartClass => {
    const sm = mat as THREE.MeshStandardMaterial;
    const em = sm.emissive ? lum([sm.emissive.r, sm.emissive.g, sm.emissive.b]) : 0;
    const glowing = em > 0.05 || /\bleds?\b|drl|bulb|beam|xenon|neon|emissive/i.test(mat.name);
    const col = sm.color;
    const red = !!col && col.r > 0.15 && col.r > col.g * 1.8 && col.r > col.b * 1.8;
    if (tail) {
      if (glowing || (detailed && red)) return sm.map ? 'tailmap' : 'tail';
      return detailed ? 'keep' : sm.map ? 'tailmap' : 'taillamp';
    }
    if (glowing) return sm.map ? 'headmap' : 'head';
    return detailed ? 'keep' : sm.map ? 'headmap' : 'headlamp';
  };
  const interior = bodyMeshes.some((m) => /interior|seat|dash|steering|cockpit|carpet/i.test(`${nameChain(m, scene)} ${materialsOf(m).map((x) => x.name).join(' ')}`));

  const classifyPalette = (list: TriInfo[], wheel: boolean): PartClass[] =>
    wheel ? list.map((t) => (lum(t.color) < 0.3 ? 'tire' : 'rim')) : list.map((t) => regionClass.get(t.region) ?? 'plastic');

  const makePart = (m: THREE.Mesh, wheel: boolean, matrix: THREE.Matrix4, force?: PartClass): PartTemplate => {
    const originals = materialsOf(m);
    const list = tris.get(m);
    let geometry = m.geometry;
    let classes: PartClass[];
    const chain = nameChain(m, scene);
    if (list) {
      // Re-index triangles grouped by class so each class gets its own material slot.
      const perTri = classifyPalette(list, wheel);
      const heads = list.filter((_, i) => perTri[i] === 'head');
      if (heads.length) headCentres.push(heads.reduce((acc, t) => acc.add(t.centroid), new THREE.Vector3()).multiplyScalar(1 / heads.length));
      const order = [...new Set(perTri)];
      const src = geometry.getIndex();
      const idx = (i: number) => (src ? src.getX(i) : i);
      const out: number[] = [];
      geometry = geometry.clone();
      geometry.clearGroups();
      for (let slot = 0; slot < order.length; slot++) {
        const start = out.length;
        perTri.forEach((cls, tri) => {
          if (cls === order[slot]) out.push(idx(tri * 3), idx(tri * 3 + 1), idx(tri * 3 + 2));
        });
        geometry.addGroup(start, out.length - start, slot);
      }
      geometry.setIndex(out);
      classes = order;
    } else {
      const zone = lampZone.get(m);
      const proc = new Set<number>();
      classes = originals.map((mat, i) => {
        if (force) return force;
        if (wheel) {
          const c = nameClass(mat, chain.replace(GEOM_WHEEL, ''));
          if (c === 'tire') return 'tire';
          // Brakes, nuts, logos on the hub: keep the author's materials.
          if (/brake|caliper|disc|nut|bolt|logo/i.test(`${chain} ${mat.name}`)) return 'keep';
          // Wheels cut out of a body keep their authored (often textured) materials.
          return c === 'rim' || (c === null && !chain.includes(GEOM_WHEEL)) ? 'rim' : 'keep';
        }
        let c: PartClass = slotClass.get(m)?.[i] ?? 'keep';
        if (zone !== undefined && LAMP.has(c)) c = zoneClass(c, zone);
        if ((c === 'head' || c === 'tail') && zone !== undefined && zone !== 2) c = lampStyle(mat, c === 'tail', lampSlots[zone] > 6);
        if (c === 'headlamp' || c === 'taillamp') proc.add(i);
        return c;
      });
      if (proc.size) geometry = lampUV(geometry, matrix, proc, bodyCx);
      if (classes.some((c) => c === 'head' || c === 'headlamp' || c === 'headmap' || c === 'lens')) headCentres.push(boxOf(m).getCenter(new THREE.Vector3()));
    }
    return { geometry, matrix, classes, originals, label: `${chain} | ${originals.map((o) => o.name).join(",")}`, fixed: wheel && /caliper/i.test(chain) };
  };

  // Authored mirror-smooth metals (roughness ≈ 0) turn the low sun into a bloom flare.
  for (const m of new Set(meshes.flatMap(materialsOf))) {
    const sm = m as THREE.MeshStandardMaterial;
    if (!sm.isMeshStandardMaterial) continue;
    sm.roughness = Math.max(sm.roughness, sm.metalness > 0.5 ? 0.22 : 0.1);
    limitGlare(sm);
  }

  // A rig needs wheels on both axles and both sides; anything less renders them as body.
  {
    const centres = wheelUnits.map((k) => k.box.getCenter(new THREE.Vector3()));
    const zs = centres.map((c) => c.z);
    const xs = centres.map((c) => c.x);
    const L = fullBox.max.z - fullBox.min.z;
    const W = fullBox.max.x - fullBox.min.x;
    const ok =
      wheelUnits.length >= 4 && Math.max(...zs) - Math.min(...zs) > 0.35 * L && Math.max(...xs) - Math.min(...xs) > 0.4 * W;
    if (!ok && wheelUnits.length) {
      bodyMeshes.push(...wheelUnits.flatMap((k) => k.meshes));
      wheelUnits.length = 0;
    }
  }

  const body = bodyMeshes.map((m) => makePart(m, false, model.get(m)!));
  const unitHasTire = (list: THREE.Mesh[]) =>
    list.some((m) => materialsOf(m).some((mat) => nameClass(mat, nameChain(m, scene).replace(GEOM_WHEEL, '')) === 'tire'));
  const wheels: WheelTemplate[] = wheelUnits.map((k) => {
    // Hub from the tyre/rim only: calipers would skew the centre.
    const spinning = k.meshes.filter((m) => !/caliper/i.test(nameChain(m, scene)));
    const hubBox = new THREE.Box3();
    (spinning.length ? spinning : k.meshes).forEach((m) => hubBox.union(boxOf(m)));
    const hub = hubBox.getCenter(new THREE.Vector3());
    const inv = new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z);
    return {
      hub,
      radius: (hubBox.max.y - hubBox.min.y) / 2,
      halfWidth: (hubBox.max.x - hubBox.min.x) / 2,
      // Cut-out wheels of a crude AI body are lumpy blobs; detailed ones keep their own geometry.
      parts: k.meshes.some((m) => nameChain(m, scene).includes(GEOM_WHEEL)) && k.meshes.reduce((n, m) => n + (m.geometry.getIndex()?.count ?? 0) / 3, 0) < 1200
        ? proceduralWheel((hubBox.max.y - hubBox.min.y) / 2, (hubBox.max.x - hubBox.min.x) / 2, Math.sign(hub.x - bodyCx) || 1)
        : k.meshes.flatMap((m) => {
            const toHub = inv.clone().multiply(model.get(m)!);
            const named = materialsOf(m).some((mat) => nameClass(mat, nameChain(m, scene).replace(GEOM_WHEEL, '')) === 'tire');
            if (tris.get(m) || named || unitHasTire(k.meshes)) return [makePart(m, true, toHub)];
            // One mesh/texture for tyre and rim: the outer ring is rubber, the rest is the rim.
            const radius = (hubBox.max.y - hubBox.min.y) / 2;
            const pos = m.geometry.getAttribute('position');
            const index = m.geometry.getIndex();
            const v = new THREE.Vector3();
            const subs = partitionMesh(m, (t) => {
              let r = 0;
              for (let j = 0; j < 3; j++) {
                v.fromBufferAttribute(pos, index ? index.getX(t * 3 + j) : t * 3 + j).applyMatrix4(toHub);
                r += Math.hypot(v.y, v.z) / 3;
              }
              return r > 0.78 * radius ? 1 : 0;
            });
            return [...subs].map(([key, sub]) => makePart(sub, true, toHub, key === 1 ? 'tire' : 'rim'));
          }),
    };
  });

  // Models without any window glass (AI-generated bodies) get panes in their openings.
  let glazed = false;
  if (![...slotClass.values()].flat().includes('glass') && ![...regionClass.values()].includes('glass')) {
    const geo = autoGlaze(bodyMeshes, model, bodyOnly);
    if (geo) {
      body.push({ geometry: geo, matrix: new THREE.Matrix4(), classes: ['glass'], originals: [], label: 'autoglaze' });
      glazed = true;
    }
  }

  let headlight: THREE.Vector3 | null = null;
  if (headCentres.length) {
    headlight = headCentres.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / headCentres.length);
    headlight.x = (bodyOnly.min.x + bodyOnly.max.x) / 2;
  }
  return { body, wheels, box: fullBox, liveryColor, headlight, interior: interior || glazed };
}

// ---------------------------------------------------------------------------
// Instancing

const CLEAR: PartClass[] = ['glass', 'lens', 'taillens'];

function meshFor(part: PartTemplate, mats: CarMaterialSet): THREE.Mesh {
  const materials = part.classes.map((cls, i) => {
    const orig = part.originals[Math.min(i, part.originals.length - 1)];
    if (cls === 'keep') return orig;
    if (cls === 'headmap' || cls === 'tailmap') return mats.lights.lampFrom(orig, cls === 'tailmap');
    return mats.get(cls);
  });
  const mesh = new THREE.Mesh(part.geometry, materials.length === 1 && !part.geometry.groups.length ? materials[0] : materials);
  part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.userData.classes = part.classes;
  mesh.userData.label = part.label;
  // Panes must not cast opaque shadows into the cabin.
  mesh.castShadow = !part.classes.every((c) => CLEAR.includes(c));
  mesh.receiveShadow = true;
  return mesh;
}

/** Height of the body's roll/pitch pivot above the ground. */
const ROLL_CENTRE = 0.45;

function instantiate(t: Template, spec: FitSpec, source: string): VehicleModel {
  const mats = new CarMaterialSet({
    paint: spec.paint === -1 ? (t.liveryColor ?? new THREE.Color(0x888888)) : spec.paint,
    metallic: spec.metallic,
    rim: spec.rim,
    tint: spec.tint,
    interior: t.interior,
  });
  const root = new THREE.Group();
  root.name = `vehicle:${source}`;
  const body = new THREE.Group();
  const shell = new THREE.Group();
  root.add(body);
  body.add(shell);
  body.position.y = ROLL_CENTRE;

  const size = t.box.getSize(new THREE.Vector3());
  const cx = (t.box.min.x + t.box.max.x) / 2;
  const sx = spec.width / size.x;
  const sy = spec.height / size.y;
  const sz = spec.length / size.z;
  const rNew = spec.wheelDiameter / 2;
  const stance = spec.stance ?? 0;

  let axleMid = (t.box.min.z + t.box.max.z) / 2;
  let hubY0 = t.box.min.y;
  let wheelScale = 1;
  if (t.wheels.length) {
    const zs = t.wheels.map((w) => w.hub.z);
    axleMid = (Math.min(...zs) + Math.max(...zs)) / 2;
    hubY0 = t.wheels.reduce((s, w) => s + w.hub.y, 0) / t.wheels.length;
    const r0 = t.wheels.reduce((s, w) => s + w.radius, 0) / t.wheels.length;
    wheelScale = rNew / r0;
  }
  // Map the stock hub height onto the new wheel radius so arches stay around the tyres.
  const baseY = t.wheels.length ? rNew + stance - hubY0 * sy : -t.box.min.y * sy;
  shell.scale.set(sx, sy, sz);
  shell.position.set(-cx * sx, baseY - ROLL_CENTRE, -axleMid * sz);
  for (const part of t.body) shell.add(meshFor(part, mats));

  const wheels: WheelRig[] = t.wheels.map((w) => {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    const fixed = new THREE.Group();
    steer.add(spin, fixed);
    spin.scale.setScalar(wheelScale);
    fixed.scale.setScalar(wheelScale);
    const side = Math.sign(w.hub.x - cx) || 1;
    // Keep the tyre's outer face where the stock model had it (flush with the arch).
    const outer = (Math.abs(w.hub.x - cx) + w.halfWidth) * sx;
    steer.position.set(side * (outer - w.halfWidth * wheelScale), rNew, (w.hub.z - axleMid) * sz);
    for (const part of w.parts) (part.fixed ? fixed : spin).add(meshFor(part, mats));
    root.add(steer);
    return { steer, spin, front: w.hub.z < axleMid, left: side < 0, radius: rNew };
  });

  const zs = wheels.map((w) => w.steer.position.z);
  const xs = wheels.map((w) => Math.abs(w.steer.position.x));
  const head = t.headlight
    ? new THREE.Vector3(0, t.headlight.y * sy + baseY, (t.headlight.z - axleMid) * sz)
    : new THREE.Vector3(0, 0.7, -spec.length / 2);

  root.add(createContactShadow(spec.length, spec.width));
  return {
    root,
    body,
    wheels,
    materials: mats,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    wheelbase: zs.length ? Math.max(...zs) - Math.min(...zs) : spec.length * 0.6,
    track: xs.length ? 2 * Math.max(...xs) : spec.width * 0.85,
    wheelRadius: rNew,
    headlightPos: head,
    source,
    dispose: () => disposeMaterials(mats, root),
  };
}

function disposeMaterials(mats: CarMaterialSet, root: THREE.Object3D): void {
  for (const m of mats.all()) m.dispose();
  root.removeFromParent();
}

/** Last-resort body built from primitives when no model could be loaded. */
function proceduralCar(spec: FitSpec): VehicleModel {
  const mats = new CarMaterialSet({ paint: spec.paint === -1 ? 0x888888 : spec.paint, metallic: spec.metallic, rim: spec.rim, tint: spec.tint });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = ROLL_CENTRE;
  root.add(body);
  const r = spec.wheelDiameter / 2;
  const L = spec.length;
  const W = spec.width;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y - ROLL_CENTRE, z);
    m.castShadow = m.receiveShadow = true;
    body.add(m);
  };
  const lowerH = spec.height * 0.45;
  add(new THREE.BoxGeometry(W, lowerH, L), mats.paint, 0, r * 0.55 + lowerH / 2, 0);
  add(new THREE.BoxGeometry(W * 0.84, spec.height * 0.38, L * 0.5), mats.glass, 0, r * 0.55 + lowerH + spec.height * 0.19, L * 0.04);
  add(new THREE.BoxGeometry(W * 0.86, 0.04, L * 0.46), mats.paint, 0, r * 0.55 + lowerH + spec.height * 0.38, L * 0.04);
  add(new THREE.BoxGeometry(W * 0.8, 0.12, 0.05), mats.lights.head, 0, r * 0.55 + lowerH * 0.7, -L / 2 - 0.01);
  add(new THREE.BoxGeometry(W * 0.8, 0.1, 0.05), mats.lights.tail, 0, r * 0.55 + lowerH * 0.75, L / 2 + 0.01);
  const wheelGeo = new THREE.CylinderGeometry(r, r, 0.24, 24);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: WheelRig[] = [];
  const wb = L * 0.6;
  for (const front of [true, false]) {
    for (const left of [true, false]) {
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, mats.tire);
      tyre.castShadow = true;
      spin.add(tyre);
      steer.add(spin);
      steer.position.set((left ? -1 : 1) * (W / 2 - 0.14), r, front ? -wb / 2 : wb / 2);
      root.add(steer);
      wheels.push({ steer, spin, front, left, radius: r });
    }
  }
  root.add(createContactShadow(L, W));
  return {
    root,
    body,
    wheels,
    materials: mats,
    length: L,
    width: W,
    height: spec.height,
    wheelbase: wb,
    track: W - 0.28,
    wheelRadius: r,
    headlightPos: new THREE.Vector3(0, r * 0.55 + lowerH * 0.7, -L / 2),
    source: 'procedural',
    dispose: () => {
      wheelGeo.dispose();
      body.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      disposeMaterials(mats, root);
    },
  };
}
