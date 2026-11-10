import * as THREE from 'three';
import { Rng } from '../core/math';
import type { Materials } from './Materials';

const TERRAIN_SIZE = 4000;
/** Grass texture tile size in meters; terrain snaps to it so texels stay world-anchored. */
export const GRASS_TILE = 12;

const SKYLINE_BEHIND = 300;
const SKYLINE_SPAN = 2600;

interface Building {
  s: number;
  x: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  mesh: number;
  slot: number;
}

/** Roadside ground plane and a recycled instanced city skyline. */
export class Scenery {
  private terrain: THREE.Mesh;
  private skyline: THREE.InstancedMesh[] = [];
  private buildings: Building[] = [];
  private rng = new Rng(4242);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(scene: THREE.Scene, world: THREE.Object3D, mats: Materials, mobile: boolean) {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    geo.rotateX(-Math.PI / 2);
    mats.grass.map!.repeat.set(TERRAIN_SIZE / GRASS_TILE, TERRAIN_SIZE / GRASS_TILE);
    this.terrain = new THREE.Mesh(geo, mats.grass);
    this.terrain.position.y = -0.04;
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const perMesh = mobile ? 24 : 44;
    mats.facades.forEach((mat) => {
      patchFacadeUv(mat);
      const im = new THREE.InstancedMesh(box, mat, perMesh);
      im.frustumCulled = false;
      im.receiveShadow = false;
      world.add(im);
      this.skyline.push(im);
    });
    for (let mesh = 0; mesh < this.skyline.length; mesh++) {
      for (let slot = 0; slot < perMesh; slot++) {
        const b: Building = { s: 0, x: 0, w: 0, d: 0, h: 0, rot: 0, mesh, slot };
        this.respawn(b, -SKYLINE_BEHIND + this.rng.next() * SKYLINE_SPAN);
        this.buildings.push(b);
      }
    }
  }

  private respawn(b: Building, s: number): void {
    const r = this.rng;
    const side = r.chance(0.5) ? 1 : -1;
    const dist = 70 + Math.pow(r.next(), 0.7) * 520;
    b.s = s;
    b.x = side * dist;
    b.w = r.range(18, 55);
    b.d = r.range(18, 50);
    // Close buildings stay low so they never wall in the road.
    const maxH = THREE.MathUtils.lerp(30, 150, THREE.MathUtils.smoothstep(dist, 70, 350));
    b.h = r.range(12, maxH);
    b.rot = r.chance(0.7) ? 0 : r.range(-0.4, 0.4);
    this.p.set(b.x, 0, -b.s);
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.rot);
    this.sc.set(b.w, b.h, b.d);
    this.m.compose(this.p, this.q, this.sc);
    const im = this.skyline[b.mesh];
    im.setMatrixAt(b.slot, this.m);
    im.instanceMatrix.needsUpdate = true;
  }

  update(cameraWorld: THREE.Vector3, s: number): void {
    this.terrain.position.x = Math.round(cameraWorld.x / GRASS_TILE) * GRASS_TILE;
    this.terrain.position.z = Math.round(cameraWorld.z / GRASS_TILE) * GRASS_TILE;
    for (const b of this.buildings) {
      if (b.s < s - SKYLINE_BEHIND) this.respawn(b, b.s + SKYLINE_SPAN);
    }
  }
}

/**
 * Instanced boxes share one unit geometry, so window UVs are rescaled in the
 * vertex shader from each instance's scale (one texture tile = 28 m).
 */
function patchFacadeUv(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
#ifdef USE_INSTANCING
  vec3 iScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec2 faceScale = abs(normal.x) > 0.5 ? iScale.zy : (abs(normal.z) > 0.5 ? iScale.xy : vec2(0.0));
  vec2 facadeUv = uv * faceScale / 28.0 + 0.004;
  vMapUv = facadeUv;
  vEmissiveMapUv = facadeUv;
#endif`,
    );
  };
  mat.customProgramCacheKey = () => 'facade-instanced-v1';
}
