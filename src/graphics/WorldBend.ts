import * as THREE from 'three';

/** Control points of the bend profile and their spacing along the road, m. */
const POINTS = 40;
const STEP = 30;
const RANGE = (POINTS - 1) * STEP;

export interface BendStyle {
  /** Tightest curve radius, m. */
  radius: number;
  /** Tightest vertical curve radius (crests and dips), m. */
  hill: number;
  /** Typical length of a curve / of a hill, m. */
  curveLength: number;
  hillLength: number;
}

/** Per-map road character: city ring roads sweep, the mountain road rolls, the Shuto twists. */
const STYLES: Record<string, BendStyle> = {
  sunset: { radius: 950, hill: 5200, curveLength: 760, hillLength: 520 },
  rush: { radius: 1100, hill: 6500, curveLength: 820, hillLength: 600 },
  night: { radius: 900, hill: 5600, curveLength: 720, hillLength: 540 },
  sakura: { radius: 700, hill: 3000, curveLength: 620, hillLength: 430 },
  tokyo: { radius: 600, hill: 4200, curveLength: 560, hillLength: 480 },
};
const DEFAULT_STYLE = STYLES.sunset;

function hash(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * u;
}

const GLSL = /* glsl */ `
#ifndef WORLD_BEND
#define WORLD_BEND
uniform vec4 uBendPts[${POINTS}];
uniform vec2 uBendRef;
// Displaces a scene-space position by the road's curve and hill profile ahead of the car.
vec3 worldBend( vec3 w ) {
	float d = max( 0.0, uBendRef.x - w.z );
	float f = min( d / ${STEP.toFixed(1)}, ${(POINTS - 1.001).toFixed(3)} );
	float fi = floor( f );
	float t = f - fi;
	int i = int( fi );
	vec4 a = uBendPts[ i ];
	vec4 b = uBendPts[ i + 1 ];
	float t2 = t * t;
	float t3 = t2 * t;
	vec2 o = ( 2.0 * t3 - 3.0 * t2 + 1.0 ) * a.xy + ( t3 - 2.0 * t2 + t ) * ${STEP.toFixed(1)} * a.zw
		+ ( 3.0 * t2 - 2.0 * t3 ) * b.xy + ( t3 - t2 ) * ${STEP.toFixed(1)} * b.zw;
	// Past the last control point the profile carries on along its final slope.
	o += b.zw * max( 0.0, d - ${RANGE.toFixed(1)} );
	w.xy += o * uBendRef.y;
	return w;
}
#endif
`;

type Hook = (shader: { uniforms: Record<string, THREE.IUniform> }, renderer: THREE.WebGLRenderer) => void;
interface Hooked {
  __userCompile?: Hook;
  userData?: Record<string, unknown>;
  name?: string;
}

/**
 * Curved world. The simulation runs on a perfectly straight road; curves,
 * crests and dips exist only on screen. Every vertex is displaced by a profile
 * integrated from the road's curvature ahead of the car, so bends approach and
 * pass under the wheels like real ones while lanes, traffic and collisions stay
 * in straight space. Patched into three's shared shader chunks, it applies to
 * every built-in material (and the shadow pass) with no per-material work.
 */
export class WorldBend {
  /** Lateral curvature under the car, 1/m (positive bends right). For camera lean and the like. */
  curvature = 0;
  /** Vertical curvature under the car, 1/m (positive rises). */
  crest = 0;
  private style = DEFAULT_STYLE;
  private readonly pts: THREE.Vector4[] = [];
  private readonly live = { uBendPts: { value: this.pts }, uBendRef: { value: new THREE.Vector2(0, 0) } };
  /** For sky-like things that must not move with the road (`material.userData.noBend`). */
  private readonly flat = { uBendPts: { value: this.pts }, uBendRef: { value: new THREE.Vector2(0, 0) } };
  private refZ = 0;
  private on = false;

  constructor() {
    for (let i = 0; i < POINTS; i++) this.pts.push(new THREE.Vector4());
    const chunks = THREE.ShaderChunk as Record<string, string>;
    const swap = (chunk: string, from: string, to: string) => {
      if (!chunks[chunk].includes(from)) throw new Error(`WorldBend: three's ${chunk} chunk changed`);
      chunks[chunk] = chunks[chunk].replace(from, to);
    };
    chunks.common = GLSL + chunks.common;
    swap('project_vertex', 'mvPosition = modelViewMatrix * mvPosition;', 'mvPosition = viewMatrix * vec4( worldBend( ( modelMatrix * mvPosition ).xyz ), 1.0 );');
    // Shadow lookups and reflections must see the same displaced position as the depth pass.
    swap('worldpos_vertex', 'worldPosition = modelMatrix * worldPosition;', 'worldPosition = modelMatrix * worldPosition;\n\tworldPosition.xyz = worldBend( worldPosition.xyz );');

    // Hand the uniforms to every material, including ones three creates internally (shadow depth).
    // The accessor keeps materials' own onBeforeCompile hooks working on top of it.
    const live = this.live;
    const flat = this.flat;
    const proto = THREE.Material.prototype as unknown as Hooked & { customProgramCacheKey: () => string };
    Object.defineProperty(proto, 'onBeforeCompile', {
      configurable: true,
      get(this: Hooked): Hook {
        const user = this.__userCompile;
        return (shader, renderer) => {
          user?.call(this, shader, renderer);
          const u = this.userData?.noBend || this.name?.startsWith('Background') ? flat : live;
          shader.uniforms.uBendPts = u.uBendPts;
          shader.uniforms.uBendRef = u.uBendRef;
        };
      },
      set(this: Hooked, fn: Hook) {
        this.__userCompile = fn;
      },
    });
    proto.customProgramCacheKey = function (this: Hooked) {
      return this.__userCompile ? this.__userCompile.toString() : '';
    };
  }

  setStyle(mapId: string): void {
    this.style = STYLES[mapId] ?? DEFAULT_STYLE;
  }

  /** Curvature of the road at distance `s`: x lateral, y vertical (1/m). */
  private curveAt(s: number, out: { x: number; y: number }): void {
    const st = this.style;
    // Curves come with straights between them: only the stronger noise lobes bend the road.
    const v = noise(s / st.curveLength, 3.7);
    const a = Math.abs(v);
    const k = a <= 0.2 ? 0 : a >= 0.72 ? 1 : (a - 0.2) / 0.52;
    out.x = (Math.sign(v) * k * k * (3 - 2 * k)) / st.radius;
    out.y = (noise(s / st.hillLength, 9.1) * 0.72 + noise(s / (st.hillLength * 0.37), 5.3) * 0.28) / st.hill;
  }

  /**
   * Rebuilds the profile for the car at road distance `s`, scene depth `z`.
   * `active` is false wherever the straight scene must show as is (the showroom).
   */
  update(s: number, z: number, active: boolean): void {
    this.on = active;
    this.refZ = z;
    this.live.uBendRef.value.set(z, active ? 1 : 0);
    if (!active) return;
    const c = _c;
    this.curveAt(s, c);
    this.curvature = c.x;
    this.crest = c.y;
    let ox = 0;
    let oy = 0;
    let sx = 0;
    let sy = 0;
    this.pts[0].set(0, 0, 0, 0);
    // Two integration sub-steps per segment keep the profile smooth as the car moves through it.
    const h = STEP / 2;
    for (let i = 1; i < POINTS; i++) {
      for (let j = 0; j < 2; j++) {
        this.curveAt(s + (i - 1) * STEP + (j + 0.5) * h, c);
        ox += sx * h + 0.5 * c.x * h * h;
        oy += sy * h + 0.5 * c.y * h * h;
        sx += c.x * h;
        sy += c.y * h;
      }
      this.pts[i].set(ox, oy, sx, sy);
    }
  }

  /** CPU twin of the shader: displaces a scene-space point in place (lights, anything not drawn through a material). */
  apply(p: THREE.Vector3): THREE.Vector3 {
    if (!this.on) return p;
    const d = Math.max(0, this.refZ - p.z);
    const f = Math.min(d / STEP, POINTS - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = (t3 - 2 * t2 + t) * STEP;
    const h01 = 3 * t2 - 2 * t3;
    const h11 = (t3 - t2) * STEP;
    const over = Math.max(0, d - RANGE);
    p.x += h00 * a.x + h10 * a.z + h01 * b.x + h11 * b.z + b.z * over;
    p.y += h00 * a.y + h10 * a.w + h01 * b.y + h11 * b.w + b.w * over;
    return p;
  }
}

const _c = { x: 0, y: 0 };
