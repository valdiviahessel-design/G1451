import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BASE_HALF_WIDTH,
  CHUNK_STEP,
  LANE_WIDTH,
  MEDIAN_SHOULDER_WIDTH,
  NOISE_PERIOD,
  SHOULDER_WIDTH,
  UV_PERIOD,
} from '../config';
import type { Materials } from '../graphics/Materials';
import type { RoadLayout } from './RoadLayout';

/**
 * Builds one road chunk [s0, s1). The chunk group sits at z = -s0 inside the
 * world root, so all vertex data stays small (float32-friendly) no matter how
 * far the player has driven.
 */
export interface RoadChunk {
  index: number;
  s0: number;
  s1: number;
  group: THREE.Group;
  /** Street-lamp emitter positions in chunk-local space. */
  lamps: THREE.Vector3[];
  dispose(): void;
}

/** Dynamic mesh data accumulator. */
class GeoBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  extra = new Map<string, { size: number; data: number[] }>();

  get count(): number {
    return this.positions.length / 3;
  }

  attr(name: string, size: number): number[] {
    let a = this.extra.get(name);
    if (!a) {
      a = { size, data: [] };
      this.extra.set(name, a);
    }
    return a.data;
  }

  /**
   * Grid of rows × cols vertices already pushed starting at `base`. Rows run
   * forward (-z), columns left→right, so the default winding faces +y.
   */
  gridIndices(base: number, rows: number, cols: number, flip = false): void {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = base + r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        if (flip) this.indices.push(a, d, b, b, d, e);
        else this.indices.push(a, b, d, b, e, d);
      }
    }
  }

  build(computeNormals = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (this.uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    for (const [name, a] of this.extra) g.setAttribute(name, new THREE.Float32BufferAttribute(a.data, a.size));
    g.setIndex(this.indices);
    if (computeNormals || !this.normals.length) g.computeVertexNormals();
    else g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const DASH = { period: 12, length: 3, width: 0.15 };
const POCKET_DASH = { period: 6, length: 3, width: 0.3 };
const EDGE_WIDTH = 0.2;
const MARK_Y = 0.006;
const LAMP_SPACING = 50;

/** Shared, never-disposed prop geometry. */
class PropGeometry {
  readonly lampPole: THREE.BufferGeometry;
  readonly lampHead: THREE.BufferGeometry;
  readonly lampLens: THREE.BufferGeometry;
  readonly guardPost: THREE.BufferGeometry;
  readonly signPole: THREE.BufferGeometry;
  readonly signFace: THREE.BufferGeometry;
  readonly signBack: THREE.BufferGeometry;
  readonly plateFace: THREE.BufferGeometry;
  /** Lens position relative to the pole base (arm reaches toward -x). */
  readonly lensOffset = new THREE.Vector3(-2.75, 9.62, 0);

  constructor() {
    const pole = new THREE.CylinderGeometry(0.075, 0.13, 10, 12, 1);
    pole.translate(0, 5, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.06, 2.9, 8, 1);
    arm.rotateZ(Math.PI / 2 - 0.12);
    arm.translate(-1.4, 9.85, 0);
    const base = new THREE.CylinderGeometry(0.22, 0.26, 0.5, 12);
    base.translate(0, 0.25, 0);
    this.lampPole = mergeGeometries([pole, arm, base])!;

    const head = new THREE.BoxGeometry(0.85, 0.16, 0.38);
    head.translate(-2.75, 9.72, 0);
    this.lampHead = head;
    const lens = new THREE.PlaneGeometry(0.7, 0.28);
    lens.rotateX(Math.PI / 2);
    lens.translate(-2.75, 9.635, 0);
    this.lampLens = lens;

    const post = new THREE.BoxGeometry(0.12, 0.85, 0.08);
    post.translate(0, 0.425, 0);
    this.guardPost = post;

    const sp = new THREE.CylinderGeometry(0.045, 0.045, 4.2, 8);
    sp.translate(0, 2.1, 0);
    this.signPole = sp;
    this.signFace = new THREE.PlaneGeometry(1.4, 1.75);
    this.signFace.translate(0, 3.25, 0.03);
    this.signBack = new THREE.BoxGeometry(1.44, 1.79, 0.03);
    this.signBack.translate(0, 3.25, 0.0);
    this.plateFace = new THREE.PlaneGeometry(1.0, 0.39);
    this.plateFace.translate(0, 2.08, 0.03);
  }
}

let props: PropGeometry | null = null;

export class RoadChunkBuilder {
  private props: PropGeometry;

  constructor(
    private readonly layout: RoadLayout,
    private readonly mats: Materials,
  ) {
    props ??= new PropGeometry();
    this.props = props;
  }

  build(index: number, s0: number, s1: number): RoadChunk {
    const group = new THREE.Group();
    group.position.z = -s0;
    group.name = `road-chunk-${index}`;
    const owned: THREE.BufferGeometry[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadows: { cast?: boolean; receive?: boolean } = {}) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !!shadows.cast;
      mesh.receiveShadow = shadows.receive ?? true;
      group.add(mesh);
      owned.push(geo);
      return mesh;
    };

    add(this.surface(s0, s1), this.mats.road);
    add(this.markings(s0, s1), this.mats.marking);
    const arrows = this.arrows(s0, s1);
    if (arrows) add(arrows, this.mats.arrow);
    add(this.guardrail(s0, s1), this.mats.guardrail, { cast: true });
    add(this.jersey(s0, s1), this.mats.concrete, { cast: true });
    group.add(this.guardPosts(s0, s1));
    const lamps = this.streetLights(s0, s1, group);
    this.signs(s0, s1, group);

    return {
      index,
      s0,
      s1,
      group,
      lamps,
      dispose: () => {
        owned.forEach((g) => g.dispose());
        group.traverse((o) => {
          if (o instanceof THREE.InstancedMesh) o.dispose();
        });
        group.removeFromParent();
      },
    };
  }

  private rows(s0: number, s1: number, step = CHUNK_STEP): number[] {
    const out: number[] = [];
    const n = Math.round((s1 - s0) / step);
    for (let i = 0; i <= n; i++) out.push(s0 + (i * (s1 - s0)) / n);
    return out;
  }

  /** Lateral → local x, s → local z. */
  private surface(s0: number, s1: number): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const roadPos = b.attr('roadPos', 2);
    const shoulder = b.attr('shoulder', 1);
    const rows = this.rows(s0, s1);
    const uvBase = s0 % UV_PERIOD;
    const noiseBase = s0 % NOISE_PERIOD;
    for (const s of rows) {
      const cs = this.layout.crossSection(s);
      const cols = [
        [cs.left - MEDIAN_SHOULDER_WIDTH, 1],
        [cs.left, 0],
        [cs.right, 0],
        [cs.right + SHOULDER_WIDTH, 1],
      ];
      const ds = s - s0;
      for (const [x, sh] of cols) {
        b.positions.push(x, 0, -ds);
        b.normals.push(0, 1, 0);
        b.uvs.push(x / LANE_WIDTH + 0.5, (uvBase + ds) / LANE_WIDTH);
        roadPos.push(x, noiseBase + ds);
        shoulder.push(sh);
      }
    }
    b.gridIndices(0, rows.length, 4);
    return b.build();
  }

  private ribbon(b: GeoBuilder, s0: number, xAt: (s: number) => number, sA: number, sB: number, width: number, step: number): void {
    const n = Math.max(1, Math.ceil((sB - sA) / step));
    const base = b.count;
    for (let i = 0; i <= n; i++) {
      const s = sA + ((sB - sA) * i) / n;
      const x = xAt(s);
      const ds = s - s0;
      const v = ((s0 % UV_PERIOD) + ds) / LANE_WIDTH;
      b.positions.push(x - width / 2, MARK_Y, -ds, x + width / 2, MARK_Y, -ds);
      b.normals.push(0, 1, 0, 0, 1, 0);
      b.uvs.push(0, v, 1, v);
    }
    b.gridIndices(base, n + 1, 2);
  }

  private dashes(
    b: GeoBuilder,
    s0: number,
    s1: number,
    pattern: { period: number; length: number; width: number },
    xAt: (s: number) => number,
    accept: (sA: number, sB: number) => boolean = () => true,
  ): void {
    const k0 = Math.floor(s0 / pattern.period);
    const k1 = Math.ceil(s1 / pattern.period);
    for (let k = k0; k <= k1; k++) {
      const a = Math.max(s0, k * pattern.period);
      const e = Math.min(s1, k * pattern.period + pattern.length);
      if (e - a > 0.05 && accept(a, e)) this.ribbon(b, s0, xAt, a, e, pattern.width, 1);
    }
  }

  private markings(s0: number, s1: number): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const L = this.layout;
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) this.dashes(b, s0, s1, DASH, () => x);
    this.ribbon(b, s0, (s) => L.leftEdge(s) + EDGE_WIDTH / 2, s0, s1, EDGE_WIDTH, CHUNK_STEP);
    this.ribbon(b, s0, (s) => L.rightEdge(s) - EDGE_WIDTH / 2, s0, s1, EDGE_WIDTH, CHUNK_STEP);

    // Broad dashed separator between main lanes and an open pocket.
    for (const z of L.zonesIn(s0, s1)) {
      const x = z.side * BASE_HALF_WIDTH;
      this.dashes(b, Math.max(s0, z.start), Math.min(s1, z.end), POCKET_DASH, () => x, (a, e) =>
        Math.min(L.openness(z, a), L.openness(z, e)) > 0.35,
      );
    }
    return b.build();
  }

  private arrows(s0: number, s1: number): THREE.BufferGeometry | null {
    const b = new GeoBuilder();
    for (const z of this.layout.zonesIn(s0, s1)) {
      for (const offset of [20, 70, 120]) {
        const s = z.warningStart + offset;
        if (s < s0 || s >= s1 - 5) continue;
        const x = this.layout.laneCenter(z.side === 1 ? 3 : -1, s);
        const ds = s - s0;
        const [uL, uR] = z.side === 1 ? [0, 1] : [1, 0];
        const base = b.count;
        const hw = 0.7;
        b.positions.push(x - hw, MARK_Y + 0.002, -ds, x + hw, MARK_Y + 0.002, -ds);
        b.positions.push(x - hw, MARK_Y + 0.002, -ds - 5, x + hw, MARK_Y + 0.002, -ds - 5);
        b.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        b.uvs.push(uL, 0, uR, 0, uL, 1, uR, 1);
        b.gridIndices(base, 2, 2);
      }
    }
    return b.count ? b.build() : null;
  }

  /**
   * Sweep a cross-section profile along an edge path. `profile` holds
   * (outward offset, height) pairs; each segment gets its own strip so hard
   * profile corners stay crisp. `outward` is -1 for the left side.
   */
  private sweep(
    s0: number,
    s1: number,
    pathX: (s: number) => number,
    outward: -1 | 1,
    profile: [number, number][],
    smooth: boolean,
  ): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const rows = this.rows(s0, s1);
    const segments = smooth ? [profile] : profile.slice(0, -1).map((p, i) => [p, profile[i + 1]]);
    for (const seg of segments) {
      const base = b.count;
      let arc = 0;
      const arcs = seg.map((p, i) => (i ? (arc += Math.hypot(p[0] - seg[i - 1][0], p[1] - seg[i - 1][1])) : 0));
      for (const s of rows) {
        const x0 = pathX(s);
        const ds = s - s0;
        const v = ((s0 % UV_PERIOD) + ds) / 3;
        seg.forEach(([off, y], i) => {
          b.positions.push(x0 + off * outward, y, -ds);
          b.uvs.push(arcs[i], v);
        });
      }
      // Winding chosen so faces point toward the road on either side.
      b.gridIndices(base, rows.length, seg.length, outward === -1);
    }
    return b.build(true);
  }

  private guardrail(s0: number, s1: number): THREE.BufferGeometry {
    const L = this.layout;
    const profile: [number, number][] = [
      [0, 0.44],
      [-0.08, 0.5],
      [-0.08, 0.56],
      [0, 0.6],
      [-0.08, 0.66],
      [-0.08, 0.72],
      [0, 0.78],
    ];
    return this.sweep(s0, s1, (s) => L.rightEdge(s) + SHOULDER_WIDTH + 0.45, 1, profile, true);
  }

  private guardPosts(s0: number, s1: number): THREE.InstancedMesh {
    const spacing = 4;
    const first = Math.ceil(s0 / spacing) * spacing;
    const count = Math.max(0, Math.ceil((s1 - first) / spacing));
    const mesh = new THREE.InstancedMesh(this.props.guardPost, this.mats.steelPost, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const s = first + i * spacing;
      m.makeTranslation(this.layout.rightEdge(s) + SHOULDER_WIDTH + 0.55, 0, -(s - s0));
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** New-Jersey concrete median barrier (75 mm lip, 55° then 84° faces). */
  private jersey(s0: number, s1: number): THREE.BufferGeometry {
    const L = this.layout;
    const profile: [number, number][] = [
      [0, 0],
      [0, 0.075],
      [0.178, 0.33],
      [0.228, 0.81],
      [0.378, 0.81],
      [0.428, 0.33],
      [0.606, 0.075],
      [0.606, 0],
    ];
    return this.sweep(s0, s1, (s) => L.leftEdge(s) - MEDIAN_SHOULDER_WIDTH - 0.05, -1, profile, false);
  }

  private streetLights(s0: number, s1: number, group: THREE.Group): THREE.Vector3[] {
    const lamps: THREE.Vector3[] = [];
    const first = Math.ceil(s0 / LAMP_SPACING);
    for (let k = first; k * LAMP_SPACING < s1; k++) {
      const s = k * LAMP_SPACING;
      const right = k % 2 === 0;
      const x = right
        ? this.layout.rightEdge(s) + SHOULDER_WIDTH + 1.3
        : this.layout.leftEdge(s) - MEDIAN_SHOULDER_WIDTH - 0.05 - 0.303;
      const lamp = new THREE.Group();
      lamp.position.set(x, right ? 0 : 0.81, -(s - s0));
      // Arm geometry reaches toward -x; flip for median-mounted poles.
      if (!right) lamp.rotation.y = Math.PI;
      const pole = new THREE.Mesh(this.props.lampPole, this.mats.lampPole);
      pole.castShadow = true;
      const head = new THREE.Mesh(this.props.lampHead, this.mats.lampHead);
      head.castShadow = true;
      const lens = new THREE.Mesh(this.props.lampLens, this.mats.lampLens);
      lamp.add(pole, head, lens);
      group.add(lamp);
      lamps.push(this.props.lensOffset.clone().applyEuler(lamp.rotation).add(lamp.position));
    }
    return lamps;
  }

  private signs(s0: number, s1: number, group: THREE.Group): void {
    for (const z of this.layout.zonesIn(s0 - 40, s1 + 40)) {
      const placements: { s: number; kind: 'start' | 'end'; plate?: string }[] = [
        { s: z.start - 30, kind: 'start' },
        { s: z.warningStart, kind: 'end', plate: '150 м' },
        { s: z.fullEnd - 10, kind: 'end' },
      ];
      for (const p of placements) {
        if (p.s < s0 || p.s >= s1) continue;
        const x =
          z.side === 1
            ? this.layout.rightEdge(p.s) + SHOULDER_WIDTH + 1.5
            : this.layout.leftEdge(p.s) - MEDIAN_SHOULDER_WIDTH - 0.05 - 0.303;
        const sign = new THREE.Group();
        sign.position.set(x, z.side === 1 ? 0 : 0.81, -(p.s - s0));
        const pole = new THREE.Mesh(this.props.signPole, this.mats.lampPole);
        const back = new THREE.Mesh(this.props.signBack, this.mats.signBack);
        const face = new THREE.Mesh(this.props.signFace, this.mats.sign(p.kind, z.side));
        pole.castShadow = back.castShadow = true;
        sign.add(pole, back, face);
        if (p.plate) sign.add(new THREE.Mesh(this.props.plateFace, this.mats.plate(p.plate)));
        group.add(sign);
      }
    }
  }
}
