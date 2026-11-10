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
}

export type TouchAction = 'throttle' | 'brake' | 'left' | 'right';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const POPUP: Record<string, string> = {
  near: 'NEAR MISS',
  crazy: 'CRAZY CLOSE',
  squeeze: 'DOUBLE SQUEEZE',
  crash: 'КОМБО ПОТЕРЯНО',
};

/** Tachometer arc: 270° sweep (from bottom-left, clockwise) drawn as an SVG stroke. */
const ARC_LEN = 2 * Math.PI * 44 * (270 / 360);

/** DOM overlay: loading screen, speedometer, score/combo, event popups, touch controls. */
export class Hud {
  private root: HTMLElement;
  private loader: HTMLElement;
  private loaderBar: HTMLElement;
  private loaderLabel: HTMLElement;
  private speed: HTMLElement;
  private gear: HTMLElement;
  private rpmArc: SVGCircleElement;
  private info: HTMLElement;
  private car: HTMLElement;
  private score: HTMLElement;
  private mult: HTMLElement;
  private comboBar: HTMLElement;
  private km: HTMLElement;
  private popups: HTMLElement;
  private lamps: Record<'abs' | 'esp' | 'tcs', HTMLElement>;
  private visible = true;
  onPause: () => void = () => {};
  onTouch: (action: TouchAction, down: boolean) => void = () => {};
  onShift: (dir: 1 | -1) => void = () => {};

  constructor(parent: HTMLElement) {
    parent.insertAdjacentHTML(
      'beforeend',
      `<div class="loader" id="loader">
         <div class="loader__title">ГОРОДСКОЙ ПОТОК<span>ШАШКИ</span></div>
         <div class="loader__track"><div class="loader__bar"></div></div>
         <div class="loader__label">Загрузка…</div>
       </div>
       <div class="hud hud--hidden" id="hud">
         <div class="hud__car"><b></b><small></small></div>
         <div class="hud__score">
           <div class="hud__score-main"><b>0</b><span class="hud__mult">×1.00</span></div>
           <i class="hud__combo"><u></u></i>
         </div>
         <div class="hud__km">0.00 км</div>
         <div class="hud__popups"></div>
         <div class="gauge">
           <svg class="gauge__svg" viewBox="0 0 100 100" aria-hidden="true">
             <circle class="gauge__track" cx="50" cy="50" r="44" />
             <circle class="gauge__rpm" cx="50" cy="50" r="44" />
             <circle class="gauge__red" cx="50" cy="50" r="44" />
           </svg>
           <div class="gauge__speed"><b>0</b><small>км/ч</small></div>
           <div class="gauge__gear">N</div>
           <div class="gauge__lamps"><span data-lamp="abs">ABS</span><span data-lamp="esp">ESP</span><span data-lamp="tcs">TCS</span></div>
         </div>
         <div class="hud__info"></div>
         <button class="hud__pause" aria-label="Пауза">${ICONS.pause}</button>
         <div class="touch">
           <button class="touch__btn touch__left" data-t="left" aria-label="Влево">${ICONS.left}</button>
           <button class="touch__btn touch__right" data-t="right" aria-label="Вправо">${ICONS.right}</button>
           <button class="touch__btn touch__brake" data-t="brake" aria-label="Тормоз"><span>ТОРМОЗ</span></button>
           <button class="touch__btn touch__gas" data-t="throttle" aria-label="Газ"><span>ГАЗ</span></button>
           <button class="touch__shift touch__shift--up" data-shift="1" aria-label="Передача вверх">+</button>
           <button class="touch__shift touch__shift--down" data-shift="-1" aria-label="Передача вниз">−</button>
         </div>
       </div>`,
    );
    this.loader = parent.querySelector('#loader')!;
    this.loaderBar = this.loader.querySelector('.loader__bar')!;
    this.loaderLabel = this.loader.querySelector('.loader__label')!;
    this.root = parent.querySelector('#hud')!;
    const q = <T extends Element = HTMLElement>(s: string) => this.root.querySelector<T & Element>(s)! as T;
    this.speed = q('.gauge__speed b');
    this.gear = q('.gauge__gear');
    this.rpmArc = q<SVGCircleElement>('.gauge__rpm');
    this.info = q('.hud__info');
    this.car = q('.hud__car');
    this.score = q('.hud__score-main b');
    this.mult = q('.hud__mult');
    this.comboBar = q('.hud__combo u');
    this.km = q('.hud__km');
    this.popups = q('.hud__popups');
    this.lamps = { abs: q('[data-lamp="abs"]'), esp: q('[data-lamp="esp"]'), tcs: q('[data-lamp="tcs"]') };
    this.rpmArc.style.strokeDasharray = `0 999`;
    q('.hud__pause').addEventListener('click', () => this.onPause());

    // Pedals: pointer events cover touch and mouse; multi-touch works since each button tracks its own pointer.
    for (const btn of this.root.querySelectorAll<HTMLElement>('.touch__btn')) {
      const action = btn.dataset.t as TouchAction;
      const set = (down: boolean) => {
        btn.classList.toggle('touch__btn--on', down);
        this.onTouch(action, down);
      };
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
    }
    for (const btn of this.root.querySelectorAll<HTMLElement>('.touch__shift')) {
      btn.addEventListener('pointerdown', () => this.onShift(Number(btn.dataset.shift) as 1 | -1));
    }
    if (matchMedia('(pointer: coarse)').matches) this.root.classList.add('hud--touch');
  }

  progress(label: string, value: number): void {
    this.loaderLabel.textContent = label;
    this.loaderBar.style.width = `${Math.round(value * 100)}%`;
  }

  hideLoader(): void {
    this.loader.classList.add('loader--done');
    setTimeout(() => this.loader.remove(), 900);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  setPlaying(on: boolean): void {
    this.root.classList.toggle('hud--hidden', !on);
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
        : `<b>${label}</b><span>+${fmt(e.points)}</span><small>${e.kind === 'squeeze' ? '' : `${Math.round(e.gap * 100)} см · `}×${e.multiplier.toFixed(2)}</small>`;
    this.popups.prepend(el);
    while (this.popups.children.length > 3) this.popups.lastElementChild!.remove();
    setTimeout(() => el.remove(), 1600);
  }

  update(s: HudState): void {
    if (!this.visible) return;
    this.speed.textContent = String(Math.round(s.speedKmh));
    this.gear.textContent = s.gear;
    this.rpmArc.style.strokeDasharray = `${ARC_LEN * Math.min(1, Math.max(0, s.rpm01))} 999`;
    this.root.classList.toggle('hud--redline', s.rpm01 > 0.94);
    this.score.textContent = fmt(s.score);
    this.mult.textContent = `×${s.multiplier.toFixed(2)}`;
    this.mult.classList.toggle('hud__mult--hot', s.multiplier >= 3);
    this.comboBar.style.width = `${Math.round(s.comboLeft * 100)}%`;
    this.km.textContent = `${s.km.toFixed(2)} км`;
    this.lamps.abs.classList.toggle('lamp--on', s.abs);
    this.lamps.esp.classList.toggle('lamp--on', s.esp);
    this.lamps.tcs.classList.toggle('lamp--on', s.tcs);
    this.info.textContent = `${s.laneLabel}${s.pocketInfo ? ' · ' + s.pocketInfo : ''}${s.showFps ? ` · ${Math.round(s.fps)} FPS` : ''}`;
  }
}
