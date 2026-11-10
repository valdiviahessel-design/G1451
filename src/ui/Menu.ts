import type { VehicleSpec } from '../assets/vehicles';
import type { Settings } from '../core/Settings';
import { DROPS, PAINTS, RIMS, TINTS, type CarTuning } from '../gameplay/economy';
import type { MapDef } from '../gameplay/maps';
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
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

type Opt = [value: string | number | boolean, label: string];
type Row =
  | { kind: 'options'; label: string; key: keyof Settings; options: Opt[]; icons?: boolean; hint?: string }
  | { kind: 'stepper'; label: string; key: keyof Settings; options: Opt[]; hints: string[] }
  | { kind: 'toggles'; label: string; keys: [keyof Settings, string][]; hint?: string }
  | { kind: 'slider'; label: string; key: keyof Settings; min: number; max: number; step: number; unit: (v: number) => string }
  | { kind: 'check'; label: string; key: keyof Settings; hint?: string }
  | { kind: 'info'; label: string; html: string };

const PAGES: { id: string; title: string; rows: Row[] }[] = [
  {
    id: 'game',
    title: 'Игра',
    rows: [
      { kind: 'slider', label: 'Звук', key: 'volume', min: 0, max: 1, step: 0.05, unit: (v) => v.toFixed(2).replace('.', ',') },
      { kind: 'options', label: 'Камера', key: 'camera', options: [['chase', 'Сзади'], ['far', 'Дальняя'], ['bumper', 'Капот']] },
      { kind: 'slider', label: 'Инерция камеры', key: 'cameraInertia', min: 0, max: 1, step: 0.05, unit: (v) => `${Math.round(v * 100)}` },
      { kind: 'check', label: 'Показывать FPS', key: 'showFps' },
      {
        kind: 'info',
        label: 'Управление',
        html: '<kbd>W</kbd><kbd>↑</kbd> газ · <kbd>S</kbd><kbd>↓</kbd> тормоз · <kbd>A</kbd><kbd>D</kbd> руль · <kbd>E</kbd><kbd>Q</kbd> передачи · <kbd>C</kbd> камера · <kbd>Esc</kbd> пауза',
      },
    ],
  },
  {
    id: 'car',
    title: 'Машина',
    rows: [
      { kind: 'options', label: 'Коробка передач', key: 'gearbox', options: [['auto', 'Авто'], ['manual', 'Ручная']], hint: 'Ручная: E — вверх, Q — вниз' },
      {
        kind: 'stepper',
        label: 'Стиль вождения',
        key: 'style',
        options: [['arcade', 'Аркадное'], ['standard', 'Стандартное'], ['sim', 'Симулятор']],
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
        options: [['stock', 'Как у машины'], ['FWD', 'Передний'], ['RWD', 'Задний'], ['AWD', 'Полный']],
      },
      { kind: 'toggles', label: 'Помощники', keys: [['abs', 'АБС'], ['esp', 'ЕСП'], ['tcs', 'ТКС']], hint: 'АБС — без блокировки колёс, ЕСП — без заноса, ТКС — без пробуксовки' },
    ],
  },
  {
    id: 'traffic',
    title: 'Трафик',
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
    rows: [
      { kind: 'options', label: 'Настройка графики', key: 'quality', options: [['low', 'Низкие'], ['medium', 'Средние'], ['high', 'Высокие'], ['ultra', 'Ультра']] },
      { kind: 'options', label: 'Разрешение экрана', key: 'resolution', options: [[0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']] },
      { kind: 'options', label: 'ФПС', key: 'fpsLimit', options: [[30, '30'], [60, '60'], [0, 'Макс']] },
      { kind: 'slider', label: 'Дальность прорисовки', key: 'drawDistance', min: 300, max: 1100, step: 50, unit: (v) => `${v} m` },
    ],
  },
];

const TUNE_CATS = [
  { id: 'paint', label: 'Покраска', icon: ICONS.paint },
  { id: 'rim', label: 'Диски', icon: ICONS.rim },
  { id: 'tint', label: 'Тонировка', icon: ICONS.tint },
  { id: 'drop', label: 'Подвеска', icon: ICONS.suspension },
] as const;
type TuneCat = (typeof TUNE_CATS)[number]['id'];

const TITLES: Record<Screen, string> = { lobby: 'Лобби', maps: 'Трасса', settings: 'Настройки', tuning: 'Тюнинг', shop: 'Магазин' };

/**
 * Menus over the showroom: top bar (player, shop / title / settings, cash),
 * lobby, track choice, settings, tuning, shop; plus pause and results cards.
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
  private owned = new Set<string>();
  private prices: Record<string, number> = {};
  private stats: CarStats[] = [];
  private money = 0;
  private settingsPage = 'game';

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
    this.root.addEventListener('click', (e) => this.onClickEvent(e));
    this.root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (!el.dataset.range) return;
      const key = el.dataset.range as keyof Settings;
      this.cb.onSettings({ [key]: Number(el.value) } as Partial<Settings>);
    });
  }

  // ---------------------------------------------------------------- markup

  private template(): string {
    const arrows = `<button class="nav-arrow nav-arrow--prev" data-car="-1" aria-label="Предыдущая машина">${ICONS.left}</button>
      <button class="nav-arrow nav-arrow--next" data-car="1" aria-label="Следующая машина">${ICONS.right}</button>`;
    return `<div class="menu" id="menu">
      <header class="topbar">
        <div class="tb-player"><span class="tb-avatar">${ICONS.user}</span><b class="tb-name">Игрок</b></div>
        <nav class="tb-nav">
          <button class="tb-nav__shop" data-go="shop" aria-label="Магазин">${ICONS.cart}</button>
          <div class="tb-nav__title">Лобби</div>
          <button class="tb-nav__settings" data-go="settings" aria-label="Настройки">${ICONS.gear}</button>
        </nav>
        <div class="tb-wallet">
          <button class="tb-reward" data-act="reward" title="Смотреть рекламу">${ICONS.video}<b class="tb-reward__sum"></b></button>
          <div class="tb-money"><span class="tb-money__icon">${ICONS.cash}</span><b class="tb-money__sum">0</b>
            <button class="tb-money__plus" data-act="reward" aria-label="Получить деньги">${ICONS.plus}</button></div>
        </div>
      </header>

      <section class="scr scr--lobby">
        ${arrows}
        <aside class="spec-card">
          <h3>Характеристики</h3>
          <div class="spec-card__rows"></div>
        </aside>
        <div class="car-title">
          <small class="car-title__idx"></small>
          <h1 class="car-title__name"></h1>
          <p class="car-title__tag"></p>
          <p class="car-title__best"></p>
          <p class="car-title__credit"></p>
        </div>
        <div class="lobby-actions"></div>
      </section>

      <section class="scr scr--maps" hidden>
        <button class="back-tab" data-go="lobby">Назад</button>
        <h2 class="scr__heading">Выбор трассы</h2>
        <div class="map-cards">
          ${this.maps
            .map(
              (m, i) => `<button class="map-card" data-map="${i}" style="--art:${m.art}">
                <span class="map-card__art"></span>
                <b>${m.name}</b><small>${m.subtitle}</small>
                <span class="map-card__go">Поехали ${ICONS.flag}</span>
              </button>`,
            )
            .join('')}
        </div>
      </section>

      <section class="scr scr--settings scr--panel" hidden>
        <button class="back-tab" data-go="lobby">Назад</button>
        <div class="set-tabs">
          ${PAGES.map((p) => `<button class="set-tab" data-tab="${p.id}">${p.title}</button>`).join('')}
        </div>
        <div class="set-pages">
          ${PAGES.map((p) => `<div class="set-page" data-page="${p.id}">${p.rows.map((r) => this.rowHtml(r)).join('')}</div>`).join('')}
        </div>
      </section>

      <section class="scr scr--tuning" hidden>
        ${arrows}
        <button class="back-btn" data-go="lobby">Назад</button>
        <div class="tune-panel">
          <div class="tune-cats">
            ${TUNE_CATS.map((c) => `<button class="tune-cat" data-cat="${c.id}">${c.icon}<span>${c.label}</span></button>`).join('')}
            <button class="tune-cat tune-cat--reset" data-act="factory">${ICONS.wrench}<span>Заводская</span></button>
          </div>
          <div class="tune-items"></div>
        </div>
      </section>

      <section class="scr scr--shop scr--panel" hidden>
        <button class="back-tab" data-go="lobby">Назад</button>
        <div class="shop-grid"></div>
      </section>

      <section class="card card--pause" hidden>
        <h2>Пауза</h2>
        <button class="btn btn--yellow" data-act="resume">Продолжить</button>
        <button class="btn" data-act="restart">Заново</button>
        <button class="btn" data-act="quit">Завершить заезд</button>
      </section>
      <section class="card card--results" hidden>
        <h2></h2>
        <div class="results__score"></div>
        <dl class="results__grid"></dl>
        <div class="results__cash"></div>
        <button class="btn btn--yellow" data-act="restart">Ещё заезд</button>
        <button class="btn" data-act="menu">В лобби</button>
      </section>
    </div>`;
  }

  private rowHtml(r: Row): string {
    const label = `<div class="row__label">${r.label}</div>`;
    const hint = 'hint' in r && r.hint ? `<div class="row__hint">${r.hint}</div>` : '';
    let ctl = '';
    switch (r.kind) {
      case 'options':
        ctl = r.options
          .map(
            ([v, l]) =>
              `<button class="opt${r.icons ? ' opt--icon' : ''}" data-set="${r.key}" data-val="${v}" title="${l}">${
                r.icons ? driveIcon(v as 'FWD') + `<small>${l}</small>` : l
              }</button>`,
          )
          .join('');
        break;
      case 'stepper':
        ctl = `<div class="stepper" data-stepper="${r.key}">
          <button class="stepper__btn" data-step="-1" aria-label="Назад">${ICONS.left}</button>
          <span class="stepper__val"></span>
          <button class="stepper__btn" data-step="1" aria-label="Вперёд">${ICONS.right}</button></div>`;
        break;
      case 'toggles':
        ctl = r.keys.map(([k, l]) => `<button class="opt" data-toggle="${k}">${l}</button>`).join('');
        break;
      case 'slider':
        ctl = `<input class="slider" type="range" data-range="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}" /><output class="slider__val"></output>`;
        break;
      case 'check':
        ctl = `<button class="check" data-toggle="${r.key}" aria-label="${r.label}">${ICONS.check}</button>`;
        break;
      case 'info':
        ctl = `<div class="row__info">${r.html}</div>`;
        break;
    }
    const stepHint = r.kind === 'stepper' ? `<div class="row__hint" data-hint="${r.key}"></div>` : '';
    return `<div class="row row--${r.kind}">${label}<div class="row__ctl">${ctl}</div>${hint}${stepHint}</div>`;
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
    } else if (d.step) {
      const box = el.closest<HTMLElement>('[data-stepper]')!;
      const key = box.dataset.stepper as keyof Settings;
      const row = PAGES.flatMap((p) => p.rows).find((r) => r.kind === 'stepper' && r.key === key) as Extract<Row, { kind: 'stepper' }>;
      const i = row.options.findIndex(([v]) => v === this.settings[key]);
      const n = row.options.length;
      this.cb.onSettings({ [key]: row.options[(i + Number(d.step) + n) % n][0] } as Partial<Settings>);
    } else if (d.cat) {
      this.tuneCat = d.cat as TuneCat;
      this.renderTuning();
    } else if (d.tune) {
      const value = Number(d.value);
      this.cb.onTuning({ [d.tune]: value } as CarTuning);
    } else if (d.shop) {
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
          this.cb.onTuning(null);
          break;
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

  // ---------------------------------------------------------------- state

  go(screen: Screen): void {
    this.screen = screen;
    this.root.hidden = false;
    this.root.classList.remove('menu--dim');
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== screen;
    this.root.querySelector('.topbar')!.removeAttribute('hidden');
    this.root.querySelector('.tb-nav__title')!.textContent = TITLES[screen];
    this.root.dataset.screen = screen;
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
      btn.classList.toggle(btn.classList.contains('check') ? 'check--on' : 'opt--on', Boolean(s[btn.dataset.toggle as keyof Settings]));
    }
    for (const box of this.root.querySelectorAll<HTMLElement>('[data-stepper]')) {
      const key = box.dataset.stepper as keyof Settings;
      const row = PAGES.flatMap((p) => p.rows).find((r) => r.kind === 'stepper' && r.key === key) as Extract<Row, { kind: 'stepper' }>;
      const i = Math.max(0, row.options.findIndex(([v]) => v === s[key]));
      box.querySelector('.stepper__val')!.textContent = row.options[i][1];
      const hint = this.root.querySelector(`[data-hint="${key}"]`);
      if (hint) hint.textContent = row.hints[i];
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
    this.root.querySelector('.car-title__best')!.textContent = score > 0 ? `Рекорд: ${fmt(score)} очков · ${km.toFixed(1)} км` : '';
  }

  /** Model attribution (CC BY requires it to be visible). */
  setCredit(text: string): void {
    this.root.querySelector('.car-title__credit')!.textContent = text;
  }

  /** Short message at the bottom of the screen. */
  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.root.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  private selectPage(id: string): void {
    this.settingsPage = id;
    for (const t of this.root.querySelectorAll<HTMLElement>('.set-tab')) t.classList.toggle('set-tab--on', t.dataset.tab === id);
    for (const p of this.root.querySelectorAll<HTMLElement>('.set-page')) p.hidden = p.dataset.page !== id;
  }

  private renderCar(): void {
    const c = this.cars[this.carIndex];
    const st = this.stats[this.carIndex];
    const q = (sel: string) => this.root.querySelector<HTMLElement>(sel)!;
    q('.car-title__idx').textContent = `${this.carIndex + 1} / ${this.cars.length}`;
    q('.car-title__name').textContent = c.name;
    q('.car-title__tag').textContent = c.tagline;
    if (st) {
      const rows: [string, string, string, number][] = [
        [ICONS.speedo, 'Макс. скорость', `${fmt(st.topKmh)} км/ч`, st.topKmh / 320],
        [ICONS.power, 'Мощность', `${fmt(st.hp)} л.с.`, st.hp / 520],
        [ICONS.timer, 'Разгон 0–100', `${st.accel.toFixed(1).replace('.', ',')} с`, 1 - (st.accel - 3) / 14],
        [ICONS.weight, 'Вес', `${fmt(st.massKg)} кг`, st.massKg / 2000],
        [ICONS.drive, 'Привод', { RWD: 'Задний', FWD: 'Передний', AWD: 'Полный' }[c.handling.drivetrain], -1],
      ];
      q('.spec-card__rows').innerHTML = rows
        .map(
          ([icon, label, value, f]) => `<div class="spec">
            <span class="spec__icon">${icon}</span>
            <div class="spec__body"><div class="spec__line"><span>${label}:</span><b>${value}</b></div>
            ${f >= 0 ? `<i class="spec__bar"><u style="width:${Math.round(Math.min(1, Math.max(0.06, f)) * 100)}%"></u></i>` : ''}</div>
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
      ? `<button class="act act--tuning" data-go="tuning"><span>Тюнинг</span>${ICONS.wrench}</button>
         <button class="act act--play" data-act="play"><span>Играть</span></button>`
      : `<button class="act act--test" data-act="test"><span>Тест-драйв</span>${ICONS.video}</button>
         <button class="act act--buy${this.money >= price ? '' : ' act--poor'}" data-act="buy">
           <span>Купить</span><b>${ICONS.cash}${fmt(price)}</b></button>`;
    this.screens.lobby.classList.toggle('scr--locked', !owned);
  }

  private renderShop(): void {
    this.root.querySelector('.shop-grid')!.innerHTML = this.cars
      .map((c, i) => {
        const st = this.stats[i];
        const owned = this.owned.has(c.id);
        const price = this.prices[c.id] ?? 0;
        const status = i === this.carIndex && owned ? 'Выбрана' : owned ? 'Куплена' : `${ICONS.cash}${fmt(price)}`;
        return `<button class="shop-card${owned ? ' shop-card--owned' : ''}${i === this.carIndex ? ' shop-card--on' : ''}" data-shop="${i}">
          <small>${i + 1}</small><b>${c.name}</b>
          <span class="shop-card__specs">${st ? `${fmt(st.hp)} л.с. · ${fmt(st.topKmh)} км/ч · ${c.handling.drivetrain}` : ''}</span>
          <em class="shop-card__price${!owned && this.money < price ? ' shop-card__price--poor' : ''}">${owned ? '' : ICONS.lock}${status}</em>
        </button>`;
      })
      .join('');
  }

  private renderTuning(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.tune-cat[data-cat]')) b.classList.toggle('tune-cat--on', b.dataset.cat === this.tuneCat);
    const t = this.tuning;
    let html = '';
    const tile = (key: string, value: number, label: string, on: boolean, swatch?: number) =>
      `<button class="tune-item${on ? ' tune-item--on' : ''}" data-tune="${key}" data-value="${value}">
        ${swatch !== undefined ? `<span class="tune-item__swatch" style="--c:${hex(swatch)}"></span>` : ''}
        <span class="tune-item__label">${label}</span>${on ? `<span class="tune-item__check">${ICONS.check}</span>` : ''}</button>`;
    if (this.tuneCat === 'paint') html = PAINTS.map((p) => tile('paint', p.color, p.name, t.paint === p.color, p.color)).join('');
    else if (this.tuneCat === 'rim') html = RIMS.map((p) => tile('rim', p.color, p.name, t.rim === p.color, p.color)).join('');
    else if (this.tuneCat === 'tint') html = TINTS.map((p) => tile('tint', p.value, p.name, (t.tint ?? -1) === p.value)).join('');
    else html = DROPS.map((p) => tile('drop', p.value, p.name, (t.drop ?? 0) === p.value)).join('');
    this.root.querySelector('.tune-items')!.innerHTML = html;
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
    el.querySelector('h2')!.textContent = r.crashed ? 'Авария!' : 'Заезд завершён';
    el.querySelector('.results__score')!.innerHTML = `${fmt(r.score)}<small>${r.newBest ? 'новый рекорд!' : 'очков'}</small>`;
    el.querySelector('.results__grid')!.innerHTML = `
      <dt>Дистанция</dt><dd>${r.km.toFixed(2)} км</dd>
      <dt>Опасных сближений</dt><dd>${r.nearMisses}</dd>
      <dt>Лучшее комбо</dt><dd>×${r.maxCombo.toFixed(2)}</dd>
      <dt>Рекорд</dt><dd>${fmt(r.best)}</dd>`;
    el.querySelector('.results__cash')!.innerHTML = r.testDrive
      ? 'Тест-драйв: деньги не начисляются'
      : `${ICONS.cash}<b>+${fmt(r.earned)}</b>`;
    this.showCard('results');
  }
}
