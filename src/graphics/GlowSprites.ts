import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Additive light halos (tail lights of distant traffic, oncoming headlights,
 * street lamps) drawn as one instanced mesh that is refilled every frame.
 * Quads face +z: the road is straight, so that is always toward the camera.
 */
export class GlowSprites {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  /** Scene fog density, so halos fade with distance (additive sprites can't use scene fog). */
  fog = 0;
  private camZ = 0;

  constructor(texture: THREE.Texture, private readonly capacity = 256) {
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.setColorAt(0, _c.setRGB(0, 0, 0));
    this.mesh.count = 0;
  }

  begin(cameraZ: number): void {
    this.n = 0;
    this.camZ = cameraZ;
  }

  /** Scene-space position, size in metres, linear HDR colour. */
  add(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void {
    if (this.n >= this.capacity) return;
    const d = (this.camZ - z) * this.fog;
    const k = Math.exp(-d * d);
    if (k < 0.02) return;
    _m.makeScale(size, size, 1).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, _m);
    this.mesh.setColorAt(this.n, _c.setRGB(r * k, g * k, b * k));
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
