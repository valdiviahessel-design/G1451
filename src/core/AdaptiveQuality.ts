/** Lowest render scale the governor may fall to before it asks for a lower quality preset. */
const MIN_SCALE = 0.5;

/**
 * Dynamic resolution: watches the real frame rate and trades pixels for a
 * steady 60 FPS. Steps down quickly when frames are dropped and creeps back up
 * when there is headroom; a step up that costs frames lowers the ceiling for a
 * while, so it settles instead of oscillating. If even the lowest scale can't
 * hold the target, `degrade` is asked to drop the quality preset.
 */
export class AdaptiveQuality {
  enabled = true;
  /** Frame-rate cap from settings (0 = display rate); the target follows it. */
  fpsLimit = 0;
  scale = 1;
  /** Called when the minimum scale still misses the target; return false if nothing is left to lower. */
  degrade: (() => boolean) | null = null;
  private time = 0;
  private frames = 0;
  private calm = 0;
  private settle = 0;
  private ceiling = 1;
  private ceilingAge = 0;
  private triedUp = false;
  private struggling = 0;

  constructor(private readonly apply: (scale: number) => void) {}

  reset(): void {
    this.time = this.frames = this.calm = this.struggling = 0;
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
    // The ceiling left by a failed step up relaxes slowly, in case the load has eased.
    if (this.ceiling < 1 && ++this.ceilingAge >= 90) {
      this.ceilingAge = 0;
      this.ceiling = Math.min(1, this.ceiling + 0.05);
    }
    const target = this.fpsLimit > 0 ? Math.min(60, this.fpsLimit) : 60;
    if (fps < target * 0.965) {
      this.calm = 0;
      if (this.triedUp) {
        this.ceiling = Math.max(MIN_SCALE, this.scale - 0.06);
        this.ceilingAge = 0;
        this.triedUp = false;
      }
      if (this.scale > MIN_SCALE) {
        this.struggling = 0;
        this.set(this.scale - (fps < target * 0.75 ? 0.15 : 0.07));
      } else if (++this.struggling >= 3) {
        this.struggling = 0;
        if (this.degrade?.()) this.settle = 3;
      }
    } else {
      this.struggling = 0;
      this.triedUp = false;
      // Each change reallocates render targets, so steps of a percent or two are not worth taking.
      if (fps >= target * 0.99 && this.scale < this.ceiling - 0.035 && ++this.calm >= 4) {
        this.calm = 0;
        this.triedUp = true;
        this.set(Math.min(this.ceiling, this.scale + 0.06));
      }
    }
  }

  private set(scale: number): void {
    this.scale = Math.min(1, Math.max(MIN_SCALE, Math.round(scale * 100) / 100));
    this.settle = 1;
    this.apply(this.scale);
  }

  /** Back to full resolution (settings changed or the governor was switched off). */
  restore(): void {
    this.reset();
    this.ceiling = 1;
    if (this.scale !== 1) {
      this.scale = 1;
      this.apply(1);
    }
  }
}
