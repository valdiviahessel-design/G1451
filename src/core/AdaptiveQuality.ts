/** Lowest render scale the governor may fall to. */
const MIN_SCALE = 0.55;

/**
 * Dynamic resolution: watches the real frame rate and trades pixels for a
 * steady 60 FPS. Steps down quickly when frames are dropped, creeps back up
 * when there is headroom, and backs off after a failed attempt to go up so it
 * never oscillates.
 */
export class AdaptiveQuality {
  enabled = true;
  /** Frame-rate cap from settings (0 = display rate); the target follows it. */
  fpsLimit = 0;
  scale = 1;
  private time = 0;
  private frames = 0;
  private calm = 0;
  private settle = 0;
  private upWait = 4;
  private triedUp = false;

  constructor(private readonly apply: (scale: number) => void) {}

  reset(): void {
    this.time = this.frames = this.calm = 0;
    this.settle = 2;
  }

  /** Call once per rendered frame with the real frame time in seconds. */
  tick(dt: number): void {
    if (!this.enabled) return;
    // Tab switches and loading hitches say nothing about rendering cost.
    if (dt > 0.2) {
      this.reset();
      return;
    }
    this.time += dt;
    this.frames++;
    if (this.time < 1) return;
    const fps = this.frames / this.time;
    this.time = this.frames = 0;
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    const target = this.fpsLimit > 0 ? Math.min(60, this.fpsLimit) : 60;
    if (fps < target * 0.93) {
      this.calm = 0;
      if (this.scale <= MIN_SCALE) return;
      // A step up that immediately cost frames: wait longer before trying again.
      if (this.triedUp) this.upWait = Math.min(60, this.upWait * 2);
      this.triedUp = false;
      this.set(this.scale - (fps < target * 0.75 ? 0.15 : 0.08));
    } else if (fps >= target * 0.985 && this.scale < 1) {
      if (++this.calm >= this.upWait) {
        this.calm = 0;
        this.triedUp = true;
        this.set(this.scale + 0.07);
      }
    } else this.triedUp = false;
  }

  private set(scale: number): void {
    this.scale = Math.min(1, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
    this.settle = 1;
    this.apply(this.scale);
  }

  /** Back to full resolution (settings changed or the governor was switched off). */
  restore(): void {
    this.reset();
    if (this.scale !== 1) {
      this.scale = 1;
      this.apply(1);
    }
  }
}
