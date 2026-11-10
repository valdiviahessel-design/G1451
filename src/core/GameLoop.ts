export interface LoopCallbacks {
  /** Fixed-rate simulation step (physics, traffic). */
  fixedUpdate?: (dt: number) => void;
  /** Per-frame update with interpolation alpha between fixed steps. */
  update: (dt: number, alpha: number) => void;
  render: () => void;
}

/**
 * requestAnimationFrame loop with a fixed-timestep accumulator so vehicle
 * physics stays deterministic regardless of display refresh rate.
 */
export class GameLoop {
  readonly fixedDt = 1 / 120;
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;
  fps = 0;
  /** Frames per second cap, 0 = display rate. */
  fpsLimit = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    // Frame cap: skip vsync ticks until the interval has passed (2 ms slack for jitter).
    if (this.fpsLimit > 0 && now - this.last < 1000 / this.fpsLimit - 2) return;

    // Clamp so a background tab or GC pause never explodes the simulation.
    // The first rAF timestamp can precede start(), so clamp below too.
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.1);
    this.last = now;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (this.cb.fixedUpdate) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 12) {
        this.cb.fixedUpdate(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps === 12) this.accumulator = 0;
    }

    this.cb.update(dt, this.accumulator / this.fixedDt);
    this.cb.render();
  };
}
