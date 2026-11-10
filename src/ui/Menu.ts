import type { VehicleSpec } from '../assets/vehicles';
import type { Settings } from '../core/Settings';
import { DROPS, FINISHES, GLOWS, PAINTS, RIMS, TINTS, type CarTuning, type PaintFinish } from '../gameplay/economy';
import type { MapDef } from '../gameplay/maps';
import type { MissionView } from '../gameplay/Missions';
import { ICONS, driveIcon } from './icons';

export type Screen = 'lobby' | 'maps' | 'settings' | 'tuning' | 'shop';

export interface CarStats {
  topKmh: number;
  hp: number;
  massKg: number;
  /** 0–100 km/h, seconds. */
  accel: number;
}

export interface MenuCallbacks {
  /** Preview a car (lobby arrows, shop). */
  onCar(index: number): void;
  onBuy(index: number): void;
  onTestDrive(index: number): void;
  onPlay(mapIndex: number): void;
  onScreen(screen: Screen): void;
  onSettings(patch: Partial<Settings>): void;
  /** null resets the car to factory spec. */
  onTuning(patch: CarTuning | null): void;
  onReward(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onMenu(): void;
  onClick(): void;
}

export interface RunResult {
  score: number;
  km: number;
  nearMisses: number;
  maxCombo: number;
  best: number;
  newBest: boolean;
  crashed: boolean;
  earned: number;
  testDrive: boolean;
  topSpeedKmh?: number;
  avgSpeedKmh?: number;
  timeSec?: number;
  /** Missions completed by this run. */
  missions?: { title: string; reward: number }[];
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const dec = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
const pad2 = (n: number) => String(n).padStart(2, '0');
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${pad2(Math.floor(sec % 60))}`;
/** Mission numbers: whole when they are whole (or large), else one decimal. */
const num = (v: number) => (v >= 100 || Math.abs(v - Math.round(v)) < 0.05 ? fmt(v) : dec(v, 1));

/** 0xRRGGBB → [hue 0..360, saturation 0..1, lightness 0..1]. */
function toHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): number {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

type Opt = [value: string | number | boolean, label: string];
type Row =
  | { kind: 'options'; label: string; key: keyof Settings; options: Opt[]; icons?: boolean; hint?: string; hints?: string[] }
  | { kind: 'toggles'; label: string; keys: [keyof Settings, string][]; hint?: string }
  | { kind: 'slider'; label: string; key: keyof Settings; min: number; max: number; step: number; unit: (v: number) => string }
  | { kind: 'check'; label: string; key: keyof Settings; hint?: string }
  | { kind: 'info'; label: string; html: string };

const key = (keys: string[], label: string) => `<span class="keys">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${label}</span>`;

const PAGES: { id: string; title: string; icon: string; rows: Row[] }[] = [
  {
    id: 'game',
    title: 'Игра',
    icon: ICONS.gamepad,
    rows: [
      { kind: 'slider', label: 'Громкость', key: 'volume', min: 0, max: 1, step: 0.05, unit: (v) => `${Math.round(v * 100)}%` },
      { kind: 'options', label: 'Камера', key: 'camera', options: [['chase', 'Сзади'], ['far', 'Дальняя'], ['bumper', 'Капот']] },
      { kind: 'slider', label: 'Инерция камеры', key: 'cameraInertia', min: 0, max: 1, step: 0.05, unit: (v) => `${Math.round(v * 100)}%` },
      { kind: 'check', label: 'Показывать FPS', key: 'showFps' },
      {
        kind: 'info',
        label: 'Управление',
        html:
          key(['W', '↑'], 'газ') +
          key(['S', '↓'], 'тормоз') +
          key(['A', 'D'], 'руль') +
          key(['Пробел'], 'нитро') +
          key(['E', 'Q'], 'передачи') +
          key(['C'], 'камера') +
          key(['H'], 'скрыть интерфейс') +
          key(['Esc'], 'пауза'),
      },
    ],
  },
  {
    id: 'car',
    title: 'Машина',
    icon: ICONS.garage,
    rows: [
      { kind: 'options', label: 'Коробка передач', key: 'gearbox', options: [['auto', 'Автомат'], ['manual', 'Ручная']], hint: 'Ручная: E — вверх, Q — вниз' },
      {
        kind: 'options',
        label: 'Стиль вождения',
        key: 'style',
        options: [['arcade', 'Аркада'], ['standard', 'Стандарт'], ['sim', 'Симулятор']],
        hints: [
          'Больше сцепления, машина сама выравнивается, ESP всегда включён',
          'Машина выравнивается при отпущенном руле, перестроения под контролем',
          'Чистая физика: без выравнивания и ограничений',
        ],
      },
      {
        kind: 'options',
        label: 'Привод',
        key: 'drive',
        icons: true,
        options: [['stock', 'Заводской'], ['FWD', 'Передний'], ['RWD', 'Задний'], ['AWD', 'Полный']],
      },
      { kind: 'toggles', label: 'Помощники', keys: [['abs', 'АБС'], ['esp', 'ЕСП'], ['tcs', 'ТКС']], hint: 'АБС — без блокировки колёс, ЕСП — без заноса, ТКС — без пробуксовки' },
    ],
  },
  {
    id: 'traffic',
    title: 'Трафик',
    icon: ICONS.road,
    rows: [
      { kind: 'options', label: 'Плотность', key: 'trafficDensity', options: [['low', 'Низкая'], ['normal', 'Средняя'], ['high', 'Высокая'], ['extreme', 'Экстрим']] },
      { kind: 'options', label: 'Скорость потока', key: 'trafficPace', options: [['slow', 'Медленно'], ['normal', 'Обычно'], ['fast', 'Быстро']] },
      { kind: 'check', label: 'Перестроения ботов', key: 'trafficLaneChanges', hint: 'Боты меняют полосы с поворотником' },
      { kind: 'check', label: 'Прозрачные боты', key: 'ghostTraffic', hint: 'Машина проезжает сквозь трафик, очки не начисляются' },
    ],
  },
  {
    id: 'graphics',
    title: 'Графика',
    icon: ICONS.monitor,
    rows: [
      { kind: 'options', label: 'Качество', key: 'quality', options: [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра']] },
      { kind: 'check', label: 'Авто-оптимизация', key: 'autoQuality', hint: 'Динамическое разрешение: игра сама удерживает 60 FPS' },
      { kind: 'options', label: 'Разрешение', key: 'resolution', options: [[0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']] },
      { kind: 'options', label: 'Лимит FPS', key: 'fpsLimit', options: [[30, '30'], [60, '60'], [0, 'Макс']] },
      { kind: 'slider', label: 'Дальность прорисовки', key: 'drawDistance', min: 300, max: 1100, step: 50, unit: (v) => `${v} м` },
    ],
  },
];

const TUNE_CATS = [
  { id: 'paint', label: 'Покраска', icon: ICONS.paint },
  { id: 'rim', label: 'Диски', icon: ICONS.rim },
  { id: 'tint', label: 'Тонировка', icon: ICONS.tint },
  { id: 'drop', label: 'Подвеска', icon: ICONS.suspension },
  { id: 'glow', label: 'Неон', icon: ICONS.neon },
] as const;
type TuneCat = (typeof TUNE_CATS)[number]['id'];

const TITLES: Record<Screen, string> = { lobby: 'Гараж', maps: 'Выбор трассы', settings: 'Настройки', tuning: 'Тюнинг', shop: 'Автосалон' };
const DRIVE: Record<string, string> = { RWD: 'Задний', FWD: 'Передний', AWD: 'Полный' };

/** Time of day / weather hint on a track card. */
function mapMood(m: MapDef): [icon: string, label: string] {
  if (m.weather === 'rain') return [ICONS.rain, 'Дождь'];
  if (m.weather === 'petals') return [ICONS.petal, 'Лепестки'];
  if (m.preset === 'night' || m.preset === 'neon') return [ICONS.moon, 'Ночь'];
  if (m.preset === 'golden') return [ICONS.sunset, 'Закат'];
  return [ICONS.sun, 'Ясно'];
}

/** Custom paint is sent at most this often while a picker is dragged. */
const PAINT_INTERVAL_MS = 70;

/**
 * Menus over the showroom: top bar (player, navigation, cash), lobby with missions,
 * track choice, settings, tuning, shop; plus pause and results cards.
 * Pure DOM; the game drives it through the callbacks.
 */
export class Menu {
  private root: HTMLElement;
  private screens: Record<Screen | 'pause' | 'results', HTMLElement>;
  private carIndex = 0;
  private screen: Screen = 'lobby';
  private settings!: Settings;
  private tuning: CarTuning = {};
  private tuneCat: TuneCat = 'paint';
  /** Category whose controls are currently built in the tuning dock. */
  private tuneBuilt: TuneCat | null = null;
  private owned = new Set<string>();
  private prices: Record<string, number> = {};
  private stats: CarStats[] = [];
  private money = 0;
  private settingsPage = 'game';
  private paintTimer = 0;
  private paintPending: number | null = null;
  private paintSentAt = 0;
  /** Which picker the player is dragging, and when it last moved (its value is not overwritten meanwhile). */
  private paintSource: 'color' | 'hue' | null = null;
  private paintTouchedAt = 0;
  private hueBase: [s: number, l: number] = [0.8, 0.46];
  private countRaf = 0;

  constructor(
    parent: HTMLElement,
    private readonly cars: VehicleSpec[],
    private readonly maps: MapDef[],
    private readonly cb: MenuCallbacks,
  ) {
    parent.insertAdjacentHTML('beforeend', this.template());
    this.root = parent.querySelector('#menu')!;
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.screens = {
      lobby: q('.scr--lobby'),
      maps: q('.scr--maps'),
      settings: q('.scr--settings'),
      tuning: q('.scr--tuning'),
      shop: q('.scr--shop'),
      pause: q('.card--pause'),
      results: q('.card--results'),
    };
    // Short screens start with the missions folded so the car stays in view.
    if (matchMedia('(max-height: 520px), (max-aspect-ratio: 1/1)').matches) q('.missions').classList.add('missions--folded');
    this.root.addEventListener('click', (e) => this.onClickEvent(e));
    this.root.addEventListener('input', (e) => this.onInputEvent(e));
  }

  // ---------------------------------------------------------------- markup

  private template(): string {
    const arrows = `<button class="nav-arrow nav-arrow--prev" data-car="-1" aria-label="Предыдущая машина">${ICONS.left}</button>
      <button class="nav-arrow nav-arrow--next" data-car="1" aria-label="Следующая машина">${ICONS.right}</button>`;
    const tab = (go: Screen, icon: string, label: string) =>
      `<button class="tb-tab" data-go="${go}" aria-label="${label}">${icon}<span>${label}</span></button>`;
    return `<div class="menu" id="menu" data-screen="lobby">
      <header class="topbar">
        <div class="tb-left">
          <button class="tb-back" data-go="lobby" aria-label="Назад в гараж">${ICONS.back}</button>
          <div class="tb-player"><span class="tb-avatar">${ICONS.user}</span><b class="tb-name">Игрок</b></div>
          <h2 class="tb-title">${TITLES.lobby}</h2>
        </div>
        <nav class="tb-nav" aria-label="Разделы">
          ${tab('lobby', ICONS.garage, 'Гараж')}${tab('shop', ICONS.cart, 'Автосалон')}${tab('settings', ICONS.gear, 'Настройки')}
        </nav>
        <div class="tb-wallet">
          <button class="tb-reward" data-act="reward" title="Смотреть рекламу" aria-label="Получить деньги за просмотр рекламы">${ICONS.video}<b class="tb-reward__sum"></b></button>
          <div class="tb-money"><span class="tb-money__icon">${ICONS.cash}</span><b class="tb-money__sum">0</b>
            <button class="tb-money__plus" data-act="reward" aria-label="Получить деньги">${ICONS.plus}</button></div>
        </div>
      </header>

      <section class="scr scr--lobby">
        <aside class="missions" hidden>
          <button class="missions__head" data-act="missions" aria-expanded="true">
            ${ICONS.target}<span>Задания</span><em class="missions__count"></em><i class="missions__chev">${ICONS.down}</i>
          </button>
          <div class="missions__list"></div>
        </aside>
        ${arrows}
        <aside class="spec-card">
          <h3>Характеристики</h3>
          <div class="spec-card__rows"></div>
        </aside>
        <div class="car-title">
          <div class="car-title__meta">
            <span class="car-title__idx"></span>
            <span class="car-title__lock">${ICONS.lock}<span>Не куплена</span></span>
          </div>
          <h1 class="car-title__name"></h1>
          <p class="car-title__tag"></p>
          <p class="car-title__best"></p>
          <p class="car-title__credit"></p>
        </div>
        <div class="lobby-actions"></div>
      </section>

      <section class="scr scr--maps scr--panel" hidden>
        <div class="map-cards">
          ${this.maps.map((m, i) => this.mapCardHtml(m, i)).join('')}
        </div>
      </section>

      <section class="scr scr--settings scr--panel" hidden>
        <div class="set">
          <div class="set-tabs" role="tablist">
            ${PAGES.map((p) => `<button class="set-tab" role="tab" data-tab="${p.id}">${p.icon}<span>${p.title}</span></button>`).join('')}
          </div>
          <div class="set-pages">
            ${PAGES.map((p) => `<div class="set-page" data-page="${p.id}">${p.rows.map((r) => this.rowHtml(r)).join('')}</div>`).join('')}
          </div>
        </div>
      </section>

      <section class="scr scr--tuning" hidden>
        ${arrows}
        <div class="tune-panel">
          <div class="tune-head">
            <div class="tune-cats">
              ${TUNE_CATS.map((c) => `<button class="tune-cat" data-cat="${c.id}">${c.icon}<span>${c.label}</span></button>`).join('')}
            </div>
            <button class="tune-reset" data-act="factory" title="Вернуть заводской вид">${ICONS.restart}<span>Заводская</span></button>
          </div>
          <div class="tune-items"></div>
        </div>
      </section>

      <section class="scr scr--shop scr--panel" hidden>
        <div class="shop-grid"></div>
      </section>

      <section class="card card--pause" hidden>
        <div class="card__eyebrow">Заезд приостановлен</div>
        <h2>Пауза</h2>
        <button class="btn btn--primary" data-act="resume">${ICONS.play}<span>Продолжить</span></button>
        <button class="btn" data-act="restart">${ICONS.restart}<span>Заново</span></button>
        <button class="btn btn--ghost" data-act="quit">${ICONS.flag}<span>Завершить заезд</span></button>
      </section>
      <section class="card card--results" hidden>
        <div class="results__main">
          <div class="card__eyebrow">Итоги заезда</div>
          <h2></h2>
          <div class="results__score"><b>0</b><small>очков</small></div>
          <div class="results__record"></div>
          <div class="results__cash"></div>
          <div class="results__btns">
            <button class="btn btn--primary" data-act="restart">${ICONS.restart}<span>Ещё заезд</span></button>
            <button class="btn" data-act="menu">${ICONS.garage}<span>В гараж</span></button>
          </div>
        </div>
        <div class="results__side">
          <dl class="results__grid"></dl>
          <div class="results__missions" hidden></div>
        </div>
      </section>
      <div class="toasts" aria-live="polite"></div>
    </div>`;
  }

  private mapCardHtml(m: MapDef, i: number): string {
    const [moodIcon, mood] = mapMood(m);
    const level = Math.min(5, Math.max(1, Math.round(m.density - 3)));
    const pips = Array.from({ length: 5 }, (_, k) => `<i${k < level ? ' class="on"' : ''}></i>`).join('');
    const img = m.image ? ` style="background-image:url('${m.image}')"` : '';
    return `<button class="map-card" data-map="${i}" style="--art:${m.art}" aria-label="${esc(m.name)}">
      <span class="map-card__art"${img}></span>
      <span class="map-card__top">
        <span class="chip chip--dark">${ICONS.pin}${esc(m.region)}</span>
        ${m.badge ? `<span class="chip chip--accent">${esc(m.badge)}</span>` : ''}
      </span>
      <span class="map-card__body">
        <span class="map-card__mood">${moodIcon}${mood}</span>
        <b>${esc(m.name)}</b>
        <small>${esc(m.subtitle)}</small>
        <span class="map-card__foot">
          <span class="map-card__traffic">Трафик<span class="pips">${pips}</span></span>
          <span class="map-card__go">Поехали${ICONS.arrow}</span>
        </span>
      </span>
    </button>`;
  }

  private rowHtml(r: Row): string {
    const hint = 'hint' in r && r.hint ? `<div class="row__hint">${r.hint}</div>` : '';
    const dynHint = r.kind === 'options' && r.hints ? `<div class="row__hint" data-hint="${r.key}"></div>` : '';
    let ctl = '';
    switch (r.kind) {
      case 'options':
        ctl = `<div class="seg${r.icons ? ' seg--icons' : ''}">${r.options
          .map(
            ([v, l]) =>
              `<button class="opt" data-set="${r.key}" data-val="${v}" title="${l}">${r.icons ? driveIcon(v as 'FWD') : ''}<span>${l}</span></button>`,
          )
          .join('')}</div>`;
        break;
      case 'toggles':
        ctl = `<div class="pills">${r.keys.map(([k, l]) => `<button class="opt opt--pill" data-toggle="${k}"><i></i>${l}</button>`).join('')}</div>`;
        break;
      case 'slider':
        ctl = `<input class="slider" type="range" data-range="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${r.label}" /><output class="slider__val"></output>`;
        break;
      case 'check':
        ctl = `<button class="check" role="switch" data-toggle="${r.key}" aria-label="${r.label}"><i></i></button>`;
        break;
      case 'info':
        ctl = `<div class="row__info">${r.html}</div>`;
        break;
    }
    return `<div class="row row--${r.kind}"><div class="row__text"><div class="row__label">${r.label}</div>${hint}${dynHint}</div><div class="row__ctl">${ctl}</div></div>`;
  }

  // ---------------------------------------------------------------- events

  private onClickEvent(e: Event): void {
    const el = (e.target as HTMLElement).closest('button');
    if (!el) return;
    this.cb.onClick();
    const d = el.dataset;
    if (d.car) {
      const n = this.cars.length;
      this.setCar((this.carIndex + Number(d.car) + n) % n);
      this.cb.onCar(this.carIndex);
    } else if (d.go) this.go(d.go as Screen);
    else if (d.map) this.cb.onPlay(Number(d.map));
    else if (d.tab) this.selectPage(d.tab);
    else if (d.set) {
      const key = d.set as keyof Settings;
      const cur = this.settings[key];
      const val = typeof cur === 'number' ? Number(d.val) : d.val;
      this.cb.onSettings({ [key]: val } as Partial<Settings>);
    } else if (d.toggle) {
      const key = d.toggle as keyof Settings;
      this.cb.onSettings({ [key]: !this.settings[key] } as Partial<Settings>);
    } else if (d.cat) {
      this.tuneCat = d.cat as TuneCat;
      this.renderTuning();
    } else if (d.tune) {
      this.paintSource = null;
      this.cb.onTuning({ [d.tune]: Number(d.value) } as CarTuning);
    } else if (d.finish) this.cb.onTuning({ finish: d.finish as PaintFinish });
    else if (d.shop) {
      this.setCar(Number(d.shop));
      this.cb.onCar(this.carIndex);
      this.go('lobby');
    } else
      switch (d.act) {
        case 'play':
          this.go('maps');
          break;
        case 'buy':
          this.cb.onBuy(this.carIndex);
          break;
        case 'test':
          this.cb.onTestDrive(this.carIndex);
          break;
        case 'reward':
          this.cb.onReward();
          break;
        case 'factory':
          this.paintSource = null;
          this.cb.onTuning(null);
          break;
        case 'missions': {
          const folded = el.parentElement!.classList.toggle('missions--folded');
          el.setAttribute('aria-expanded', String(!folded));
          break;
        }
        case 'resume':
          this.cb.onResume();
          break;
        case 'restart':
          this.cb.onRestart();
          break;
        case 'quit':
          this.cb.onQuit();
          break;
        case 'menu':
          this.cb.onMenu();
          break;
      }
  }

  private onInputEvent(e: Event): void {
    const el = e.target as HTMLInputElement;
    const d = el.dataset;
    if (d.range) {
      const key = d.range as keyof Settings;
      this.cb.onSettings({ [key]: Number(el.value) } as Partial<Settings>);
    } else if (d.color) {
      this.paintSource = 'color';
      this.queuePaint(parseInt(el.value.slice(1), 16));
    } else if (d.hue) {
      const now = performance.now();
      if (this.paintSource !== 'hue' || now - this.paintTouchedAt > 600) {
        // A new drag keeps the current colour's depth; greys get a vivid default.
        const [, s, l] = this.tuning.paint !== undefined ? toHsl(this.tuning.paint) : [0, 0, 0.46];
        this.hueBase = [s < 0.25 ? 0.8 : s, Math.min(0.62, Math.max(0.24, l))];
      }
      this.paintSource = 'hue';
      this.queuePaint(fromHsl(Number(el.value), this.hueBase[0], this.hueBase[1]));
    }
  }

  /** Throttled custom paint: pickers fire on every pointer move, the car repaints ≤ ~14×/s. */
  private queuePaint(color: number): void {
    this.paintPending = color;
    this.paintTouchedAt = performance.now();
    if (this.paintTimer) return;
    const wait = Math.max(0, PAINT_INTERVAL_MS - (this.paintTouchedAt - this.paintSentAt));
    this.paintTimer = window.setTimeout(() => {
      this.paintTimer = 0;
      this.paintSentAt = performance.now();
      const c = this.paintPending;
      this.paintPending = null;
      if (c !== null) this.cb.onTuning({ paint: c });
    }, wait);
  }

  // ---------------------------------------------------------------- state

  go(screen: Screen): void {
    this.screen = screen;
    this.root.hidden = false;
    this.root.classList.remove('menu--dim');
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== screen;
    this.root.querySelector('.topbar')!.removeAttribute('hidden');
    this.root.querySelector('.tb-title')!.textContent = TITLES[screen];
    this.root.dataset.screen = screen;
    for (const t of this.root.querySelectorAll<HTMLElement>('.tb-tab')) {
      const on = t.dataset.go === screen || (t.dataset.go === 'lobby' && (screen === 'maps' || screen === 'tuning'));
      t.classList.toggle('tb-tab--on', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    if (screen === 'settings') this.selectPage(this.settingsPage);
    if (screen === 'shop') this.renderShop();
    if (screen === 'tuning') this.renderTuning();
    if (screen === 'lobby') this.renderCar();
    this.cb.onScreen(screen);
  }

  /** Esc / back: sub-screens return to the lobby. Returns false on the lobby itself. */
  back(): boolean {
    if (this.root.hidden || this.screen === 'lobby' || !this.screens[this.screen] || this.screens[this.screen].hidden) return false;
    this.go('lobby');
    return true;
  }

  get current(): Screen | null {
    return this.root.hidden || this.screens[this.screen].hidden ? null : this.screen;
  }

  setPlayerName(name: string): void {
    this.root.querySelector('.tb-name')!.textContent = name;
  }

  setMoney(money: number): void {
    this.money = money;
    this.root.querySelector('.tb-money__sum')!.textContent = fmt(money);
    if (this.screen === 'lobby') this.renderActions();
    if (this.screen === 'shop' && !this.screens.shop.hidden) this.renderShop();
  }

  setRewardAmount(sum: number): void {
    this.root.querySelector('.tb-reward__sum')!.textContent = `+${fmt(sum)}`;
  }

  setGarage(owned: Set<string>, prices: Record<string, number>, stats: CarStats[]): void {
    this.owned = owned;
    this.prices = prices;
    this.stats = stats;
    this.renderCar();
  }

  setCar(index: number): void {
    this.carIndex = index;
    this.renderCar();
    if (this.screen === 'tuning') this.renderTuning();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-set]')) {
      btn.classList.toggle('opt--on', String(s[btn.dataset.set as keyof Settings]) === btn.dataset.val);
    }
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-toggle]')) {
      const on = Boolean(s[btn.dataset.toggle as keyof Settings]);
      btn.classList.toggle(btn.classList.contains('check') ? 'check--on' : 'opt--on', on);
      btn.setAttribute(btn.classList.contains('check') ? 'aria-checked' : 'aria-pressed', String(on));
    }
    for (const hint of this.root.querySelectorAll<HTMLElement>('[data-hint]')) {
      const key = hint.dataset.hint as keyof Settings;
      const row = PAGES.flatMap((p) => p.rows).find((r) => r.kind === 'options' && r.key === key) as Extract<Row, { kind: 'options' }>;
      const i = Math.max(0, row.options.findIndex(([v]) => v === s[key]));
      hint.textContent = row.hints?.[i] ?? '';
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-range]')) {
      const key = input.dataset.range as keyof Settings;
      const row = PAGES.flatMap((p) => p.rows).find((r) => r.kind === 'slider' && r.key === key) as Extract<Row, { kind: 'slider' }>;
      const v = Number(s[key]);
      if (document.activeElement !== input) input.value = String(v);
      input.style.setProperty('--p', `${((v - row.min) / (row.max - row.min)) * 100}%`);
      (input.nextElementSibling as HTMLElement).textContent = row.unit(v);
    }
  }

  setTuning(t: CarTuning): void {
    this.tuning = t;
    if (this.screen === 'tuning') this.renderTuning();
  }

  setBest(score: number, km: number): void {
    const el = this.root.querySelector<HTMLElement>('.car-title__best')!;
    el.innerHTML = score > 0 ? `${ICONS.trophy}<span>Рекорд <b>${fmt(score)}</b> · ${dec(km, 1)} км</span>` : '';
  }

  /** Model attribution (CC BY requires it to be visible). */
  setCredit(text: string): void {
    this.root.querySelector('.car-title__credit')!.textContent = text;
  }

  /** Lobby "Задания" panel: three goals with progress and cash rewards. */
  setMissions(list: MissionView[]): void {
    const box = this.root.querySelector<HTMLElement>('.missions')!;
    box.hidden = list.length === 0;
    const done = list.filter((m) => m.done).length;
    box.querySelector('.missions__count')!.textContent = `${done}/${list.length}`;
    box.classList.toggle('missions--any-done', done > 0);
    box.querySelector('.missions__list')!.innerHTML = list
      .map((m) => {
        const p = m.goal > 0 ? Math.min(1, Math.max(0, m.progress / m.goal)) : 0;
        return `<div class="mission${m.done ? ' mission--done' : ''}" data-mission="${esc(m.id)}">
          <div class="mission__title">${esc(m.title)}</div>
          <div class="mission__reward">${m.done ? ICONS.check : ICONS.cash}<b>${fmt(m.reward)}</b></div>
          <i class="mission__bar"><u style="transform:scaleX(${m.done ? 1 : p.toFixed(3)})"></u></i>
          <div class="mission__num">${m.done ? 'Выполнено' : `${num(Math.min(m.progress, m.goal))} / ${num(m.goal)}`}</div>
        </div>`;
      })
      .join('');
  }

  /** Short message at the bottom of the screen; a repeat of a visible message just restarts it. */
  toast(text: string): void {
    const box = this.root.querySelector<HTMLElement>('.toasts')!;
    for (const old of Array.from(box.children)) if (old.textContent === text || box.children.length > 1) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.append(el);
    setTimeout(() => el.remove(), 2800);
  }

  private selectPage(id: string): void {
    this.settingsPage = id;
    for (const t of this.root.querySelectorAll<HTMLElement>('.set-tab')) {
      t.classList.toggle('set-tab--on', t.dataset.tab === id);
      t.setAttribute('aria-selected', String(t.dataset.tab === id));
    }
    for (const p of this.root.querySelectorAll<HTMLElement>('.set-page')) p.hidden = p.dataset.page !== id;
  }

  private renderCar(): void {
    const c = this.cars[this.carIndex];
    const st = this.stats[this.carIndex];
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    q('.car-title__idx').innerHTML = `<b>${pad2(this.carIndex + 1)}</b> / ${pad2(this.cars.length)}`;
    q('.car-title__name').textContent = c.name;
    q('.car-title__tag').textContent = c.tagline;
    if (st) {
      const rows: [string, string, string, string, number][] = [
        [ICONS.speedo, 'Макс. скорость', fmt(st.topKmh), 'км/ч', st.topKmh / 320],
        [ICONS.power, 'Мощность', fmt(st.hp), 'л.с.', st.hp / 520],
        [ICONS.timer, 'Разгон 0–100', dec(st.accel, 1), 'с', 1 - (st.accel - 3) / 14],
        [ICONS.weight, 'Масса', fmt(st.massKg), 'кг', st.massKg / 2000],
        [ICONS.drive, 'Привод', DRIVE[c.handling.drivetrain] ?? c.handling.drivetrain, '', -1],
      ];
      q('.spec-card__rows').innerHTML = rows
        .map(
          ([icon, label, value, unit, f]) => `<div class="spec">
            <span class="spec__icon">${icon}</span>
            <div class="spec__body"><div class="spec__line"><span>${label}</span><b>${value}${unit ? `<small>${unit}</small>` : ''}</b></div>
            ${f >= 0 ? `<i class="spec__bar"><u style="transform:scaleX(${Math.min(1, Math.max(0.06, f)).toFixed(3)})"></u></i>` : ''}</div>
          </div>`,
        )
        .join('');
    }
    this.renderActions();
  }

  private renderActions(): void {
    const c = this.cars[this.carIndex];
    const owned = this.owned.has(c.id);
    const price = this.prices[c.id] ?? 0;
    const box = this.root.querySelector<HTMLElement>('.lobby-actions')!;
    box.innerHTML = owned
      ? `<div class="lobby-actions__row">
           <button class="act act--tuning" data-go="tuning">${ICONS.wrench}<span>Тюнинг</span></button>
           <button class="act act--shop" data-go="shop">${ICONS.cart}<span>Автосалон</span></button>
         </div>
         <button class="act act--cta act--play" data-act="play"><span>Играть</span><kbd>Enter</kbd><i>${ICONS.arrow}</i></button>`
      : `<div class="lobby-actions__row">
           <button class="act act--test" data-act="test">${ICONS.video}<span>Тест-драйв</span></button>
           <button class="act act--shop" data-go="shop">${ICONS.cart}<span>Автосалон</span></button>
         </div>
         <button class="act act--cta act--buy${this.money >= price ? '' : ' act--poor'}" data-act="buy">
           <span>Купить</span><b>${ICONS.cash}${fmt(price)}</b></button>`;
    this.screens.lobby.classList.toggle('scr--locked', !owned);
  }

  private renderShop(): void {
    this.root.querySelector('.shop-grid')!.innerHTML = this.cars
      .map((c, i) => {
        const st = this.stats[i];
        const owned = this.owned.has(c.id);
        const price = this.prices[c.id] ?? 0;
        const on = i === this.carIndex;
        const poor = !owned && this.money < price;
        const state = on && owned ? `${ICONS.check}Выбрана` : owned ? 'В гараже' : ICONS.lock;
        const bar = (f: number) => `<i class="shop-card__bar"><u style="transform:scaleX(${Math.min(1, Math.max(0.06, f)).toFixed(3)})"></u></i>`;
        return `<button class="shop-card${owned ? ' shop-card--owned' : ''}${on ? ' shop-card--on' : ''}" data-shop="${i}">
          <span class="shop-card__top"><small>${pad2(i + 1)}</small><em class="shop-card__state">${state}</em></span>
          <b>${esc(c.name)}</b>
          ${
            st
              ? `<span class="shop-card__specs">
                   <span><i>Мощность</i><b>${fmt(st.hp)} л.с.</b>${bar(st.hp / 520)}</span>
                   <span><i>Скорость</i><b>${fmt(st.topKmh)} км/ч</b>${bar(st.topKmh / 320)}</span>
                 </span>`
              : ''
          }
          <span class="shop-card__foot">
            <span class="shop-card__drive">${c.handling.drivetrain}</span>
            <em class="shop-card__price${poor ? ' shop-card__price--poor' : ''}">${owned ? 'Открыть' : `${ICONS.cash}${fmt(price)}`}</em>
          </span>
        </button>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------- tuning

  private tuneHtml(cat: TuneCat): string {
    const swatch = (key: string, value: number, label: string, extra = '') =>
      `<button class="swatch${extra}" data-tune="${key}" data-value="${value}" title="${label}">
        <i style="--c:${hex(value)}">${value === 0 && key === 'glow' ? ICONS.off : ''}</i><span>${label}</span></button>`;
    const tile = (key: string, value: number, label: string, viz: string) =>
      `<button class="tune-opt" data-tune="${key}" data-value="${value}">${viz}<span>${label}</span></button>`;
    switch (cat) {
      case 'paint':
        return `<div class="tune-row">
            <label class="swatch swatch--custom" title="Любой цвет">
              <input type="color" data-color="paint" aria-label="Свой цвет кузова" /><i>${ICONS.plus}</i><span>Свой цвет</span>
            </label>
            ${PAINTS.map((p) => swatch('paint', p.color, p.name)).join('')}
          </div>
          <div class="tune-sub">
            <label class="tune-hue"><span>Оттенок</span><input class="hue" type="range" min="0" max="359" step="1" data-hue="paint" aria-label="Оттенок кузова" /></label>
            <div class="tune-finish"><span>Покрытие</span><div class="seg seg--small">${FINISHES.map(
              (f) => `<button class="opt" data-finish="${f.value}"><span>${f.name}</span></button>`,
            ).join('')}</div></div>
          </div>`;
      case 'rim':
        return `<div class="tune-row">${RIMS.map((p) => swatch('rim', p.color, p.name)).join('')}</div>`;
      case 'glow':
        return `<div class="tune-row">${GLOWS.map((p) => swatch('glow', p.color, p.name, p.color === 0 ? ' swatch--off' : ' swatch--glow')).join('')}</div>`;
      case 'tint':
        return `<div class="tune-row">${TINTS.map((p) => tile('tint', p.value, p.name, `<i class="viz viz--tint" style="--v:${p.value}"></i>`)).join('')}</div>`;
      case 'drop':
        return `<div class="tune-row">${DROPS.map((p) =>
          tile('drop', p.value, p.name, `<i class="viz viz--drop" style="--v:${(1 + p.value / 0.06).toFixed(2)}"><u></u></i>`),
        ).join('')}</div>`;
    }
  }

  /** Builds the dock for the active category once, then only syncs selection (pickers survive live updates). */
  private renderTuning(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.tune-cat[data-cat]')) b.classList.toggle('tune-cat--on', b.dataset.cat === this.tuneCat);
    const items = this.root.querySelector<HTMLElement>('.tune-items')!;
    if (this.tuneBuilt !== this.tuneCat) {
      this.tuneBuilt = this.tuneCat;
      items.innerHTML = this.tuneHtml(this.tuneCat);
      items.dataset.cat = this.tuneCat;
      this.paintSource = null;
    }
    const t = this.tuning;
    const current: Record<string, number> = { paint: t.paint ?? -1, rim: t.rim ?? -1, glow: t.glow ?? 0, tint: t.tint ?? -1, drop: t.drop ?? 0 };
    for (const b of items.querySelectorAll<HTMLElement>('[data-tune]')) {
      const on = Number(b.dataset.value) === current[b.dataset.tune!];
      b.classList.toggle(b.classList.contains('swatch') ? 'swatch--on' : 'tune-opt--on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of items.querySelectorAll<HTMLElement>('[data-finish]')) b.classList.toggle('opt--on', b.dataset.finish === t.finish);

    const custom = items.querySelector<HTMLElement>('.swatch--custom');
    if (!custom) return;
    const isCustom = t.paint !== undefined && !PAINTS.some((p) => p.color === t.paint);
    custom.classList.toggle('swatch--on', isCustom);
    if (isCustom) custom.style.setProperty('--c', hex(t.paint!));
    else custom.style.removeProperty('--c');
    const dragging = performance.now() - this.paintTouchedAt < 600;
    const color = custom.querySelector<HTMLInputElement>('input')!;
    if (t.paint !== undefined && !(dragging && this.paintSource === 'color')) color.value = hex(t.paint);
    const hue = items.querySelector<HTMLInputElement>('[data-hue]')!;
    if (t.paint !== undefined && !(dragging && this.paintSource === 'hue')) {
      const [h, s] = toHsl(t.paint);
      if (s > 0.08) hue.value = String(Math.round(h));
    }
  }

  // ---------------------------------------------------------------- overlays

  private showCard(which: 'pause' | 'results' | null): void {
    this.root.hidden = which === null;
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== which;
    this.root.querySelector('.topbar')!.toggleAttribute('hidden', true);
    this.root.classList.toggle('menu--dim', which !== null);
    this.root.dataset.screen = which ?? '';
  }

  showPause(): void {
    this.showCard('pause');
  }

  hide(): void {
    this.showCard(null);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  showResults(r: RunResult): void {
    const el = this.screens.results;
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    const missions = r.missions ?? [];
    el.classList.toggle('card--crash', r.crashed);
    q('h2').textContent = r.crashed ? 'Авария!' : 'Заезд завершён';
    q('.results__record').innerHTML = r.newBest
      ? `<span class="chip chip--accent">${ICONS.trophy}Новый рекорд!</span>`
      : `<span class="chip chip--dark">${ICONS.trophy}Рекорд ${fmt(r.best)}</span>`;
    const stats: [string, string, string][] = [
      [ICONS.road, 'Дистанция', `${dec(r.km, 2)} км`],
      [ICONS.near, 'Опасных обгонов', fmt(r.nearMisses)],
      [ICONS.flame, 'Лучшее комбо', `×${dec(r.maxCombo, 2)}`],
      [ICONS.speedo, 'Макс. скорость', `${fmt(r.topSpeedKmh ?? 0)} км/ч`],
      [ICONS.trend, 'Средняя скорость', `${fmt(r.avgSpeedKmh ?? 0)} км/ч`],
      [ICONS.clock, 'Время', clock(r.timeSec ?? 0)],
    ];
    q('.results__grid').innerHTML = stats.map(([icon, label, value]) => `<div class="stat">${icon}<dt>${label}</dt><dd>${value}</dd></div>`).join('');
    q('.results__cash').innerHTML = r.testDrive
      ? `<span class="results__note">Тест-драйв: деньги не начисляются</span>`
      : `<span>Заработано</span><b>${ICONS.cash}+${fmt(r.earned)}</b>`;
    const box = q('.results__missions');
    box.hidden = missions.length === 0;
    box.innerHTML = missions.length
      ? `<h4>${ICONS.target}Задания выполнены</h4>${missions
          .map((m) => `<div class="results__mission">${ICONS.check}<span>${esc(m.title)}</span><b>${ICONS.cash}+${fmt(m.reward)}</b></div>`)
          .join('')}`
      : '';
    this.showCard('results');
    this.countUp(q('.results__score b'), r.score);
  }

  /** Score rolls up from zero; instant for players who asked for less motion. */
  private countUp(el: HTMLElement, target: number): void {
    cancelAnimationFrame(this.countRaf);
    if (target <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fmt(target);
      return;
    }
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) this.countRaf = requestAnimationFrame(tick);
    };
    el.textContent = '0';
    this.countRaf = requestAnimationFrame(tick);
  }
}
