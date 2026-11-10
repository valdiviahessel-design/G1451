import * as THREE from 'three';
import { LANE_WIDTH, OPP_INNER } from '../config';
import { Rng } from '../core/math';
import type { GlowSprites } from '../graphics/GlowSprites';
import { simpleCarGeometry, simpleTruckGeometry } from './props';

const PAINTS = [0xdedede, 0x1a1a1c, 0x8c9096, 0x7a1616, 0x23324a, 0xc9c3b4, 0x2f3d33, 0xb8862a, 0x1f5a8a];
/** Cruise speed per lane (inner = fast), m/s. One speed per lane means cars never run into each other. */
const LANE_SPEED = [34, 29, 24];
const BEHIND = 170;

/**
 * Traffic on the opposite carriageway. Purely visual: a couple of instanced
 * draws that streak past beyond the median, with headlight halos at night.
 */
export class Oncoming {
  private readonly cars: THREE.InstancedMesh;
  private readonly trucks: THREE.InstancedMesh;
  private readonly n: number;
  private readonly nTrucks: number;
  private readonly s: Float32Array;
  private readonly lane: Uint8Array;
  private readonly rng = new Rng(977);
  private readonly m = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  /** Furthest spawn point handed out per lane, so newcomers keep their distance. */
  private readonly tail = [0, 0, 0];

  constructor(scene: THREE.Scene, material: THREE.Material, mobile: boolean) {
    this.n = mobile ? 9 : 16;
    this.nTrucks = mobile ? 2 : 4;
    const total = this.n + this.nTrucks;
    this.s = new Float32Array(total);
    this.lane = new Uint8Array(total);
    this.cars = new THREE.InstancedMesh(simpleCarGeometry(), material, this.n);
    this.trucks = new THREE.InstancedMesh(simpleTruckGeometry(), material, this.nTrucks);
    for (const im of [this.cars, this.trucks]) {
      im.frustumCulled = false;
      im.castShadow = true;
      scene.add(im);
    }
    for (let i = 0; i < this.n; i++) this.cars.setColorAt(i, this.color.setHex(PAINTS[i % PAINTS.length]));
    for (let i = 0; i < this.nTrucks; i++) this.trucks.setColorAt(i, this.color.setHex(i % 2 ? 0xd8dadc : 0xb4472c));
  }

  /** Spreads everyone along the visible road (new run or map). */
  reset(playerS: number, viewAhead: number): void {
    this.tail.fill(playerS - BEHIND);
    const total = this.n + this.nTrucks;
    for (let i = 0; i < total; i++) {
      this.lane[i] = i >= this.n ? 2 : this.rng.int(0, 2);
      this.place(i, playerS - BEHIND + ((i + this.rng.next()) / total) * (viewAhead + BEHIND));
    }
  }

  private place(i: number, s: number): void {
    const l = this.lane[i];
    const gap = i >= this.n ? 60 : 26;
    this.s[i] = Math.max(s, this.tail[l] + gap);
    this.tail[l] = this.s[i];
  }

  update(dt: number, playerS: number, origin: number, viewAhead: number, night: boolean, glows: GlowSprites | null): void {
    const total = this.n + this.nTrucks;
    for (let l = 0; l < 3; l++) this.tail[l] -= LANE_SPEED[l] * dt;
    for (let i = 0; i < total; i++) {
      const truck = i >= this.n;
      const l = this.lane[i];
      this.s[i] -= LANE_SPEED[l] * dt;
      if (this.s[i] < playerS - BEHIND) {
        if (!truck) this.lane[i] = this.rng.int(0, 2);
        this.place(i, playerS + viewAhead * this.rng.range(0.85, 1.15));
      }
      const x = OPP_INNER - (this.lane[i] + 0.5) * LANE_WIDTH;
      const z = -(this.s[i] - origin);
      this.m.makeTranslation(x, 0, z);
      (truck ? this.trucks : this.cars).setMatrixAt(truck ? i - this.n : i, this.m);
      if (night && glows) {
        const zf = z + (truck ? 6.9 : 2.3);
        const y = truck ? 1.05 : 0.72;
        glows.add(x - 0.66, y, zf, 2.1, 3.2, 3.0, 2.6);
        glows.add(x + 0.66, y, zf, 2.1, 3.2, 3.0, 2.6);
      }
    }
    this.cars.instanceMatrix.needsUpdate = true;
    this.trucks.instanceMatrix.needsUpdate = true;
  }
}
