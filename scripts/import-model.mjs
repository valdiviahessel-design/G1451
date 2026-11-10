#!/usr/bin/env node
/**
 * Imports a model downloaded by hand from Sketchfab (no API token needed).
 *
 *   npm run import-model -- <car-id> <file.glb|file.zip|scene.gltf>
 *
 * <car-id> is an id from scripts/sketchfab-models.mjs (samurai, vesta, priora,
 * bavaria, stuttgart, traffic-camry, …). The license is re-checked through the
 * public API, the file is optimized into public/assets/vehicles/sketchfab/<id>.glb
 * and the attribution is recorded in credits.json and CREDITS.md.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeGlb } from './optimize-glb.mjs';
import { SKETCHFAB_MODELS } from './sketchfab-models.mjs';
import { extractArchive, licensedMeta, recordCredit } from './sketchfab.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [id, file] = process.argv.slice(2);
const entry = SKETCHFAB_MODELS.find((m) => m.id === id);
if (!entry || !file) {
  console.error('usage: npm run import-model -- <car-id> <file.glb|file.zip|scene.gltf>');
  console.error(`car ids: ${SKETCHFAB_MODELS.map((m) => m.id).join(', ')}`);
  process.exit(1);
}

const meta = await licensedMeta(entry.uid);
const work = await mkdtemp(join(tmpdir(), `import-${id}-`));
try {
  const input = /\.zip$/i.test(file) ? await extractArchive(new Uint8Array(await readFile(file)), work) : file;
  const out = join(root, 'public/assets/vehicles/sketchfab', `${id}.glb`);
  const r = await optimizeGlb(input, out, { maxTris: entry.maxTris, texSize: entry.texSize });
  await recordCredit(root, id, meta);
  const size = (await stat(out)).size / 1e6;
  console.log(`✓ ${id}: "${meta.name}" by ${meta.user.username} (${meta.license.label}), ${r.before} → ${r.after} tris, ${size.toFixed(1)} MB`);
} finally {
  await rm(work, { recursive: true, force: true });
}
