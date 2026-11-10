import * as THREE from 'three';
import { Rng } from '../core/math';
import type { ThemeId } from '../gameplay/maps';
import { canvas, ctx2d, toTexture, type FacadeTextures } from './ProceduralTextures';

/**
 * Canvas-painted textures for the roadside world: tree billboards, building
 * facades, neon signs, gantry signs and the distant backdrop. Nothing here is
 * downloaded, so every map ships inside the bundle.
 */

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ---------------------------------------------------------------------------
// Trees

export type TreeKind = 'sakura' | 'leafy' | 'birch' | 'pine' | 'bamboo' | 'bush';

interface TreeStyle {
  dark: RGB;
  mid: RGB;
  light: RGB;
  trunk: RGB;
  /** Canopy blobs in unit space (x right, y up). */
  blobs: (r: Rng) => { x: number; y: number; r: number }[];
  clumps: number;
  leaf: [number, number];
  trunkTop: number;
  trunkWidth: number;
  branches: number;
}

const TREES: Record<Exclude<TreeKind, 'bamboo'>, TreeStyle> = {
  sakura: {
    dark: [176, 84, 122],
    mid: [244, 160, 190],
    light: [255, 232, 240],
    trunk: [52, 36, 34],
    blobs: (r) => Array.from({ length: 11 }, () => ({ x: r.range(0.2, 0.8), y: r.range(0.52, 0.8), r: r.range(0.13, 0.19) })),
    clumps: 2600,
    leaf: [0.011, 0.024],
    trunkTop: 0.4,
    trunkWidth: 0.06,
    branches: 5,
  },
  leafy: {
    dark: [30, 52, 22],
    mid: [66, 102, 40],
    light: [132, 164, 70],
    trunk: [60, 46, 34],
    blobs: (r) => Array.from({ length: 10 }, () => ({ x: r.range(0.3, 0.7), y: r.range(0.42, 0.8), r: r.range(0.14, 0.2) })),
    clumps: 2400,
    leaf: [0.012, 0.026],
    trunkTop: 0.36,
    trunkWidth: 0.055,
    branches: 3,
  },
  birch: {
    dark: [52, 82, 30],
    mid: [104, 140, 52],
    light: [176, 196, 96],
    trunk: [226, 224, 214],
    blobs: (r) => Array.from({ length: 12 }, () => ({ x: r.range(0.36, 0.64), y: r.range(0.36, 0.86), r: r.range(0.09, 0.14) })),
    clumps: 2200,
    leaf: [0.009, 0.02],
    trunkTop: 0.62,
    trunkWidth: 0.032,
    branches: 2,
  },
  pine: {
    dark: [16, 38, 28],
    mid: [34, 70, 46],
    light: [74, 112, 70],
    trunk: [58, 40, 30],
    blobs: (r) => {
      const out: { x: number; y: number; r: number }[] = [];
      for (let i = 0; i < 8; i++) {
        const y = 0.2 + i * 0.095;
        const hw = 0.3 * (1 - i / 8.5) + 0.03;
        const n = Math.max(1, Math.round(hw / 0.07));
        for (let k = -n; k <= n; k++) out.push({ x: 0.5 + (k / n) * hw + r.range(-0.015, 0.015), y: y - Math.abs(k / n) * 0.035, r: 0.055 });
      }
      return out;
    },
    clumps: 2600,
    leaf: [0.008, 0.017],
    trunkTop: 0.9,
    trunkWidth: 0.035,
    branches: 0,
  },
  bush: {
    dark: [34, 56, 24],
    mid: [70, 106, 42],
    light: [128, 160, 72],
    trunk: [50, 40, 30],
    blobs: (r) => Array.from({ length: 8 }, () => ({ x: r.range(0.22, 0.78), y: r.range(0.22, 0.6), r: r.range(0.16, 0.24) })),
    clumps: 1600,
    leaf: [0.014, 0.03],
    trunkTop: 0,
    trunkWidth: 0,
    branches: 0,
  },
};

/** One tree on a transparent square, trunk at the bottom centre. */
export function createTreeTexture(kind: TreeKind, anisotropy: number, seed = 1): THREE.Texture {
  const S = 512;
  const c = canvas(S);
  const g = ctx2d(c);
  const rng = new Rng(seed * 977 + kind.length * 131 + kind.charCodeAt(0));
  const X = (x: number) => x * S;
  const Y = (y: number) => (1 - y) * S;

  if (kind === 'bamboo') {
    for (let i = 0; i < 7; i++) {
      const x0 = 0.14 + i * 0.12 + rng.range(-0.03, 0.03);
      const lean = rng.range(-0.08, 0.08);
      const top = rng.range(0.82, 0.97);
      const shade = rng.range(0.75, 1.1);
      g.strokeStyle = css([96 * shade, 132 * shade, 52 * shade]);
      g.lineWidth = S * rng.range(0.011, 0.016);
      g.beginPath();
      g.moveTo(X(x0), Y(0));
      g.quadraticCurveTo(X(x0), Y(top * 0.6), X(x0 + lean), Y(top));
      g.stroke();
      g.fillStyle = css([52, 78, 30]);
      for (let n = 0.08; n < top; n += 0.085) g.fillRect(X(x0 + lean * (n / top) ** 2) - S * 0.009, Y(n), S * 0.018, 2);
      for (let k = 0; k < 90; k++) {
        const t = rng.range(0.4, 1);
        const lx = x0 + lean * t * t + rng.range(-0.1, 0.1);
        const ly = top * t + rng.range(-0.04, 0.05);
        const l = rng.next();
        g.fillStyle = css(mix([44, 78, 26], [150, 184, 78], l));
        g.save();
        g.translate(X(lx), Y(ly));
        g.rotate(rng.range(-1.2, 1.2));
        g.beginPath();
        g.ellipse(0, 0, S * rng.range(0.022, 0.04), S * 0.006, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    return toTexture(c, true, anisotropy, false);
  }

  const st = TREES[kind];
  const blobs = st.blobs(rng);
  if (st.trunkWidth > 0) {
    const limb = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number) => {
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        const a = i / steps;
        const b = (i + 1) / steps;
        g.strokeStyle = css(mix(st.trunk, [st.trunk[0] * 0.6, st.trunk[1] * 0.6, st.trunk[2] * 0.6], rng.next() * 0.5));
        g.lineWidth = S * (w0 + (w1 - w0) * a);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(X(x0 + (x1 - x0) * a), Y(y0 + (y1 - y0) * a));
        g.lineTo(X(x0 + (x1 - x0) * b), Y(y0 + (y1 - y0) * b));
        g.stroke();
      }
    };
    const fork = st.branches ? st.trunkTop * 0.75 : st.trunkTop;
    limb(0.5, -0.01, 0.5 + rng.range(-0.02, 0.02), fork, st.trunkWidth, st.trunkWidth * 0.7);
    for (let i = 0; i < st.branches; i++) {
      const b = blobs[Math.floor(rng.next() * blobs.length)];
      limb(0.5, fork * 0.92, b.x, b.y - 0.02, st.trunkWidth * 0.5, st.trunkWidth * 0.14);
    }
    if (kind === 'birch') {
      g.fillStyle = 'rgba(30,28,26,0.85)';
      for (let i = 0; i < 26; i++) g.fillRect(X(0.5 + rng.range(-0.014, 0.004)), Y(rng.range(0.02, st.trunkTop)), S * rng.range(0.008, 0.02), S * 0.004);
    }
  }

  // Two passes: a dark, dense one for the silhouette, then lit clumps from the top-left.
  const total = blobs.reduce((s, b) => s + b.r * b.r, 0);
  const pick = () => {
    let t = rng.next() * total;
    for (const b of blobs) {
      t -= b.r * b.r;
      if (t <= 0) return b;
    }
    return blobs[0];
  };
  for (let pass = 0; pass < 2; pass++) {
    const n = pass === 0 ? st.clumps : Math.round(st.clumps * 0.75);
    for (let i = 0; i < n; i++) {
      const b = pick();
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * b.r;
      const ox = Math.cos(a) * d;
      const oy = Math.sin(a) * d;
      let t = 0.5 + (0.45 * (-ox * 0.45 + oy * 0.9)) / b.r + (rng.next() - 0.5) * 0.5;
      t = Math.min(1, Math.max(0, pass === 0 ? t * 0.55 : t));
      const col = t < 0.5 ? mix(st.dark, st.mid, t * 2) : mix(st.mid, st.light, (t - 0.5) * 2);
      g.fillStyle = css(col);
      g.beginPath();
      g.arc(X(b.x + ox), Y(b.y + oy), S * rng.range(st.leaf[0], st.leaf[1]), 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c, true, anisotropy, false);
}

// ---------------------------------------------------------------------------
// Facades (one tile = 28 m: 8 floors)

export type FacadeStyle = 'panel' | 'glass' | 'office' | 'tokyo';

export function createFacadeTex(style: FacadeStyle, seed: number, anisotropy: number, size = 512): FacadeTextures {
  const rng = new Rng(seed);
  const cm = canvas(size);
  const ce = canvas(size);
  const gm = ctx2d(cm);
  const ge = ctx2d(ce);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, size, size);
  const floors = 8;
  const fh = size / floors;
  const warm = () => `rgba(255, ${190 + rng.next() * 40}, ${110 + rng.next() * 60}, ${0.4 + rng.next() * 0.6})`;
  const cool = () => `rgba(${190 + rng.next() * 40}, 225, 255, ${0.4 + rng.next() * 0.6})`;

  if (style === 'panel') {
    const hue = 28 + rng.next() * 18;
    const lig = 54 + rng.next() * 14;
    gm.fillStyle = `hsl(${hue}, ${8 + rng.next() * 8}%, ${lig}%)`;
    gm.fillRect(0, 0, size, size);
    const cols = 8;
    const cw = size / cols;
    for (let y = 0; y < floors; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw;
        const py = y * fh;
        // Panel tone variation and seams.
        gm.fillStyle = `hsla(${hue}, 8%, ${lig + rng.range(-5, 5)}%, 0.6)`;
        gm.fillRect(px, py, cw, fh);
        gm.strokeStyle = 'rgba(40,36,32,0.55)';
        gm.lineWidth = 1.5;
        gm.strokeRect(px + 0.5, py + 0.5, cw - 1, fh - 1);
        const balcony = x % 4 === 1 || x % 4 === 2;
        const ww = cw * (balcony ? 0.62 : 0.5);
        const wh = fh * 0.46;
        const wx = px + (cw - ww) / 2;
        const wy = py + fh * 0.2;
        gm.fillStyle = '#e8e6de';
        gm.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        gm.fillStyle = `hsl(210, 22%, ${14 + rng.next() * 16}%)`;
        gm.fillRect(wx, wy, ww, wh);
        gm.fillStyle = '#e8e6de';
        gm.fillRect(wx + ww * 0.48, wy, 2, wh);
        if (rng.chance(0.34)) {
          ge.fillStyle = rng.chance(0.8) ? warm() : cool();
          ge.fillRect(wx, wy, ww, wh);
        }
        if (balcony) {
          gm.fillStyle = `hsl(${hue + rng.range(-10, 150) * (rng.chance(0.2) ? 1 : 0)}, 14%, ${lig - 14 + rng.range(-4, 4)}%)`;
          gm.fillRect(px + 2, py + fh * 0.62, cw - 4, fh * 0.3);
        }
      }
    }
  } else if (style === 'glass') {
    const hue = 196 + rng.next() * 24;
    gm.fillStyle = `hsl(${hue}, 30%, 16%)`;
    gm.fillRect(0, 0, size, size);
    const cols = 8;
    const cw = size / cols;
    for (let y = 0; y < floors; y++) {
      const lit = rng.chance(0.3);
      for (let x = 0; x < cols; x++) {
        const grad = gm.createLinearGradient(0, y * fh, 0, (y + 1) * fh);
        const l = 26 + rng.next() * 14;
        grad.addColorStop(0, `hsl(${hue}, 38%, ${l + 16}%)`);
        grad.addColorStop(1, `hsl(${hue + 8}, 34%, ${l - 6}%)`);
        gm.fillStyle = grad;
        gm.fillRect(x * cw + 1.5, y * fh + 2, cw - 3, fh - 4);
        if (lit && rng.chance(0.8)) {
          ge.fillStyle = cool();
          ge.fillRect(x * cw + 1.5, y * fh + fh * 0.2, cw - 3, fh * 0.6);
        }
      }
      gm.fillStyle = `hsl(${hue}, 12%, 60%)`;
      gm.fillRect(0, y * fh, size, 2);
    }
  } else if (style === 'office') {
    const lig = 34 + rng.next() * 22;
    gm.fillStyle = `hsl(${20 + rng.next() * 30}, ${6 + rng.next() * 8}%, ${lig}%)`;
    gm.fillRect(0, 0, size, size);
    const cols = 12;
    const cw = size / cols;
    for (let y = 0; y < floors; y++) {
      const wy = y * fh + fh * 0.22;
      const wh = fh * 0.5;
      gm.fillStyle = 'hsl(212, 28%, 15%)';
      gm.fillRect(0, wy, size, wh);
      const start = rng.int(0, cols);
      const run = rng.chance(0.5) ? rng.int(2, 8) : 0;
      for (let x = 0; x < cols; x++) {
        gm.fillStyle = `hsl(212, 26%, ${14 + rng.next() * 12}%)`;
        gm.fillRect(x * cw + 2, wy, cw - 4, wh);
        if (x >= start && x < start + run) {
          ge.fillStyle = rng.chance(0.5) ? cool() : warm();
          ge.fillRect(x * cw + 2, wy, cw - 4, wh);
        }
      }
    }
  } else {
    // Tokyo: dark towers, most windows lit, neon strip lights along some floors.
    const hue = 230 + rng.next() * 50;
    gm.fillStyle = `hsl(${hue}, 14%, ${9 + rng.next() * 6}%)`;
    gm.fillRect(0, 0, size, size);
    const cols = 10;
    const cw = size / cols;
    const neon = ['#ff3fa4', '#35d6ff', '#ffd23f', '#a23bff', '#ff5a3c'];
    for (let y = 0; y < floors; y++) {
      for (let x = 0; x < cols; x++) {
        const wx = x * cw + cw * 0.16;
        const wy = y * fh + fh * 0.2;
        const ww = cw * 0.68;
        const wh = fh * 0.5;
        gm.fillStyle = `hsl(220, 20%, ${12 + rng.next() * 10}%)`;
        gm.fillRect(wx, wy, ww, wh);
        if (rng.chance(0.62)) {
          const r = rng.next();
          ge.fillStyle = r < 0.55 ? cool() : r < 0.85 ? warm() : `rgba(255, 120, 200, ${0.5 + rng.next() * 0.5})`;
          ge.fillRect(wx, wy, ww, wh);
        }
      }
      if (rng.chance(0.3)) {
        ge.fillStyle = neon[rng.int(0, neon.length - 1)];
        ge.fillRect(0, y * fh + fh * 0.84, size, fh * 0.1);
      }
    }
  }
  return { map: toTexture(cm, true, anisotropy), emissive: toTexture(ce, true, anisotropy) };
}

// ---------------------------------------------------------------------------
// Neon signs: 8 × 2 atlas of vertical boards (1 : 3)

export const NEON_COLS = 8;
export const NEON_ROWS = 2;

export function createNeonAtlas(anisotropy: number): THREE.Texture {
  const cw = 128;
  const chh = 384;
  const c = canvas(cw * NEON_COLS, chh * NEON_ROWS);
  const g = ctx2d(c);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const words = ['ラーメン', 'カラオケ', 'ホテル', '居酒屋', 'パチンコ', '東京', '新宿', '寿司', '薬', 'カメラ', 'ビール', '銀座', '24H', 'BAR', '渋谷', 'ネオン'];
  const colors = ['#ff3fa4', '#35d6ff', '#ffe14a', '#ff5a3c', '#8dff3a', '#c07bff', '#ffffff', '#ff8a1f'];
  const rng = new Rng(88);
  words.forEach((w, i) => {
    const x = (i % NEON_COLS) * cw;
    const y = Math.floor(i / NEON_COLS) * chh;
    const col = colors[i % colors.length];
    const inverse = rng.chance(0.4);
    g.save();
    g.beginPath();
    g.rect(x, y, cw, chh);
    g.clip();
    g.fillStyle = inverse ? col : '#0a0a12';
    g.fillRect(x + 6, y + 6, cw - 12, chh - 12);
    g.strokeStyle = inverse ? '#ffffff' : col;
    g.lineWidth = 6;
    g.strokeRect(x + 10, y + 10, cw - 20, chh - 20);
    const chars = [...w];
    const step = (chh - 50) / chars.length;
    const fs = Math.min(92, step * 0.92);
    g.font = `900 ${fs}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = inverse ? '#14101c' : col;
    g.shadowColor = inverse ? 'transparent' : col;
    g.shadowBlur = 14;
    chars.forEach((ch, k) => g.fillText(ch, x + cw / 2, y + 25 + step * (k + 0.5), cw - 30));
    g.restore();
  });
  return toTexture(c, true, anisotropy, false);
}

// ---------------------------------------------------------------------------
// Overhead gantry signs

const GANTRY: Record<ThemeId, { bg: string; rows: [string, string, string][] }> = {
  city: {
    bg: '#0b6b3a',
    rows: [
      ['Центр', 'Аэропорт', 'М-11'],
      ['Кольцевая', 'Северный мост', 'А-118'],
      ['Порт', 'Южное шоссе', 'М-4'],
    ],
  },
  japan: {
    bg: '#0b6e4f',
    rows: [
      ['東京 Tokyo', '富士 Mt. Fuji', 'E1'],
      ['横浜 Yokohama', '箱根 Hakone', 'E85'],
      ['京都 Kyoto', '名古屋 Nagoya', 'E1A'],
    ],
  },
  tokyo: {
    bg: '#0b6e4f',
    rows: [
      ['新宿 Shinjuku', '渋谷 Shibuya', 'C1'],
      ['銀座 Ginza', '羽田 Haneda', 'B'],
      ['湾岸線 Wangan', '横浜 Yokohama', 'K1'],
    ],
  },
};

/** 6 × 2.5 m direction sign; `variant` picks the destinations. */
export function createGantrySign(theme: ThemeId, variant: number, anisotropy: number): THREE.Texture {
  const W = 768;
  const H = 320;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const def = GANTRY[theme];
  const row = def.rows[variant % def.rows.length];
  g.fillStyle = '#f4f4f0';
  g.beginPath();
  g.roundRect(0, 0, W, H, 26);
  g.fill();
  g.fillStyle = def.bg;
  g.beginPath();
  g.roundRect(10, 10, W - 20, H - 20, 20);
  g.fill();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '700 82px "Arial Narrow", "Noto Sans JP", Arial, sans-serif';
  g.fillText(row[0], 150, 104, W - 330);
  g.font = '700 62px "Arial Narrow", "Noto Sans JP", Arial, sans-serif';
  g.fillText(row[1], 150, 222, W - 330);
  // Straight-on arrow.
  g.lineWidth = 26;
  g.strokeStyle = '#fff';
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(82, 268);
  g.lineTo(82, 110);
  g.stroke();
  g.beginPath();
  g.moveTo(82, 44);
  g.lineTo(132, 124);
  g.lineTo(32, 124);
  g.closePath();
  g.fill();
  // Route shield.
  g.fillStyle = theme === 'city' ? '#f4f4f0' : '#1c3f95';
  g.beginPath();
  g.roundRect(W - 170, 50, 130, 86, 12);
  g.fill();
  g.fillStyle = theme === 'city' ? def.bg : '#fff';
  g.font = '700 54px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(row[2], W - 105, 96, 116);
  return toTexture(c, true, anisotropy, false);
}

// ---------------------------------------------------------------------------
// Roadside adverts (city): 2 × 2 atlas of 2 : 1 hoardings

export function createAdAtlas(anisotropy: number): THREE.Texture {
  const c = canvas(1024, 512);
  const g = ctx2d(c);
  const ads: [string, string, string, string][] = [
    ['#ff7a18', '#af002d', 'ШИНЫ −30%', 'до конца сезона'],
    ['#0f2027', '#2c5364', 'КОФЕ 24', 'съезд через 2 км'],
    ['#1d976c', '#93f9b9', 'АВТОМОЙКА', 'быстро · чисто'],
    ['#4b1fa8', '#ff3fa4', 'НОЧНОЙ ЗАЕЗД', 'каждую пятницу'],
  ];
  ads.forEach(([a, b, title, sub], i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 256;
    const grad = g.createLinearGradient(x, y, x + 512, y + 256);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(x, y, 512, 256);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 8;
    g.strokeRect(x + 10, y + 10, 492, 236);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 74px "Arial Narrow", Arial, sans-serif';
    g.fillText(title, x + 256, y + 108, 450);
    g.font = '600 36px Arial, sans-serif';
    g.fillText(sub, x + 256, y + 186, 450);
  });
  return toTexture(c, true, anisotropy, false);
}

// ---------------------------------------------------------------------------
// Noise wall (u: 0 at the base … 1 at the top, v: one tile = one 4 m panel)

export function createWallTex(theme: ThemeId, anisotropy: number): FacadeTextures {
  const S = 256;
  const cm = canvas(S);
  const ce = canvas(S);
  const gm = ctx2d(cm);
  const ge = ctx2d(ce);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  const rng = new Rng(theme.length * 31);
  // The profile's arc runs along canvas x, the road along canvas y.
  const tokyo = theme === 'tokyo';
  gm.fillStyle = tokyo ? '#3a3f4a' : '#7d8a86';
  gm.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    gm.fillStyle = `rgba(${tokyo ? '20,22,30' : '40,50,48'},${rng.range(0.03, 0.12)})`;
    gm.fillRect(rng.range(0, S), rng.range(0, S), rng.range(20, 120), rng.range(2, 10));
  }
  // Upper glazed band.
  gm.fillStyle = tokyo ? '#2a3140' : '#9fb8bd';
  gm.fillRect(S * 0.62, 0, S * 0.3, S);
  // Post between panels and the cap rail.
  gm.fillStyle = tokyo ? '#1c1f27' : '#4c5654';
  gm.fillRect(0, 0, S, 10);
  gm.fillRect(S * 0.92, 0, S * 0.08, S);
  gm.fillRect(S * 0.6, 0, 4, S);
  if (tokyo) {
    ge.fillStyle = '#9fe8ff';
    ge.fillRect(S * 0.55, 0, 6, S);
  }
  return { map: toTexture(cm, true, anisotropy), emissive: toTexture(ce, true, anisotropy) };
}

// ---------------------------------------------------------------------------
// Soft radial glow for light sprites

export function createGlow(): THREE.Texture {
  const S = 128;
  const c = canvas(S);
  const g = ctx2d(c);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return toTexture(c, true, 1, false);
}

// ---------------------------------------------------------------------------
// Distant backdrop: wraps twice around the horizon, so it must tile in x.

/** Periodic ridge line: a sum of sines with integer frequencies. */
function ridge(rng: Rng, octaves: number, base: number): (u: number) => number {
  const terms = Array.from({ length: octaves }, (_, i) => ({ f: base * 2 ** i + rng.int(0, 2), p: rng.range(0, Math.PI * 2), a: 0.5 ** i }));
  const norm = terms.reduce((s, t) => s + t.a, 0);
  return (u) => terms.reduce((s, t) => s + Math.sin(u * Math.PI * 2 * t.f + t.p) * t.a, 0) / norm;
}

/**
 * `haze` is the fog colour (linear); far layers sit close to it, near layers
 * take more of the theme's own colour. The bottom is solid haze so the
 * cylinder melts into the fogged ground.
 */
export function createBackdrop(theme: ThemeId, haze: THREE.Color, night: boolean, width = 4096): THREE.Texture {
  const W = width;
  const H = 512;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const rng = new Rng(theme.length * 53 + 5);
  const hz = new THREE.Color().copy(haze).convertLinearToSRGB();
  const hazeRgb: RGB = [hz.r * 255, hz.g * 255, hz.b * 255];
  const tone = (col: RGB, amount: number) => css(mix(hazeRgb, col, amount));
  /** Horizon sits at 16 % of the height; the rest above is sky room for peaks. */
  const horizon = H * 0.84;

  const fillRidge = (fn: (u: number) => number, baseY: number, amp: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) g.lineTo(x, baseY - (fn(x / W) * 0.5 + 0.5) * amp);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  };

  if (theme === 'japan') {
    const layers: [number, number, RGB, number][] = [
      [3, 150, [96, 118, 170], 0.3],
      [5, 105, [70, 104, 120], 0.5],
      [8, 62, [52, 92, 64], 0.72],
    ];
    layers.forEach(([base, amp, col, amount], i) => {
      fillRidge(ridge(rng, 5, base), horizon - 6 + i * 10, amp, tone(col, amount));
      // Mist pooling in the valleys between ranges.
      const mist = g.createLinearGradient(0, horizon - amp * 0.5, 0, horizon + 20);
      mist.addColorStop(0, css(hazeRgb, 0));
      mist.addColorStop(1, css(hazeRgb, 0.55));
      g.fillStyle = mist;
      g.fillRect(0, horizon - amp * 0.5, W, amp * 0.5 + 20);
    });
  } else {
    const tokyo = theme === 'tokyo';
    if (!tokyo) fillRidge(ridge(rng, 4, 3), horizon, 46, tone([70, 84, 96], 0.3));
    const passes = tokyo ? 3 : 2;
    for (let p = 0; p < passes; p++) {
      const amount = tokyo ? 0.55 + p * 0.2 : 0.38 + p * 0.22;
      const body: RGB = tokyo ? [14, 12, 30] : night ? [10, 14, 26] : [58, 66, 80];
      const maxH = (tokyo ? 150 : 90) * (1 - p * 0.22);
      let x = 0;
      while (x < W) {
        const w = rng.range(14, tokyo ? 44 : 60);
        const cluster = 0.35 + 0.65 * Math.max(0, Math.sin((x / W) * Math.PI * 2 * (tokyo ? 5 : 3) + p * 2.1));
        const h = (8 + Math.pow(rng.next(), 2.2) * maxH) * cluster + 6;
        const y = horizon - h + 2;
        g.fillStyle = tone(body, amount);
        g.fillRect(x, y, w, h + 4);
        if (night || tokyo) {
          const lit = tokyo ? 0.5 : 0.3;
          for (let wy = y + 3; wy < horizon - 2; wy += 5) {
            for (let wx = x + 2; wx < x + w - 2; wx += 4) {
              if (!rng.chance(lit)) continue;
              const r = rng.next();
              g.fillStyle = r < 0.6 ? 'rgba(255,214,150,0.95)' : r < 0.85 ? 'rgba(190,230,255,0.95)' : tokyo ? 'rgba(255,90,190,0.95)' : 'rgba(255,240,220,0.9)';
              g.fillRect(wx, wy, 2, 2.4);
            }
          }
          if (h > maxH * 0.55) {
            g.fillStyle = 'rgba(255,40,40,1)';
            g.fillRect(x + w / 2 - 1.5, y - 3, 3, 3);
          }
        }
        x += w + rng.range(-4, tokyo ? 6 : 26);
      }
    }
    if (tokyo) {
      // City glow rising off the streets.
      const glow = g.createLinearGradient(0, horizon - 120, 0, horizon);
      glow.addColorStop(0, 'rgba(255,60,170,0)');
      glow.addColorStop(1, 'rgba(255,90,170,0.22)');
      g.fillStyle = glow;
      g.fillRect(0, horizon - 120, W, 120);
    }
  }
  // Ground haze: fully opaque at and below the horizon line.
  const fade = g.createLinearGradient(0, horizon - 26, 0, horizon + 6);
  fade.addColorStop(0, css(hazeRgb, 0));
  fade.addColorStop(1, css(hazeRgb, 1));
  g.fillStyle = fade;
  g.fillRect(0, horizon - 26, W, H - horizon + 26);
  const t = toTexture(c, true, 4, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Sakura petal / rain streak sprite sheet is unnecessary: both are drawn procedurally in their shaders. */
