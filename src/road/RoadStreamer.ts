import * as THREE from 'three';
import { CHUNK_LENGTH, VIEW_AHEAD, VIEW_BEHIND } from '../config';
import type { Materials } from '../graphics/Materials';
import { RoadChunkBuilder, type RoadChunk } from './RoadChunkBuilder';
import { RoadLayout } from './RoadLayout';

/** Streams road chunks around the camera; builds a bounded number per frame. */
export class RoadStreamer {
  readonly layout: RoadLayout;
  private builder: RoadChunkBuilder;
  private chunks = new Map<number, RoadChunk>();
  private readonly maxBuildsPerFrame = 1;
  private lampCache: THREE.Vector3[] = [];
  private lampsDirty = true;
  /** Streamed road ahead of the player, m (settings → draw distance). */
  viewAhead = VIEW_AHEAD;

  constructor(
    private readonly root: THREE.Object3D,
    mats: Materials,
    seed = 1337,
  ) {
    this.layout = new RoadLayout(seed);
    this.builder = new RoadChunkBuilder(this.layout, mats);
  }

  /** Synchronously fill the view window (used during loading). */
  prime(s: number): void {
    this.update(s, Infinity);
  }

  update(s: number, budget = this.maxBuildsPerFrame): void {
    // Zones must exist well ahead of any chunk so signs and tapers never pop.
    this.layout.ensure(s + VIEW_AHEAD + 1200);
    this.layout.prune(s - VIEW_BEHIND - 200);

    const first = Math.floor((s - VIEW_BEHIND) / CHUNK_LENGTH);
    const last = Math.floor((s + this.viewAhead) / CHUNK_LENGTH);

    for (const [i, chunk] of this.chunks) {
      if (i < first || i > last) {
        chunk.dispose();
        this.chunks.delete(i);
        this.lampsDirty = true;
      }
    }
    let built = 0;
    for (let i = first; i <= last && built < budget; i++) {
      if (this.chunks.has(i)) continue;
      const chunk = this.builder.build(i, i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
      this.root.add(chunk.group);
      this.chunks.set(i, chunk);
      this.lampsDirty = true;
      built++;
    }
  }

  /** Drops every chunk and refills the view (the map's road furniture changed). */
  rebuild(s: number): void {
    for (const chunk of this.chunks.values()) chunk.dispose();
    this.chunks.clear();
    this.lampsDirty = true;
    this.prime(s);
  }

  /** Every streamed lamp in road space (x, y, s), ordered along the road. Rebuilt only when chunks change. */
  get lamps(): readonly THREE.Vector3[] {
    if (this.lampsDirty) {
      this.lampsDirty = false;
      this.lampCache.length = 0;
      for (const chunk of this.chunks.values()) for (const l of chunk.lamps) this.lampCache.push(new THREE.Vector3(l.x, l.y, chunk.s0 - l.z));
      this.lampCache.sort((a, b) => a.z - b.z);
    }
    return this.lampCache;
  }

  /** Lamps in [s - behind, s + ahead], nearest first. */
  lampsAhead(s: number, behind: number, ahead: number, out: THREE.Vector3[] = []): THREE.Vector3[] {
    out.length = 0;
    for (const l of this.lamps) if (l.z >= s - behind && l.z <= s + ahead) out.push(l);
    return out;
  }
}
