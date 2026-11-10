#!/usr/bin/env node
/**
 * Downloads external CC0 assets into public/assets so the game ships them inside
 * the build (Yandex Games disallows runtime loading from third-party domains).
 *
 *   node scripts/fetch-assets.mjs           fetch missing assets
 *   node scripts/fetch-assets.mjs --force   re-download everything
 *   node scripts/fetch-assets.mjs --soft    never fail the calling npm script
 */
import { copyFile, mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSketchfab } from './sketchfab.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const soft = process.argv.includes('--soft');

/**
 * Kenney Car Kit (CC0) mirrored on GitHub, pinned to a commit so the files
 * never change underneath the material classifier.
 */
const KENNEY = 'https://raw.githubusercontent.com/shorepine/kenney/3694c6879e487c108f55677be7dd2ca75b07cc3b/3d/car';
const KENNEY_MODELS = ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'van', 'truck', 'delivery'];

/** Poly Haven HDRIs and Kenney vehicles are CC0; see CREDITS.md. */
const ASSETS = [
  ...KENNEY_MODELS.map((name) => ({
    id: `vehicle-${name}`,
    out: `public/assets/vehicles/kenney/${name}.glb`,
    urls: [`${KENNEY}/${name}.glb`],
    minBytes: 50_000,
  })),
  {
    // The .glb files reference this palette by relative URI.
    id: 'vehicle-palette',
    out: 'public/assets/vehicles/kenney/Textures/colormap.png',
    urls: [`${KENNEY}/Textures/colormap.png`],
    minBytes: 5_000,
  },
  {
    id: 'hdri-golden',
    out: 'public/assets/hdri/golden_hour.hdr',
    urls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/venice_sunset_2k.hdr'],
    minBytes: 1_000_000,
  },
  {
    id: 'hdri-night',
    out: 'public/assets/hdri/night_city.hdr',
    urls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/shanghai_bund_2k.hdr'],
    minBytes: 1_000_000,
  },
  {
    id: 'hdri-showroom',
    out: 'public/assets/hdri/neuer_zollhof.hdr',
    urls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/neuer_zollhof_2k.hdr'],
    minBytes: 1_000_000,
  },
  {
    id: 'hdri-day',
    out: 'public/assets/hdri/day_highway.hdr',
    urls: ['https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr'],
    minBytes: 1_000_000,
  },
];

async function exists(path, minBytes) {
  try {
    return (await stat(path)).size >= minBytes;
  } catch {
    return false;
  }
}

async function download(url, attempts = 3) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw lastError;
}

let failures = 0;
for (const asset of ASSETS) {
  const out = join(root, asset.out);
  if (!force && (await exists(out, asset.minBytes))) {
    console.log(`✓ ${asset.id} (cached)`);
    continue;
  }
  await mkdir(dirname(out), { recursive: true });
  let ok = false;
  for (const url of asset.urls) {
    try {
      const data = await download(url);
      if (data.length < asset.minBytes) throw new Error(`file too small (${data.length} B)`);
      await writeFile(`${out}.part`, data);
      await rename(`${out}.part`, out);
      console.log(`↓ ${asset.id} → ${relative(root, out)} (${(data.length / 1e6).toFixed(1)} MB)`);
      ok = true;
      break;
    } catch (err) {
      console.warn(`! ${asset.id}: ${url} failed: ${err.message}`);
    }
  }
  if (!ok) failures++;
}

// Draco decoder for compressed drop-in models (public/assets/vehicles/custom/*.glb).
const dracoSrc = join(root, 'node_modules/three/examples/jsm/libs/draco/gltf');
const dracoOut = join(root, 'public/assets/draco');
try {
  await mkdir(dracoOut, { recursive: true });
  for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
    await copyFile(join(dracoSrc, f), join(dracoOut, f));
  }
  console.log('✓ draco decoder');
} catch (err) {
  console.warn(`! draco decoder not copied (${err.message}); compressed custom models won't load.`);
}

// Sketchfab models are optional upgrades over the stock bodies, so their
// failures are reported but never fail the build.
await fetchSketchfab(root, { force });

if (failures) {
  console.warn(`${failures} asset(s) missing; the game falls back to procedural substitutes.`);
  if (!soft) process.exit(1);
}
