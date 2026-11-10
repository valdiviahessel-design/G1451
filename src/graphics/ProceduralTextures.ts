import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * CPU-generated textures. The game ships no image assets for the road, so the
 * asphalt aggregate, cracks, signs and facades are synthesised once at startup.
 */

type Canvas = HTMLCanvasElement;

function canvas(w: number, h = w): Canvas {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: Canvas): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2D canvas unavailable');
  return g;
}

function toTexture(c: Canvas, srgb: boolean, anisotropy: number, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Periodic value-noise field sampled into a size×size grid (seamless tiling). */
function tileableFbm(size: number, baseCells: number, octaves: number, rng: Rng, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    const scale = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
        const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas rows go top→bottom while UV v goes up; flip so bumps light correctly.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

export interface AsphaltTextures {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  /** R: cracks, G: sealed (tar) cracks, B: oil stains. Covers 4 lanes × 15 m. */
  features: THREE.Texture;
}

/** Stone-mastic asphalt tile covering exactly one lane (3.75 m) square. */
export function createAsphalt(anisotropy: number, size = 1024, seed = 7): AsphaltTextures {
  const rng = new Rng(seed);
  const n = size * size;
  const height = tileableFbm(size, 8, 6, rng, 0.55);
  const tone = tileableFbm(size, 4, 4, rng, 0.6);
  const albedo = new Float32Array(n * 3);
  const rough = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = 0.06 + tone[i] * 0.035 + (rng.next() - 0.5) * 0.015;
    albedo[i * 3] = t;
    albedo[i * 3 + 1] = t;
    albedo[i * 3 + 2] = t * 1.04;
    height[i] *= 0.25;
    rough[i] = 0.9 + rng.next() * 0.08;
  }

  // Aggregate: thousands of polished stones, 2–12 mm, embedded in bitumen.
  const stones = Math.floor(size * size * 0.028);
  for (let k = 0; k < stones; k++) {
    const cx = rng.next() * size;
    const cy = rng.next() * size;
    const r = 0.7 + Math.pow(rng.next(), 2.2) * 3.2;
    const h = 0.45 + rng.next() * 0.55;
    const g = 0.1 + Math.pow(rng.next(), 1.5) * 0.2;
    const warm = (rng.next() - 0.5) * 0.06;
    const polish = 0.62 + rng.next() * 0.18;
    const ri = Math.ceil(r);
    for (let oy = -ri; oy <= ri; oy++) {
      for (let ox = -ri; ox <= ri; ox++) {
        const d = Math.hypot(ox, oy) / r;
        if (d > 1) continue;
        const x = (Math.floor(cx) + ox + size) % size;
        const y = (Math.floor(cy) + oy + size) % size;
        const i = y * size + x;
        const dome = h * Math.sqrt(1 - d * d);
        if (dome > height[i]) {
          height[i] = dome;
          const edge = 1 - d * d * 0.35;
          albedo[i * 3] = (g + warm) * edge;
          albedo[i * 3 + 1] = g * edge;
          albedo[i * 3 + 2] = (g - warm * 0.5) * edge * 1.02;
          rough[i] = polish;
        }
      }
    }
  }

  // Voids between stones: dark, deep, fully rough.
  for (let k = 0; k < n * 0.015; k++) {
    const i = Math.floor(rng.next() * n);
    height[i] -= 0.25;
    albedo[i * 3] *= 0.45;
    albedo[i * 3 + 1] *= 0.45;
    albedo[i * 3 + 2] *= 0.45;
    rough[i] = 1;
  }

  const cAlb = canvas(size);
  const cRough = canvas(size);
  const gAlb = ctx2d(cAlb);
  const gRough = ctx2d(cRough);
  const imgA = gAlb.createImageData(size, size);
  const imgR = gRough.createImageData(size, size);
  for (let i = 0; i < n; i++) {
    imgA.data[i * 4] = Math.pow(albedo[i * 3], 1 / 2.2) * 255;
    imgA.data[i * 4 + 1] = Math.pow(albedo[i * 3 + 1], 1 / 2.2) * 255;
    imgA.data[i * 4 + 2] = Math.pow(albedo[i * 3 + 2], 1 / 2.2) * 255;
    imgA.data[i * 4 + 3] = 255;
    const r = rough[i] * 255;
    imgR.data[i * 4] = r;
    imgR.data[i * 4 + 1] = r;
    imgR.data[i * 4 + 2] = r;
    imgR.data[i * 4 + 3] = 255;
  }
  gAlb.putImageData(imgA, 0, 0);
  gRough.putImageData(imgR, 0, 0);

  const cNorm = canvas(size);
  const gNorm = ctx2d(cNorm);
  const imgN = gNorm.createImageData(size, size);
  imgN.data.set(normalFromHeight(height, size, 2.2));
  gNorm.putImageData(imgN, 0, 0);

  return {
    albedo: toTexture(cAlb, true, anisotropy),
    normal: toTexture(cNorm, false, anisotropy),
    roughness: toTexture(cRough, false, anisotropy),
    features: createFeatureMap(anisotropy, seed + 1),
  };
}

/** Draw a primitive at all 9 wrap offsets so the result tiles seamlessly. */
function wrapped(size: number, draw: (dx: number, dy: number) => void): void {
  for (const dy of [-size, 0, size]) for (const dx of [-size, 0, size]) draw(dx, dy);
}

function createFeatureMap(anisotropy: number, seed: number, size = 1024): THREE.Texture {
  const rng = new Rng(seed);
  const layers = [canvas(size), canvas(size), canvas(size)];
  const [gCrack, gSeal, gStain] = layers.map(ctx2d);
  for (const g of [gCrack, gSeal, gStain]) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
  }

  // Hairline cracks: random walks biased along the driving direction.
  const crack = (x: number, y: number, angle: number, steps: number, width: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    for (let i = 0; i < steps; i++) {
      angle += (rng.next() - 0.5) * 0.7;
      const len = 3 + rng.next() * 7;
      x += Math.cos(angle) * len;
      y += Math.sin(angle) * len;
      pts.push([x, y]);
      if (depth < 2 && rng.chance(0.035)) {
        crack(x, y, angle + (rng.chance(0.5) ? 1 : -1) * (0.6 + rng.next()), Math.floor(steps * 0.4), width * 0.7, depth + 1);
      }
    }
    gCrack.strokeStyle = `rgba(255,255,255,${0.55 + rng.next() * 0.45})`;
    gCrack.lineWidth = width;
    gCrack.lineJoin = 'round';
    wrapped(size, (dx, dy) => {
      gCrack.beginPath();
      pts.forEach(([px, py], i) => (i ? gCrack.lineTo(px + dx, py + dy) : gCrack.moveTo(px + dx, py + dy)));
      gCrack.stroke();
    });
  };
  for (let i = 0; i < 16; i++) {
    const longitudinal = rng.chance(0.65);
    const angle = longitudinal ? -Math.PI / 2 + (rng.next() - 0.5) * 0.5 : (rng.next() - 0.5) * 0.6;
    crack(rng.next() * size, rng.next() * size, angle, 25 + rng.int(0, 90), 0.8 + rng.next() * 1.6, 0);
  }

  // Tar-sealed cracks: wide glossy bitumen ribbons that meander along lanes.
  for (let i = 0; i < 3; i++) {
    let x = rng.next() * size;
    let y = rng.next() * size;
    let angle = -Math.PI / 2 + (rng.next() - 0.5) * 0.8;
    const pts: [number, number][] = [[x, y]];
    const steps = 30 + rng.int(0, 60);
    for (let k = 0; k < steps; k++) {
      angle += (rng.next() - 0.5) * 0.35;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      pts.push([x, y]);
    }
    gSeal.strokeStyle = 'rgba(255,255,255,0.95)';
    gSeal.lineWidth = 3 + rng.next() * 4;
    gSeal.lineJoin = gSeal.lineCap = 'round';
    wrapped(size, (dx, dy) => {
      gSeal.beginPath();
      pts.forEach(([px, py], k) => (k ? gSeal.lineTo(px + dx, py + dy) : gSeal.moveTo(px + dx, py + dy)));
      gSeal.stroke();
    });
  }

  // Oil drips concentrate in lane centers (texture spans 4 lanes horizontally).
  for (let i = 0; i < 26; i++) {
    const lane = rng.int(0, 3);
    const x = (lane + 0.5 + (rng.next() - 0.5) * 0.25) * (size / 4);
    const y = rng.next() * size;
    const r = 10 + rng.next() * 45;
    wrapped(size, (dx, dy) => {
      const grad = gStain.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.35 + rng.next() * 0.4})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      gStain.fillStyle = grad;
      gStain.beginPath();
      gStain.ellipse(x + dx, y + dy, r * 0.6, r * 1.3, 0, 0, Math.PI * 2);
      gStain.fill();
    });
  }

  const out = canvas(size);
  const gOut = ctx2d(out);
  const img = gOut.createImageData(size, size);
  const d = [gCrack, gSeal, gStain].map((g) => g.getImageData(0, 0, size, size).data);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = d[0][i * 4];
    img.data[i * 4 + 1] = d[1][i * 4];
    img.data[i * 4 + 2] = d[2][i * 4];
    img.data[i * 4 + 3] = 255;
  }
  gOut.putImageData(img, 0, 0);
  return toTexture(out, false, anisotropy);
}

/** Worn paint for lane markings: mostly white with scuffs and asphalt show-through. */
export function createMarkingWear(anisotropy: number, size = 256): THREE.Texture {
  const rng = new Rng(99);
  const fbm = tileableFbm(size, 8, 4, rng);
  const c = canvas(size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(1, 0.68 + fbm[i] * 0.42 - (rng.chance(0.06) ? 0.35 : 0));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true, anisotropy);
}

/** Dry roadside grass and dirt. */
export function createGrass(anisotropy: number, size = 512): THREE.Texture {
  const rng = new Rng(5);
  const patch = tileableFbm(size, 4, 5, rng, 0.55);
  const fine = tileableFbm(size, 64, 2, rng);
  const c = canvas(size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const p = patch[i];
    const dirt = Math.max(0, Math.min(1, (0.45 - p) * 4));
    const f = 0.75 + fine[i] * 0.5 + (rng.next() - 0.5) * 0.25;
    const grass = [0.32, 0.36, 0.16];
    const dry = [0.5, 0.45, 0.24];
    const soil = [0.36, 0.3, 0.22];
    const m = Math.min(1, Math.max(0, (p - 0.35) * 2.5));
    for (let k = 0; k < 3; k++) {
      const base = grass[k] * (1 - m) + dry[k] * m;
      img.data[i * 4 + k] = Math.min(255, (base * (1 - dirt) + soil[k] * dirt) * f * 255);
    }
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true, anisotropy);
}

/** Cast concrete with pores and formwork staining. */
export function createConcrete(anisotropy: number, size = 512): THREE.Texture {
  const rng = new Rng(21);
  const fbm = tileableFbm(size, 6, 5, rng, 0.6);
  const c = canvas(size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    let v = 0.55 + fbm[i] * 0.25 + (rng.next() - 0.5) * 0.06;
    if (rng.chance(0.01)) v *= 0.55;
    const y = Math.floor(i / size) / size;
    v *= 1 - Math.max(0, 0.18 - y) * 1.6; // grime collects at the base
    img.data[i * 4] = v * 255;
    img.data[i * 4 + 1] = v * 0.98 * 255;
    img.data[i * 4 + 2] = v * 0.94 * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true, anisotropy);
}

export interface FacadeTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
}

/** Office facade: 8×8 window grid; emissive layer holds randomly lit windows. */
export function createFacade(anisotropy: number, seed: number, size = 256): FacadeTextures {
  const rng = new Rng(seed);
  const cm = canvas(size);
  const ce = canvas(size);
  const gm = ctx2d(cm);
  const ge = ctx2d(ce);
  const wall = `hsl(${20 + rng.next() * 30}, ${8 + rng.next() * 12}%, ${22 + rng.next() * 18}%)`;
  gm.fillStyle = wall;
  gm.fillRect(0, 0, size, size);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, size, size);
  const cell = size / 8;
  const inset = 5;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const px = x * cell + inset;
      const py = y * cell + inset;
      const w = cell - inset * 2;
      const h = cell - inset * 1.6;
      const l = 10 + rng.next() * 14;
      gm.fillStyle = `hsl(210, 25%, ${l}%)`;
      gm.fillRect(px, py, w, h);
      if (rng.chance(0.42)) {
        const warm = rng.chance(0.7);
        const b = 0.35 + rng.next() * 0.65;
        ge.fillStyle = warm
          ? `rgba(255, ${190 + rng.next() * 40}, ${110 + rng.next() * 50}, ${b})`
          : `rgba(${190 + rng.next() * 30}, 220, 255, ${b})`;
        ge.fillRect(px, py, w, h);
      }
    }
  }
  return { map: toTexture(cm, true, anisotropy), emissive: toTexture(ce, true, anisotropy) };
}

const SIGN_BLUE = '#1452b8';

function arrow(g: CanvasRenderingContext2D, pts: [number, number][], width: number): void {
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  const [x1, y1] = pts[pts.length - 1];
  const [x0, y0] = pts[pts.length - 2];
  const a = Math.atan2(y1 - y0, x1 - x0);
  const head = width * 2.2;
  g.beginPath();
  g.moveTo(x1 + Math.cos(a) * head * 0.9, y1 + Math.sin(a) * head * 0.9);
  g.lineTo(x1 + Math.cos(a + 2.3) * head, y1 + Math.sin(a + 2.3) * head);
  g.lineTo(x1 + Math.cos(a - 2.3) * head, y1 + Math.sin(a - 2.3) * head);
  g.closePath();
  g.fill();
}

/**
 * Russian-style lane signs (5.15.3 «Начало полосы» / 5.15.5 «Конец полосы»)
 * for a pocket opening or closing on `side`.
 */
export function createLaneSign(kind: 'start' | 'end', side: -1 | 1, anisotropy: number): THREE.Texture {
  const W = 512;
  const H = 640;
  const c = canvas(W, H);
  const g = ctx2d(c);
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(0, 0, W, H, 36);
  g.fill();
  g.fillStyle = SIGN_BLUE;
  g.beginPath();
  g.roundRect(14, 14, W - 28, H - 28, 26);
  g.fill();

  g.strokeStyle = g.fillStyle = '#fff';
  const lanes = 4;
  const spacing = 96;
  const x0 = W / 2 - (spacing * (lanes - 1)) / 2;
  const pocketIdx = side === 1 ? lanes - 1 : 0;
  const neighbour = pocketIdx - side;
  const top = 150;
  const bottom = H - 70;
  for (let i = 0; i < lanes; i++) {
    const x = x0 + i * spacing;
    if (i !== pocketIdx) {
      arrow(g, [[x, bottom], [x, top]], 26);
      continue;
    }
    const nx = x0 + neighbour * spacing;
    if (kind === 'end') {
      // Pocket lane bends into its neighbour.
      arrow(g, [[x, bottom], [x, bottom - 170], [x - (x - nx) * 0.55, bottom - 280]], 26);
    } else {
      // New lane branches off the neighbour.
      arrow(g, [[nx + (x - nx) * 0.3, bottom - 40], [x, bottom - 160], [x, top]], 26);
    }
  }
  return toTexture(c, true, anisotropy, false);
}

/** Supplementary distance plate (8.1.1). */
export function createDistancePlate(text: string, anisotropy: number): THREE.Texture {
  const c = canvas(512, 200);
  const g = ctx2d(c);
  g.fillStyle = '#111';
  g.fillRect(0, 0, 512, 200);
  g.fillStyle = '#fff';
  g.fillRect(12, 12, 488, 176);
  g.fillStyle = '#111';
  g.font = 'bold 128px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 108);
  return toTexture(c, true, anisotropy, false);
}

/** Painted merge arrow (1.4 m × 5 m). Points straight, then bends left; mirror UVs for right. */
export function createMergeArrow(anisotropy: number): THREE.Texture {
  const W = 160;
  const H = 576;
  const c = canvas(W, H);
  const g = ctx2d(c);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = 26;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(W * 0.62, H);
  g.lineTo(W * 0.62, H * 0.42);
  g.quadraticCurveTo(W * 0.62, H * 0.24, W * 0.32, H * 0.14);
  g.stroke();
  const a = Math.atan2(-H * 0.1, -W * 0.3);
  const tipX = W * 0.32 + Math.cos(a) * 30;
  const tipY = H * 0.14 + Math.sin(a) * 30;
  g.beginPath();
  g.moveTo(tipX + Math.cos(a) * 50, tipY + Math.sin(a) * 50);
  g.lineTo(tipX + Math.cos(a + 1.9) * 52, tipY + Math.sin(a + 1.9) * 52);
  g.lineTo(tipX + Math.cos(a - 1.9) * 52, tipY + Math.sin(a - 1.9) * 52);
  g.closePath();
  g.fill();
  const t = toTexture(c, true, anisotropy, false);
  t.premultiplyAlpha = false;
  return t;
}
