import type { ScoreEvent } from '../gameplay/Scoring';
import { ICONS } from './icons';

export interface HudState {
  speedKmh: number;
  fps: number;
  showFps: boolean;
  laneLabel: string;
  pocketInfo: string;
  score: number;
  multiplier: number;
  /** 0..1 of the combo timer left. */
  comboLeft: number;
  km: number;
  /** Engine speed 0..1 of the redline. */
  rpm01: number;
  gear: string;
  abs: boolean;
  esp: boolean;
  tcs: boolean;
  /** Nitro charge 0..1; undefined hides the meter. */
  nitro01?: number;
  nitroActive?: boolean;
}

export type TouchAction = 'throttle' | 'brake' | 'left' | 'right' | 'nitro';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const dec = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const POPUP: Record<string, string> = {
  near: 'Опасный обгон',
  crazy: 'На волосок!',
  squeeze: 'Между машин!',
  crash: 'Комбо потеряно',
};

const TIPS = [
  'Проходите вплотную к машинам — множитель комбо растёт',
  'Держите нитро для свободной полосы: Пробел',
  'Чем выше скорость при обгоне, тем больше очков',
  'Следите за сужениями: карманы закрываются',
];

/** Tachometer arc: 270° sweep (from bottom-left, clockwise) drawn as an SVG stroke. */
const ARC_LEN = 2 * Math.PI * 44 * (270 / 360);

/** DOM overlay: loading screen, speedometer, score/combo, event popups, touch controls. */
export class Hud {
  private root: HTMLElement;
  private loader: HTMLElement;
  private loaderBar: HTMLElement;
  private loaderLabel: HTMLElement;
  private loaderPct: HTMLElement;
  private speed: HTMLElement;
  private gear: HTMLElement;
  private rpmArc: SVGCircleElement;
  private car: HTMLElement;
  private score: HTMLElement;
  private mult: HTMLElement;
  private comboBar: HTMLElement;
  private km: HTMLElement;
  private popups: HTMLElement;
  private bannerEl: HTMLElement;
  private bannerTimer = 0;
  private nitro: HTMLElement;
  private nitroBar: HTMLElement;
  private chips: Record<'lane' | 'pocket' | 'fps', HTMLElement>;
  private lamps: Record<'abs' | 'esp' | 'tcs', HTMLElement>;
  private visible = true;
  /** Last values written to the DOM: update() runs 20×/s and must only touch what changed. */
  private last: Record<string, string | number | boolean> = {};
  onPause: () => void = () => {};
  onTouch: (action: TouchAction, down: boolean) => void = () => {};
  onShift: (dir: 1 | -1) => void = () => {};

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="loader" id="loader">
         <div class="loader__brand">
           <div class="loader__title">Городской поток</div>
           <div class="loader__sub"><i></i><span>Шашки</span><i></i></div>
         </div>
         <div class="loader__progress">
           <div class="loader__track"><div class="loader__bar"></div></div>
           <div class="loader__meta"><span class="loader__label">Загрузка…</span><b class="loader__pct">0%</b></div>
         </div>
         <div class="loader__tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
       </div>
       <div class="hud hud--hidden" id="hud">
         <div class="hud__car"><b></b><small></small></div>
         <div class="hud__score">
           <div class="hud__score-main"><b>0</b><span class="hud__mult">×1,00</span></div>
           <i class="hud__combo"><u></u></i>
           <div class="hud__km">${ICONS.road}<span>0,00 км</span></div>
         </div>
         <div class="hud__banner" aria-live="polite"></div>
         <div class="hud__popups"></div>
         <div class="hud__cluster">
           <div class="hud__aux">
             <div class="gauge__lamps"><span data-lamp="abs">ABS</span><span data-lamp="esp">ESP</span><span data-lamp="tcs">TCS</span></div>
             <div class="nitro" hidden>${ICONS.flame}<i class="nitro__track"><u></u></i><small>Нитро</small></div>
           </div>
           <div class="gauge">
             <svg class="gauge__svg" viewBox="0 0 100 100" aria-hidden="true">
               <circle class="gauge__ticks" cx="50" cy="50" r="37" />
               <circle class="gauge__track" cx="50" cy="50" r="44" />
               <circle class="gauge__rpm" cx="50" cy="50" r="44" />
               <circle class="gauge__red" cx="50" cy="50" r="44" />
             </svg>
             <div class="gauge__speed"><b>0</b><small>км/ч</small></div>
             <div class="gauge__gear">N</div>
           </div>
         </div>
         <div class="hud__info">
           <span class="hud-chip hud-chip--lane" hidden>${ICONS.road}<span></span></span>
           <span class="hud-chip hud-chip--warn" hidden>${ICONS.alert}<span></span></span>
           <span class="hud-chip hud-chip--fps" hidden><span></span></span>
         </div>
         <button class="hud__pause" aria-label="Пауза">${ICONS.pause}</button>
         <div class="touch">
           <button class="touch__btn touch__left" data-t="left" aria-label="Влево">${ICONS.left}</button>
           <button class="touch__btn touch__right" data-t="right" aria-label="Вправо">${ICONS.right}</button>
           <button class="touch__btn touch__brake" data-t="brake" aria-label="Тормоз"><span>Тормоз</span></button>
           <button class="touch__btn touch__gas" data-t="throttle" aria-label="Газ"><span>Газ</span></button>
           <button class="touch__btn touch__nitro" data-t="nitro" aria-label="Нитро">${ICONS.flame}</button>
           <button class="touch__shift touch__shift--up" data-shift="1" aria-label="Передача вверх">+</button>
           <button class="touch__shift touch__shift--down" data-shift="-1" aria-label="Передача вниз">−</button>
         </div>
       </div>`,
    );
    this.loader = parent.querySelector('#loader')!;
    this.loaderBar = this.loader.querySelector('.loader__bar')!;
    this.loaderLabel = this.loader.querySelector('.loader__label')!;
    this.loaderPct = this.loader.querySelector('.loader__pct')!;
    this.root = parent.querySelector('#hud')!;
    const q = <T extends Element = HTMLElement>(s: string) => this.root.querySelector<T & Element>(s)! as T;
    this.speed = q('.gauge__speed b');
    this.gear = q('.gauge__gear');
    this.rpmArc = q<SVGCircleElement>('.gauge__rpm');
    this.car = q('.hud__car');
    this.score = q('.hud__score-main b');
    this.mult = q('.hud__mult');
    this.comboBar = q('.hud__combo u');
    this.km = q('.hud__km span');
    this.popups = q('.hud__popups');
    this.bannerEl = q('.hud__banner');
    this.nitro = q('.nitro');
    this.nitroBar = q('.nitro__track u');
    this.chips = { lane: q('.hud-chip--lane'), pocket: q('.hud-chip--warn'), fps: q('.hud-chip--fps') };
    this.lamps = { abs: q('[data-lamp="abs"]'), esp: q('[data-lamp="esp"]'), tcs: q('[data-lamp="tcs"]') };
    this.rpmArc.style.strokeDasharray = `0 999`;
    q('.hud__pause').addEventListener('click', () => this.onPause());

    // Pedals: pointer events cover touch and mouse; multi-touch works since each button tracks its own pointer.
    for (const btn of this.root.querySelectorAll<HTMLElement>('.touch__btn')) {
      const action = btn.dataset.t as TouchAction;
      let held = false;
      const set = (down: boolean) => {
        if (down === held) return;
        held = down;
        btn.classList.toggle('touch__btn--on', down);
        this.onTouch(action, down);
      };
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    for (const btn of this.root.querySelectorAll<HTMLElement>('.touch__shift')) {
      btn.addEventListener('pointerdown', () => this.onShift(Number(btn.dataset.shift) as 1 | -1));
    }
    if (matchMedia('(pointer: coarse)').matches) this.root.classList.add('hud--touch');
  }

  progress(label: string, value: number): void {
    const pct = Math.round(clamp01(value) * 100);
    this.loaderLabel.textContent = label;
    this.loaderPct.textContent = `${pct}%`;
    this.loaderBar.style.transform = `scaleX(${pct / 100})`;
  }

  hideLoader(): void {
    this.loader.classList.add('loader--done');
    setTimeout(() => this.loader.remove(), 700);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  setPlaying(on: boolean): void {
    this.root.classList.toggle('hud--hidden', !on);
    if (!on) {
      this.popups.replaceChildren();
      this.clearBanner();
    }
  }

  /** Manual gearbox shows the touch shift buttons. */
  setManual(on: boolean): void {
    this.root.classList.toggle('hud--manual', on);
  }

  /** Red zone of the tachometer starts at this fraction of the scale. */
  setRedline(from01: number): void {
    const red = this.root.querySelector<SVGCircleElement>('.gauge__red')!;
    red.style.strokeDasharray = `${ARC_LEN * (1 - from01)} 999`;
    red.style.strokeDashoffset = `${-ARC_LEN * from01}`;
  }

  setCar(name: string, tagline: string): void {
    this.car.querySelector('b')!.textContent = name;
    this.car.querySelector('small')!.textContent = tagline;
  }

  event(e: ScoreEvent): void {
    const label = POPUP[e.kind];
    if (!label) return;
    const el = document.createElement('div');
    el.className = `popup popup--${e.kind}`;
    el.innerHTML =
      e.kind === 'crash'
        ? `<b>${label}</b>`
        : `<b>${label}</b><span>+${fmt(e.points)}</span><small>${e.kind === 'squeeze' ? '' : `${Math.round(e.gap * 100)} см · `}×${dec(e.multiplier, 2)}</small>`;
    this.popups.prepend(el);
    while (this.popups.children.length > 3) this.popups.lastElementChild!.remove();
    setTimeout(() => el.remove(), 1600);
    // Kick the multiplier pill.
    this.mult.classList.remove('hud__mult--bump');
    void this.mult.offsetWidth;
    this.mult.classList.add('hud__mult--bump');
  }

  /** Brief cinematic title (map name at the start, mission done). Never blocks input. */
  banner(title: string, subtitle = ''): void {
    this.clearBanner();
    const el = document.createElement('div');
    el.className = 'banner';
    const b = document.createElement('b');
    b.textContent = title;
    el.append(b);
    if (subtitle) {
      const s = document.createElement('small');
      s.textContent = subtitle;
      el.append(s);
    }
    this.bannerEl.append(el);
    this.root.classList.add('hud--banner');
    this.bannerTimer = window.setTimeout(() => this.clearBanner(), 2600);
  }

  private clearBanner(): void {
    clearTimeout(this.bannerTimer);
    this.bannerEl.replaceChildren();
    this.root.classList.remove('hud--banner');
  }

  /** Writes a text node only when the value changed. */
  private text(key: string, el: HTMLElement, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  private flag(key: string, el: HTMLElement, cls: string, on: boolean): void {
    if (this.last[key] === on) return;
    this.last[key] = on;
    el.classList.toggle(cls, on);
  }

  private chip(key: 'lane' | 'pocket' | 'fps', value: string): void {
    if (this.last[key] === value) return;
    const el = this.chips[key];
    if (!value !== !this.last[key]) el.hidden = !value;
    this.last[key] = value;
    if (value) el.lastElementChild!.textContent = value;
  }

  update(s: HudState): void {
    if (!this.visible) return;
    const l = this.last;
    this.text('speed', this.speed, String(Math.round(s.speedKmh)));
    this.text('gear', this.gear, s.gear);
    const rpm = Math.round(clamp01(s.rpm01) * 200) / 200;
    if (l.rpm !== rpm) {
      l.rpm = rpm;
      this.rpmArc.style.strokeDasharray = `${(ARC_LEN * rpm).toFixed(1)} 999`;
    }
    this.flag('redline', this.root, 'hud--redline', s.rpm01 > 0.94);
    this.text('score', this.score, fmt(s.score));
    this.text('mult', this.mult, `×${dec(s.multiplier, 2)}`);
    this.flag('combo', this.root, 'hud--combo', s.multiplier > 1);
    this.flag('hot', this.root, 'hud--hot', s.multiplier >= 3);
    const combo = Math.round(clamp01(s.comboLeft) * 100) / 100;
    if (l.comboLeft !== combo) {
      l.comboLeft = combo;
      this.comboBar.style.transform = `scaleX(${combo})`;
    }
    this.text('km', this.km, `${dec(s.km, 2)} км`);
    this.flag('abs', this.lamps.abs, 'lamp--on', s.abs);
    this.flag('esp', this.lamps.esp, 'lamp--on', s.esp);
    this.flag('tcs', this.lamps.tcs, 'lamp--on', s.tcs);

    const hasNitro = s.nitro01 !== undefined;
    if (l.hasNitro !== hasNitro) {
      l.hasNitro = hasNitro;
      this.nitro.hidden = !hasNitro;
      this.root.classList.toggle('hud--has-nitro', hasNitro);
    }
    if (hasNitro) {
      const n = Math.round(clamp01(s.nitro01!) * 100) / 100;
      if (l.nitro !== n) {
        l.nitro = n;
        this.nitroBar.style.transform = `scaleX(${n})`;
        this.flag('nitroFull', this.root, 'hud--nitro-full', n >= 0.99);
        this.flag('nitroEmpty', this.root, 'hud--nitro-empty', n <= 0.02);
      }
    }
    this.flag('nitroActive', this.root, 'hud--nitro', Boolean(s.nitroActive));

    this.chip('lane', s.laneLabel);
    this.chip('pocket', s.pocketInfo);
    this.chip('fps', s.showFps ? `${Math.round(s.fps)} FPS` : '');
  }
}
