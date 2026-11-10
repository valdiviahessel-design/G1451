import * as THREE from 'three';
import type { RoadStreamer } from '../road/RoadStreamer';

/**
 * A small pool of real spot lights re-assigned every frame to the street
 * lamps nearest the camera. Distant lamps only glow (emissive + bloom), which
 * keeps the forward-rendered light count constant.
 */
export class StreetLightPool {
  private lights: THREE.SpotLight[] = [];
  private lamps: THREE.Vector3[] = [];
  private enabled = false;
  private readonly reach: number;

  constructor(
    scene: THREE.Scene,
    private readonly road: RoadStreamer,
    count: number,
  ) {
    this.reach = count * 50 - 40;
    for (let i = 0; i < count; i++) {
      const l = new THREE.SpotLight(0xffd2a0, 0, 42, 1.05, 0.65, 1.6);
      l.visible = false;
      scene.add(l, l.target);
      this.lights.push(l);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    // Toggling visibility changes the light count and recompiles programs once.
    for (const l of this.lights) l.visible = on;
  }

  update(s: number, origin: number): void {
    if (!this.enabled) return;
    this.road.lampsAhead(s, 30, this.reach, this.lamps);
    this.lights.forEach((light, i) => {
      const lamp = this.lamps[i];
      if (!lamp) {
        light.intensity = 0;
        return;
      }
      const z = -(lamp.z - origin);
      light.position.set(lamp.x, lamp.y - 0.05, z);
      // Aim slightly toward the carriageway so the pool covers the lanes.
      light.target.position.set(lamp.x * 0.55, 0, z);
      light.target.updateMatrixWorld();
      const ahead = lamp.z - s;
      const fade = THREE.MathUtils.smoothstep(this.reach, this.reach - 80, ahead);
      light.intensity = 190 * fade;
    });
  }
}
