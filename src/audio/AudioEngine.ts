/**
 * Procedural car audio (Web Audio, no samples): a firing-order engine synth
 * driven by a simulated gearbox, plus tyres, wind, traffic pass-bys, impacts
 * and score cues. Everything is built from oscillators and one noise buffer,
 * so it costs nothing to download.
 */

interface EngineProfile {
  cylinders: number;
  idle: number;
  redline: number;
  gears: number;
  turbo: number;
  /** 0 smooth … 1 raspy: drive into the waveshaper and the rasp layer. */
  grit: number;
  /** Overrun pops/crackles on lift-off (0..1). */
  crackle: number;
  /** Continuously variable transmission (no shifts). */
  cvt?: boolean;
  /** Extra electric whine (hybrid). */
  whine?: number;
}

const PROFILES: Record<string, EngineProfile> = {
  zhiga: { cylinders: 4, idle: 850, redline: 6000, gears: 4, turbo: 0, grit: 0.9, crackle: 0.1 },
  prius: { cylinders: 4, idle: 1000, redline: 5200, gears: 1, turbo: 0, grit: 0.2, crackle: 0, cvt: true, whine: 0.6 },
  camry: { cylinders: 6, idle: 700, redline: 6600, gears: 6, turbo: 0, grit: 0.3, crackle: 0 },
  e34: { cylinders: 6, idle: 750, redline: 6500, gears: 5, turbo: 0, grit: 0.45, crackle: 0.2 },
  samurai: { cylinders: 6, idle: 800, redline: 7200, gears: 5, turbo: 0.8, grit: 0.55, crackle: 0.4 },
  sl300: { cylinders: 6, idle: 750, redline: 6200, gears: 4, turbo: 0, grit: 0.6, crackle: 0.3 },
  evo: { cylinders: 4, idle: 900, redline: 7000, gears: 5, turbo: 1, grit: 0.7, crackle: 0.8 },
  r34: { cylinders: 6, idle: 850, redline: 7600, gears: 6, turbo: 0.9, grit: 0.55, crackle: 0.6 },
  supra: { cylinders: 6, idle: 800, redline: 7000, gears: 6, turbo: 1, grit: 0.5, crackle: 0.5 },
  m4: { cylinders: 6, idle: 800, redline: 7300, gears: 8, turbo: 0.7, grit: 0.6, crackle: 0.7 },
};

export interface AudioFrame {
  speed: number;
  topSpeed: number;
  throttle: number;
  brake: number;
  /** Tyre slip 0..1 (cornering at the grip limit, wheelspin). */
  slip: number;
  /** Closest traffic car: signed lateral offset and longitudinal distance (m), or null. */
  traffic: { dx: number; ds: number; v: number } | null;
  /** Engine state from the physics gearbox; without it the sound runs its own gearbox. */
  engine?: { rpm: number; gear: number; shifting: boolean };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private profile: EngineProfile = PROFILES.camry;
  private volume = 0.8;
  private muted = false;

  // Engine graph.
  private oscMain!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private oscAm!: OscillatorNode;
  private rasp!: BiquadFilterNode;
  private raspGain!: GainNode;
  private shaper!: WaveShaperNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private turboOsc!: OscillatorNode;
  private turboGain!: GainNode;
  private whineOsc!: OscillatorNode;
  private whineGain!: GainNode;
  // Ambience.
  private tyreFilter!: BiquadFilterNode;
  private tyreGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private passFilter!: BiquadFilterNode;
  private passGain!: GainNode;
  private passPan!: StereoPannerNode;

  // Drivetrain state.
  private gear = 1;
  private rpm = 900;
  private shiftT = 0;
  private load = 0;
  private boost = 0;
  private lastThrottle = 0;
  private crackleT = 0;

  /** Creates the context; call from a user gesture (browsers block autoplay). */
  unlock(): void {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyMaster();
  }

  /** Ads, hidden tab, pause menu. */
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  setCar(id: string): void {
    this.profile = PROFILES[id] ?? PROFILES.camry;
    this.gear = 1;
    if (this.ctx) this.oscMain.setPeriodicWave(this.engineWave());
  }

  private applyMaster(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private build(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // --- Engine: harmonic "firing" wave + sub + rasp noise pulsed at the firing rate.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.9;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.master);

    const mix = ctx.createGain();
    mix.gain.value = 0.55;
    mix.connect(this.shaper);
    this.oscMain = ctx.createOscillator();
    this.oscMain.setPeriodicWave(this.engineWave());
    this.oscMain.connect(mix);
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'triangle';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    this.oscSub.connect(subGain).connect(mix);

    this.rasp = ctx.createBiquadFilter();
    this.rasp.type = 'bandpass';
    this.rasp.Q.value = 1.4;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.loopNoise().connect(this.rasp).connect(this.raspGain).connect(mix);
    // Amplitude-modulate the rasp at the firing frequency so it pulses like exhaust.
    this.oscAm = ctx.createOscillator();
    this.oscAm.type = 'square';
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0.18;
    this.oscAm.connect(amDepth).connect(this.raspGain.gain);

    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain).connect(this.master);

    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sine';
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.master);

    // --- Tyres, wind, road rumble, traffic pass-by.
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = 'bandpass';
    this.tyreFilter.frequency.value = 1100;
    this.tyreFilter.Q.value = 6;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.loopNoise().connect(this.tyreFilter).connect(this.tyreGain).connect(this.master);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 600;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.loopNoise().connect(rumble).connect(this.rumbleGain).connect(this.master);

    this.passFilter = ctx.createBiquadFilter();
    this.passFilter.type = 'bandpass';
    this.passFilter.Q.value = 0.7;
    this.passGain = ctx.createGain();
    this.passGain.gain.value = 0;
    this.passPan = ctx.createStereoPanner();
    this.loopNoise().connect(this.passFilter).connect(this.passGain).connect(this.passPan).connect(this.master);

    for (const o of [this.oscMain, this.oscSub, this.oscAm, this.turboOsc, this.whineOsc]) o.start();
    this.setShaperDrive(this.profile.grit);
    this.applyMaster();
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  /** Harmonic recipe: firing order dominates; 4-cylinders get a buzzy 2nd, 6-cylinders a smooth 3rd. */
  private engineWave(): PeriodicWave {
    const ctx = this.ctx!;
    const n = 24;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const p = this.profile;
    // The oscillator runs at half the firing rate so half-orders (uneven pulses) exist.
    for (let k = 1; k < n; k++) {
      const order = k / 2;
      let a = 1 / Math.pow(k, 0.9);
      if (k % 2 === 0) a *= 2.2; // whole firing orders
      else a *= 0.25 + p.grit * 0.5; // half-orders: lumpiness
      if (p.cylinders === 6 && k === 6) a *= 1.6;
      if (p.cylinders === 4 && k === 4) a *= 1.5;
      if (order > 6) a *= 0.6;
      im[k] = a;
    }
    return ctx.createPeriodicWave(re, im);
  }

  private setShaperDrive(grit: number): void {
    const k = 1.5 + grit * 6;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    this.shaper.curve = curve;
  }

  /** Simple gearbox: ratios spread so top gear meets the top speed at ~95 % redline. */
  private gearboxRpm(speed: number, top: number, throttle: number, dt: number): number {
    const p = this.profile;
    if (p.cvt) {
      // CVT holds revs by load, not by road speed.
      const target = p.idle + (p.redline * 0.75 - p.idle) * (0.25 + 0.75 * throttle) * clamp01(speed / (top * 0.3) + 0.2);
      return target;
    }
    const v01 = clamp01(speed / top);
    // Geometric progression of per-gear top speeds.
    const gearTop = (g: number) => Math.pow(g / p.gears, 0.75);
    const rpmIn = (g: number) => p.idle * 0.9 + (p.redline * 0.95 - p.idle * 0.9) * (v01 / gearTop(g));
    if (this.shiftT > 0) this.shiftT -= dt;
    const r = rpmIn(this.gear);
    const upAt = throttle > 0.5 ? p.redline * 0.93 : p.redline * 0.62;
    if (r > upAt && this.gear < p.gears && this.shiftT <= 0) {
      this.gear++;
      this.shiftT = 0.35;
      this.onShift(throttle);
    } else if (this.gear > 1 && rpmIn(this.gear - 1) < p.redline * (throttle > 0.5 ? 0.78 : 0.5) && this.shiftT <= 0) {
      this.gear--;
      this.shiftT = 0.35;
    }
    return Math.min(p.redline * 1.02, rpmIn(this.gear));
  }

  private onShift(throttle: number): void {
    if (this.profile.turbo > 0 && this.boost > 0.35 && throttle > 0.5) this.blowOff(this.boost);
  }

  update(dt: number, f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const p = this.profile;
    const tc = 0.035;

    let targetRpm: number;
    if (f.engine) {
      if (f.engine.gear > this.gear) this.onShift(f.throttle);
      this.gear = f.engine.gear;
      this.shiftT = f.engine.shifting ? 0.3 : 0;
      targetRpm = f.engine.rpm;
    } else {
      targetRpm = this.gearboxRpm(f.speed, f.topSpeed, f.throttle, dt);
    }
    // Revs flare on throttle and sag on shifts; the flywheel smooths them.
    const shiftCut = this.shiftT > 0.2 && !p.cvt;
    this.rpm += (targetRpm + f.throttle * 180 - this.rpm) * Math.min(1, dt * (shiftCut ? 14 : 7));
    this.load += ((shiftCut ? 0.05 : f.throttle) - this.load) * Math.min(1, dt * 9);
    const fire = (this.rpm / 60) * (p.cylinders / 2);

    this.oscMain.frequency.setTargetAtTime(fire / 2, t, tc);
    this.oscSub.frequency.setTargetAtTime(fire / 2, t, tc);
    this.oscAm.frequency.setTargetAtTime(fire, t, tc);
    this.rasp.frequency.setTargetAtTime(Math.min(6000, fire * 3.2), t, tc);
    this.raspGain.gain.setTargetAtTime((0.05 + 0.25 * p.grit) * (0.3 + this.load), t, tc);

    const rev01 = clamp01((this.rpm - p.idle) / (p.redline - p.idle));
    const cutoff = 260 + rev01 * 1800 + this.load * (1400 + 2200 * p.grit);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, tc);
    // Loud under load, quieter on overrun; the ceiling keeps the compressor from pumping.
    const vol = (0.13 + 0.12 * rev01) * (0.45 + 0.55 * this.load);
    this.engineGain.gain.setTargetAtTime(vol, t, tc);

    // Turbo spools with load × revs, whistles, blows off on lift.
    const spool = p.turbo * clamp01(this.load * 1.2) * clamp01((this.rpm - p.redline * 0.35) / (p.redline * 0.4));
    this.boost += (spool - this.boost) * Math.min(1, dt * (spool > this.boost ? 1.8 : 6));
    this.turboOsc.frequency.setTargetAtTime(1800 + this.boost * 5200, t, tc);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.018, t, tc);
    if (this.lastThrottle > 0.6 && f.throttle < 0.2 && this.boost > 0.4) this.blowOff(this.boost);

    // Overrun crackles: lift-off at high revs.
    if (p.crackle > 0 && f.throttle < 0.1 && rev01 > 0.35) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) {
        this.crackleT = 0.04 + Math.random() * 0.22;
        if (Math.random() < p.crackle * 0.6) this.pop(0.18 + Math.random() * 0.25);
      }
    }
    this.lastThrottle = f.throttle;

    if (p.whine) {
      this.whineOsc.frequency.setTargetAtTime(600 + f.speed * 45, t, tc);
      this.whineGain.gain.setTargetAtTime(p.whine * 0.012 * clamp01(f.speed / 20) * (0.4 + f.throttle), t, tc);
    }

    // Tyres: squeal pitch rises with slip; a low hiss always accompanies speed.
    const slip = clamp01(f.slip);
    this.tyreFilter.frequency.setTargetAtTime(850 + slip * 650, t, 0.08);
    this.tyreGain.gain.setTargetAtTime(slip > 0.25 ? (slip - 0.25) * 0.5 : 0, t, 0.06);
    const v = clamp01(f.speed / 80);
    this.windFilter.frequency.setTargetAtTime(350 + v * 1600, t, 0.2);
    this.windGain.gain.setTargetAtTime(v * v * 0.16, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(0.03 + v * 0.16, t, 0.2);

    // Pass-by whoosh from the closest car: louder and brighter as it sweeps past the doors.
    if (f.traffic) {
      const { dx, ds } = f.traffic;
      const d = Math.hypot(dx * 1.6, ds);
      const near = clamp01(1 - d / 22);
      const rel = Math.abs(f.speed - f.traffic.v);
      this.passGain.gain.setTargetAtTime(near * near * (0.08 + clamp01(rel / 30) * 0.35), t, 0.05);
      this.passFilter.frequency.setTargetAtTime(400 + near * 1400 + (ds > 0 ? 300 : 0), t, 0.05);
      this.passPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, dx / 3)), t, 0.05);
    } else {
      this.passGain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  // ---------------------------------------------------------------- one-shots

  private burst(dur: number, filterType: BiquadFilterType, freq: number, q: number, gain: number, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.sfx);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', at = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private blowOff(boost: number): void {
    this.burst(0.35 + boost * 0.2, 'bandpass', 2400, 1.2, 0.12 * boost);
  }

  private pop(strength: number): void {
    this.burst(0.06, 'lowpass', 900, 0.8, strength);
    this.tone(70 + Math.random() * 40, 0.08, strength * 0.6, 'square');
  }

  /** Metal-on-metal: a thump plus a crunchy band of noise, scaled by closing speed. */
  impact(speed: number, pan = 0): void {
    const s = clamp01(speed / 15);
    if (s < 0.03) return;
    this.tone(55 + s * 30, 0.25 + s * 0.3, 0.25 + s * 0.5, 'sine', 0, 30);
    this.burst(0.18 + s * 0.5, 'bandpass', 1500 + Math.random() * 1500, 0.9, 0.2 + s * 0.6, pan);
    this.burst(0.5 + s * 0.6, 'highpass', 4000, 0.5, 0.05 + s * 0.15, pan);
  }

  /** Guardrail scrape: short gritty burst. */
  scrape(speed: number, pan: number): void {
    this.burst(0.25, 'bandpass', 2600, 2.5, clamp01(speed / 10) * 0.35, pan);
  }

  nearMiss(crazy: boolean, pan: number): void {
    this.burst(0.35, 'bandpass', 900, 0.6, 0.35, pan);
    this.tone(crazy ? 1320 : 990, 0.18, 0.12, 'triangle', 0.02);
    this.tone(crazy ? 1760 : 1320, 0.22, 0.1, 'triangle', 0.09);
  }

  squeeze(): void {
    [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, 0.25, 0.11, 'triangle', i * 0.06));
  }

  comboLost(): void {
    this.tone(520, 0.35, 0.08, 'sawtooth', 0, 260);
  }

  click(): void {
    this.tone(1400, 0.05, 0.06, 'triangle');
  }
}
