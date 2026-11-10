import * as THREE from 'three';
import type { VehicleModel } from '../assets/VehicleLoader';

/**
 * Far-distance stand-in for a traffic model: every mesh of the car baked into
 * one vertex-coloured geometry, so all distant cars of a type draw in a single
 * instanced call. `aPaint` marks body panels, which take the instance colour.
 */
export interface TrafficLod {
  /** Full-detail merge: used for shadow casting, where a coarser hull would self-shadow the real model. */
  full: THREE.BufferGeometry;
  /** Decimated version for the colour pass. */
  far: THREE.BufferGeometry;
}

const FAR_TRIANGLES = 1600;

interface Raw {
  pos: number[];
  col: number[];
  paint: number[];
}

const texCache = new WeakMap<object, { data: Uint8ClampedArray; w: number; h: number } | null>();

function pixels(tex: THREE.Texture): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  let p = texCache.get(img);
  if (p === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = Math.min(64, img.width);
      c.height = Math.min(64, img.height);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, c.width, c.height);
      p = { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    } catch {
      p = null;
    }
    texCache.set(img, p);
  }
  return p;
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _t = new THREE.Color();

function collect(model: VehicleModel): Raw {
  const raw: Raw = { pos: [], col: [], paint: [] };
  const mats = model.materials;
  const lights = mats.lights;
  model.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const position = geo.attributes.position;
    const uv = geo.attributes.uv;
    const index = geo.index;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    for (const grp of groups) {
      const mat = list[Math.min(grp.materialIndex ?? 0, list.length - 1)] as THREE.MeshStandardMaterial;
      // Skip helpers (contact shadow, indicator boxes) and clear lamp covers.
      if ((mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial) continue;
      if (mat === lights.lens || mat === lights.taillens) continue;
      const isPaint = mat === mats.paint;
      const tex = !isPaint && mat.map ? pixels(mat.map) : null;
      if (isPaint) _c.setRGB(1, 1, 1);
      else if (mat === mats.glass) _c.setRGB(0.02, 0.025, 0.03);
      else if (mat === lights.tail || mat === lights.taillamp) _c.setRGB(0.45, 0.02, 0.02);
      else if (mat === lights.head || mat === lights.headlamp) _c.setRGB(0.85, 0.85, 0.8);
      else _c.copy(mat.color ?? _t.setRGB(0.3, 0.3, 0.3));
      const end = Math.min(grp.start + grp.count, index ? index.count : position.count);
      for (let i = grp.start; i < end; i++) {
        const vi = index ? index.getX(i) : i;
        _v.fromBufferAttribute(position, vi).applyMatrix4(rel);
        raw.pos.push(_v.x, _v.y, _v.z);
        if (tex && uv) {
          const u = uv.getX(vi) - Math.floor(uv.getX(vi));
          const v = uv.getY(vi) - Math.floor(uv.getY(vi));
          // glTF textures are not flipped: v runs down the image.
          const px = Math.min(tex.w - 1, Math.floor(u * tex.w));
          const py = Math.min(tex.h - 1, Math.floor(v * tex.h));
          const k = (py * tex.w + px) * 4;
          _t.setRGB(tex.data[k] / 255, tex.data[k + 1] / 255, tex.data[k + 2] / 255, THREE.SRGBColorSpace).multiply(_c);
          raw.col.push(_t.r, _t.g, _t.b);
        } else raw.col.push(_c.r, _c.g, _c.b);
        raw.paint.push(isPaint ? 1 : 0);
      }
    }
  });
  return raw;
}

function toGeometry(pos: ArrayLike<number>, col: ArrayLike<number>, paint: ArrayLike<number>, index?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 1));
  if (index) g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Vertex clustering on a uniform grid: robust on any triangle soup and plenty for a car 100 m away. */
function decimate(raw: Raw, target: number): THREE.BufferGeometry {
  const n = raw.pos.length / 3;
  const box = new THREE.Box3().setFromArray(raw.pos);
  const size = box.getSize(new THREE.Vector3());
  let lo = 0.01;
  let hi = Math.max(size.x, size.y, size.z) / 4;
  let best: { index: number[]; rep: Map<number, number> } | null = null;
  for (let iter = 0; iter < 9; iter++) {
    const cell = (lo + hi) / 2;
    const rep = new Map<number, number>();
    const map = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const kx = Math.floor((raw.pos[i * 3] - box.min.x) / cell);
      const ky = Math.floor((raw.pos[i * 3 + 1] - box.min.y) / cell);
      const kz = Math.floor((raw.pos[i * 3 + 2] - box.min.z) / cell);
      // Paint and trim never share a cluster, so body colour keeps a clean edge.
      const key = ((kx * 1024 + ky) * 1024 + kz) * 2 + raw.paint[i];
      let r = rep.get(key);
      if (r === undefined) {
        r = i;
        rep.set(key, r);
      }
      map[i] = r;
    }
    const index: number[] = [];
    for (let i = 0; i < n; i += 3) {
      const a = map[i];
      const b = map[i + 1];
      const c = map[i + 2];
      if (a !== b && b !== c && a !== c) index.push(a, b, c);
    }
    if (index.length / 3 > target) lo = cell;
    else {
      hi = cell;
      best = { index, rep };
    }
  }
  if (!best) return toGeometry(raw.pos, raw.col, raw.paint);
  // Compact to the vertices the kept triangles use.
  const remap = new Map<number, number>();
  const pos: number[] = [];
  const col: number[] = [];
  const paint: number[] = [];
  const index = best.index.map((v) => {
    let k = remap.get(v);
    if (k === undefined) {
      k = remap.size;
      remap.set(v, k);
      pos.push(raw.pos[v * 3], raw.pos[v * 3 + 1], raw.pos[v * 3 + 2]);
      col.push(raw.col[v * 3], raw.col[v * 3 + 1], raw.col[v * 3 + 2]);
      paint.push(raw.paint[v]);
    }
    return k;
  });
  return toGeometry(pos, col, paint, index);
}

/** Bakes the LOD pair for a freshly instantiated model (root at the origin, wheels straight). */
export function bakeTrafficLod(model: VehicleModel): TrafficLod {
  const raw = collect(model);
  const full = toGeometry(raw.pos, raw.col, raw.paint);
  const tris = raw.pos.length / 9;
  return { full, far: tris > FAR_TRIANGLES * 1.5 ? decimate(raw, FAR_TRIANGLES) : full };
}

/** Lit material for the far LOD: only `aPaint` vertices take the per-instance body colour. */
export function createLodMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPaint;')
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(color.rgb, 1.0);
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aPaint);
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'traffic-lod';
  return mat;
}
