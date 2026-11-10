#!/usr/bin/env node
/**
 * Shrinks a vehicle .glb for the web without breaking what VehicleLoader needs
 * (node names, separate wheel nodes, material names):
 * dedup → prune → weld → simplify to a triangle budget → WebP textures → Meshopt.
 *
 *   node scripts/optimize-glb.mjs <in.glb|scene.gltf> <out.glb> [maxTris] [texSize]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';

export async function createIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
}

function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (prim.getMode() === 4) n += (idx ? idx.getCount() : pos.getCount()) / 3;
    }
  }
  return Math.round(n);
}

export async function optimizeGlb(input, output, { maxTris = 120_000, texSize = 2048 } = {}) {
  const io = await createIO();
  const doc = await io.read(input);
  // Draco input is decoded on read; drop the extension so it isn't re-encoded.
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_draco_mesh_compression')?.dispose();

  const before = triangleCount(doc);
  await doc.transform(dedup(), prune(), weld());
  const welded = triangleCount(doc);
  if (welded > maxTris) {
    // meshoptimizer stops early when the error bound is hit, so loosen it step by step.
    for (const error of [0.001, 0.003, 0.008, 0.02]) {
      const current = triangleCount(doc);
      if (current <= maxTris * 1.05) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTris / current, error }));
    }
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 85 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(output, doc);
  return { before, after: triangleCount(doc) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, maxTris, texSize] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: optimize-glb.mjs <in> <out.glb> [maxTris] [texSize]');
    process.exit(1);
  }
  const r = await optimizeGlb(input, output, { maxTris: Number(maxTris) || undefined, texSize: Number(texSize) || undefined });
  console.log(`${input}: ${r.before} → ${r.after} triangles → ${output}`);
}
