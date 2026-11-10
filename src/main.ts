import * as THREE from 'three';
import { KMH } from './config';
import { PLAYER_CARS, findPlayerCar, type VehicleSpec } from './assets/vehicles';
import { creditFor } from './assets/credits';
import { VehicleLoader } from './assets/VehicleLoader';
import { AudioEngine } from './audio/AudioEngine';
import { events, type LightingPreset } from './core/EventBus';
import { GameLoop } from './core/GameLoop';
import { Input } from './core/Input';
import { DENSITY_SCALE, PACE_SCALE, sanitizeSettings, type Quality, type Settings } from './core/Settings';
import { AD_REWARD, CAR_PRICES, START_MONEY, priceOf, runPayout, type CarTuning } from './gameplay/economy';
import { MAPS, findMap, type MapDef } from './gameplay/maps';
import { Scoring, resolveTrafficContacts } from './gameplay/Scoring';
import { CameraRig } from './graphics/CameraRig';
import { Environment } from './graphics/Environment';
import { Materials } from './graphics/Materials';
import { PostFX } from './graphics/PostFX';
import { Scenery } from './graphics/Scenery';
import { Showroom } from './graphics/Showroom';
import { StreetLightPool } from './graphics/StreetLightPool';
import { RoadStreamer } from './road/RoadStreamer';
import { initPlatform } from './platform/YandexPlatform';
import { TrafficSystem, type PlayerState } from './traffic/TrafficSystem';
import { TRAFFIC_TYPES, TrafficView } from './traffic/TrafficView';
import { Hud } from './ui/Hud';
import { Menu, type CarStats, type Screen } from './ui/Menu';
import { CarView } from './vehicle/CarView';
import { PlayerCar } from './vehicle/PlayerCar';

/**
 * Floating origin step. Everything road-related lives under `world`, whose
 * z offset absorbs the travelled distance so GPU-side coordinates stay small.
 * Must be a multiple of the grass tile (12 m) to keep the terrain texture stable.
 */
const ORIGIN_STEP = 1200;
/** Closing speed (m/s) above which a traffic hit ends the run. */
const WRECK_SPEED = 13;
const START_SPEED = 80 * KMH;

const LANE_LABELS: Record<number, string> = { [-1]: 'Карман слева', 0: 'Ряд 1', 1: 'Ряд 2', 2: 'Ряд 3', 3: 'Карман справа' };

/** Graphics presets: pixel-ratio cap, sun shadow map, MSAA, bloom, speed lens effects. */
const QUALITY: Record<Quality, { pr: number; shadow: number; samples: number; bloom: boolean; lens: boolean }> = {
  low: { pr: 1, shadow: 0, samples: 0, bloom: false, lens: false },
  medium: { pr: 1.25, shadow: 1024, samples: 0, bloom: true, lens: true },
  high: { pr: 1.5, shadow: 2048, samples: 4, bloom: true, lens: true },
  ultra: { pr: 2, shadow: 4096, samples: 8, bloom: true, lens: true },
};

type Mode = 'lobby' | 'play' | 'paused' | 'wreck' | 'results';

interface SaveData {
  car?: string;
  map?: string;
  bestKm?: number;
  bestScore?: number;
  /** Legacy (pre-settings) volume. */
  volume?: number;
  money?: number;
  owned?: string[];
  tuning?: Record<string, CarTuning>;
  settings?: Partial<Settings>;
  name?: string;
}

/** 0–100 km/h time from the real physics, for the garage card. */
function measureCar(spec: VehicleSpec, layout: RoadStreamer['layout']): CarStats {
  const car = new PlayerCar(layout, spec.handling, spec.length * 0.6, spec.width, spec.length);
  car.s = 1e5;
  car.speed = 0;
  let t = 0;
  while (car.speed < 100 * KMH && t < 40) {
    car.update(1 / 60, { throttle: 1, brake: 0, steer: 0 });
    t += 1 / 60;
  }
  const h = spec.handling;
  return { topKmh: h.topSpeed / KMH, hp: h.powerW / 735.5, massKg: h.massKg, accel: t };
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  // ?map=night|rush|sunset, ?car=<id>, ?play=1 (skip the lobby), ?intro=0, ?s=<meters>, ?cam=bumper
  const params = new URLSearchParams(location.search);
  const hud = new Hud(document.body);
  events.on('loading:progress', ({ label, progress }) => hud.progress(label, progress));
  const step = (label: string, progress: number) => {
    events.emit('loading:progress', { label, progress });
    // Yield so the loading bar repaints between heavy synchronous steps.
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  };

  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    // No logarithmic depth: gl_FragDepth disables early-Z (costly on mobile) and broke
    // the road's depth under heavy light counts. Coplanar layers use polygonOffset instead.
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);
  let origin = 0;

  await step('Генерация асфальта и материалов…', 0.1);
  const mats = new Materials(renderer.capabilities.getMaxAnisotropy(), mobile);

  await step('Загрузка HDRI и автомобилей…', 0.25);
  const env = new Environment(renderer, scene, mobile);
  const envReady = env.preloadAll();
  const showroom = new Showroom(renderer, { mobile });
  const showroomReady = showroom.load();
  const loader = new VehicleLoader();
  // The SDK must be up before anything is saved or reported; locally this falls back instantly.
  const platform = await initPlatform();
  const save: SaveData = await platform.loadData<SaveData>();
  const settings = sanitizeSettings({ volume: save.volume, ...save.settings }, mobile);

  // Garage: free cars are always owned; a pre-economy save keeps the car it was using.
  const owned = new Set<string>(save.owned ?? []);
  for (const c of PLAYER_CARS) if (priceOf(c.id) === 0) owned.add(c.id);
  if (save.money === undefined && save.car) owned.add(save.car);
  let money = save.money ?? START_MONEY;
  const tunings: Record<string, CarTuning> = save.tuning ?? {};
  if (!save.name) save.name = `Игрок_${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const persist = () => {
    save.money = money;
    save.owned = [...owned];
    save.tuning = tunings;
    save.settings = settings;
    delete save.volume;
    void platform.saveData(save);
  };

  let spec: VehicleSpec = findPlayerCar(params.get('car') ?? save.car ?? null);
  if (!owned.has(spec.id) && !params.get('car')) spec = PLAYER_CARS[0];
  let map: MapDef = findMap(params.get('map') ?? save.map);
  const viewReady = CarView.create(loader, spec);
  const trafficView = new TrafficView(scene, loader);
  const trafficReady = trafficView.preload(mobile ? 1 : 2);

  await step('Процедурная трасса…', 0.5);
  const road = new RoadStreamer(world, mats);
  road.viewAhead = settings.drawDistance;
  road.prime(0);
  const scenery = new Scenery(scene, world, mats, mobile);
  // 4 street lamps + the player's beam: more makes the clear-coat road shader too heavy
  // (it stopped rasterising under SwiftShader at 8 spot lights).
  const lights = new StreetLightPool(scene, road, 4);

  const rig = new CameraRig(innerWidth / innerHeight, params.get('intro') === '0');
  rig.mode = (params.get('cam') as Settings['camera'] | null) ?? settings.camera;
  const post = new PostFX(renderer, scene, rig.camera, mobile);
  post.setSize(innerWidth, innerHeight);
  showroom.setAspect(innerWidth / innerHeight);
  const input = new Input();
  const audio = new AudioEngine();
  audio.setCar(spec.id);

  let view = await viewReady;
  const car = new PlayerCar(road.layout, spec.handling, view.model.wheelbase, view.model.width, view.model.length);
  car.speed = START_SPEED;
  const stats = PLAYER_CARS.map((c) => measureCar(c, road.layout));

  await step('Трафик…', 0.7);
  await trafficReady;
  await envReady;
  await showroomReady;
  await step('Свет и тени…', 0.85);

  // ---------------------------------------------------------------- settings
  let loop: GameLoop | null = null;
  const applyGraphics = () => {
    const q = QUALITY[settings.quality];
    const pr = Math.min(devicePixelRatio, mobile ? Math.min(q.pr, 1.5) : q.pr) * settings.resolution;
    renderer.setPixelRatio(pr);
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
    post.setQuality(mobile ? 0 : q.samples, q.bloom, q.lens);
    env.setShadowSize(mobile ? Math.min(q.shadow, 1024) : q.shadow);
  };
  const applySettings = () => {
    audio.setVolume(settings.volume);
    rig.inertia = settings.cameraInertia;
    car.setup = {
      gearbox: settings.gearbox,
      style: settings.style,
      drive: settings.drive,
      abs: settings.abs,
      esp: settings.esp,
      tcs: settings.tcs,
    };
    hud.setManual(settings.gearbox === 'manual' && !spec.handling.cvt);
    road.viewAhead = settings.drawDistance;
    env.setDrawDistance(settings.drawDistance);
    trafficView.setGhost(settings.ghostTraffic);
    if (loop) loop.fpsLimit = settings.fpsLimit;
  };
  applyGraphics();
  applySettings();

  const applyPreset = async (preset: LightingPreset) => {
    await env.apply(preset);
    mats.applyPreset(preset);
    post.applyPreset(preset);
    const night = preset === 'night';
    lights.setEnabled(night);
    if (mode !== 'lobby') view.setNight(night);
    trafficView.setNight(night);
    events.emit('preset:changed', preset);
  };

  // ---------------------------------------------------------------- traffic
  const pstate: PlayerState = { s: 0, x: 0, speed: 0, psi: 0, length: car.length, width: car.width };
  const syncPlayerState = () => {
    pstate.s = car.s;
    pstate.x = car.x;
    pstate.speed = car.speed;
    pstate.psi = car.psi;
    pstate.length = car.length;
    pstate.width = car.width;
  };
  let trafficSeed = 11;
  let traffic!: TrafficSystem;
  const resetTraffic = () => {
    trafficView.clear();
    const scale = DENSITY_SCALE[settings.trafficDensity];
    traffic = new TrafficSystem(road.layout, TRAFFIC_TYPES, {
      maxCars: Math.round((mobile ? 22 : 30) * Math.min(1.5, Math.max(0.7, scale))),
      density: map.density * scale,
      pace: PACE_SCALE[settings.trafficPace],
      laneChanges: settings.trafficLaneChanges,
      seed: trafficSeed++,
    });
    traffic.onSpawn = (c) => trafficView.add(c);
    traffic.onDespawn = (c) => trafficView.remove(c);
    syncPlayerState();
    traffic.populate(pstate);
  };

  // ---------------------------------------------------------------- car & scenes
  let mode: Mode = 'lobby';
  const dims = () => ({ length: view.model.length, width: view.model.width, height: view.model.height });
  /** Lobby: the car parks in the showroom with its lights on. */
  const toShowroom = () => {
    view.park();
    view.setNight(true);
    showroom.setCar(view.model.root, dims());
  };
  const toRoad = () => {
    scene.add(view.model.root);
    view.setNight(env.preset === 'night');
  };
  const showCar = async () => {
    hud.setCar(spec.name, spec.tagline);
    const credit = await creditFor(view.model.source);
    menu.setCredit(credit ? `Модель: «${credit.title}» — ${credit.author}, ${credit.license}` : '');
  };

  let switching: Promise<void> | null = null;
  let wanted: VehicleSpec = spec;
  /** Loads and shows `next`; rapid clicks collapse to the last requested car. */
  const switchCar = (next: VehicleSpec): Promise<void> => {
    wanted = next;
    if (switching) return switching;
    switching = (async () => {
      try {
        while (wanted.id !== spec.id) {
          const target = wanted;
          const nextView = await CarView.create(loader, target);
          nextView.applyTuning(tunings[target.id] ?? {});
          nextView.setNight(true);
          if (mode === 'lobby') {
            nextView.park();
            await renderer.compileAsync(nextView.model.root, showroom.camera, showroom.scene);
          }
          view.dispose();
          view.model.root.removeFromParent();
          view = nextView;
          spec = target;
          if (mode === 'lobby') showroom.setCar(view.model.root, dims());
          else toRoad();
          car.setVehicle(spec.handling, view.model.wheelbase, view.model.width, view.model.length);
          applySettings();
          audio.setCar(spec.id);
          void showCar();
          if (owned.has(spec.id)) {
            save.car = spec.id;
            persist();
          }
        }
      } finally {
        switching = null;
      }
    })();
    return switching;
  };

  const setMap = async (next: MapDef) => {
    if (next.id === map.id) return;
    map = next;
    save.map = map.id;
    persist();
    await applyPreset(map.preset);
  };

  // Optional start offset (?s=meters) is handy for jumping straight to a pocket.
  const startS = Number(params.get('s') ?? 0);
  if (startS > 0) {
    car.s = startS;
    origin = Math.floor(startS / ORIGIN_STEP) * ORIGIN_STEP;
    world.position.z = origin;
    road.prime(startS);
  }
  await applyPreset(map.preset);
  resetTraffic();

  const cameraTarget = () => ({
    x: car.x,
    s: car.s,
    psi: car.psi,
    speed: car.speed,
    latAccel: car.latAccel,
    longAccel: car.longAccel,
    length: view.model.length,
    height: view.model.height,
  });

  // Compile every program up front (road scene with the car and the traffic pool, then the showroom).
  view.applyTuning(tunings[spec.id] ?? {});
  scene.add(view.model.root);
  view.update(0.016, car, origin);
  trafficView.update(0.016, traffic.cars, origin);
  rig.update(0.016, cameraTarget(), origin);
  const warm = trafficView.warm();
  scene.add(warm);
  await renderer.compileAsync(scene, rig.camera);
  scene.remove(warm);
  trafficView.unwarm(warm);
  toShowroom();
  showroom.snap();
  await renderer.compileAsync(showroom.scene, showroom.camera);
  await step('Готово', 1);
  hud.hideLoader();
  platform.loadingReady();

  // -------------------------------------------------------------- game state
  let adPaused = false;
  const scoring = new Scoring();
  scoring.best = save.bestScore ?? 0;
  let runStart = car.s;
  let maxCombo = 1;
  let wreckT = 0;
  let crashed = false;
  let testDrive = false;
  /** Seconds each aid lamp stays lit after the aid last intervened. */
  const aidT = { abs: 0, esp: 0, tcs: 0 };

  scoring.onEvent = (e) => {
    if (mode !== 'play') return;
    hud.event(e);
    if (e.kind === 'near' || e.kind === 'crazy') audio.nearMiss(e.kind === 'crazy', 0);
    else if (e.kind === 'squeeze') audio.squeeze();
    else if (e.kind === 'combo-lost' || e.kind === 'crash') audio.comboLost();
    maxCombo = Math.max(maxCombo, scoring.multiplier);
  };

  const refreshWallet = () => {
    menu.setMoney(money);
    menu.setGarage(owned, CAR_PRICES, stats);
  };

  const menu = new Menu(document.body, PLAYER_CARS, MAPS, {
    onCar: (i) => {
      testDrive = false;
      menu.setTuning(tunings[PLAYER_CARS[i].id] ?? {});
      void switchCar(PLAYER_CARS[i]);
    },
    onBuy: (i) => {
      const c = PLAYER_CARS[i];
      const price = priceOf(c.id);
      if (owned.has(c.id)) return;
      if (money < price) {
        menu.toast(`Не хватает ${(price - money).toLocaleString('ru-RU')} — заработайте в заездах или посмотрите рекламу`);
        return;
      }
      money -= price;
      owned.add(c.id);
      save.car = c.id;
      persist();
      refreshWallet();
      audio.squeeze();
      menu.toast(`${c.name} — теперь ваша!`);
    },
    onTestDrive: (i) => {
      void platform.showRewarded().then((ok) => {
        if (!ok || PLAYER_CARS[i].id !== spec.id) return;
        testDrive = true;
        menu.go('maps');
      });
    },
    onPlay: (i) => void startRun(MAPS[i]),
    onScreen: (s: Screen) => {
      if (mode !== 'lobby') return;
      showroom.setView(s === 'tuning' ? 'tuning' : s === 'lobby' || s === 'maps' ? 'lobby' : 'settings');
      showroom.setActive(s === 'lobby' || s === 'tuning');
      if (s === 'lobby') testDrive = false;
    },
    onSettings: (patch) => {
      const graphics = 'quality' in patch || 'resolution' in patch;
      Object.assign(settings, patch);
      if ('camera' in patch) rig.mode = settings.camera;
      applySettings();
      if (graphics) applyGraphics();
      menu.setSettings(settings);
      persist();
    },
    onTuning: (patch) => {
      if (!owned.has(spec.id)) {
        menu.toast('Тюнинг доступен после покупки машины');
        return;
      }
      if (patch?.paint !== undefined && !view.paintable) {
        menu.toast('У этой машины заводская ливрея — покраска недоступна');
        return;
      }
      const t = patch === null ? {} : { ...(tunings[spec.id] ?? {}), ...patch };
      tunings[spec.id] = t;
      view.applyTuning(t);
      view.park();
      menu.setTuning(t);
      persist();
    },
    onReward: () => {
      void platform.showRewarded().then((ok) => {
        if (!ok) return;
        money += AD_REWARD;
        persist();
        refreshWallet();
        menu.toast(`+${AD_REWARD.toLocaleString('ru-RU')} за просмотр`);
      });
    },
    onRestart: () => {
      void platform.showInterstitial();
      void startRun(map);
    },
    onResume: () => setPaused(false),
    onQuit: () => endRun(false),
    onMenu: () => {
      void platform.showInterstitial();
      toLobby();
    },
    onClick: () => {
      audio.unlock();
      audio.click();
    },
  });
  menu.setRewardAmount(AD_REWARD);
  menu.setSettings(settings);
  menu.setCar(Math.max(0, PLAYER_CARS.indexOf(spec)));
  menu.setTuning(tunings[spec.id] ?? {});
  refreshWallet();
  menu.setBest(save.bestScore ?? 0, save.bestKm ?? 0);
  void platform.playerName().then((n) => menu.setPlayerName(n || save.name!));
  menu.setPlayerName(save.name);
  void showCar();
  persist();

  function toLobby(): void {
    mode = 'lobby';
    testDrive = false;
    hud.setPlaying(false);
    // A car being test-driven goes back to the player's own one.
    if (!owned.has(spec.id) && save.car && owned.has(save.car)) {
      menu.setCar(PLAYER_CARS.findIndex((c) => c.id === save.car));
      void switchCar(findPlayerCar(save.car));
    }
    toShowroom();
    showroom.snap();
    menu.go('lobby');
    menu.setBest(save.bestScore ?? 0, save.bestKm ?? 0);
    audio.setMuted(adPaused);
    platform.gameplayStop();
  }

  async function startRun(next: MapDef): Promise<void> {
    audio.unlock();
    if (!owned.has(spec.id) && !testDrive) return;
    if (switching) await switching;
    await setMap(next);
    toRoad();
    // A fresh, straight start in the middle lane with the traffic re-seeded around us.
    car.x = road.layout.laneCenter(1, car.s);
    car.psi = 0;
    car.speed = START_SPEED;
    resetTraffic();
    scoring.reset();
    runStart = car.s;
    maxCombo = 1;
    crashed = false;
    mode = 'play';
    showroom.setActive(false);
    rig.showcase = false;
    if (params.get('intro') !== '0') rig.restartIntro();
    menu.hide();
    hud.setPlaying(true);
    audio.setMuted(adPaused);
  }

  function setPaused(p: boolean): void {
    if (p && mode === 'play') {
      mode = 'paused';
      menu.showPause();
      audio.setMuted(true);
      platform.gameplayStop();
    } else if (!p && mode === 'paused') {
      mode = 'play';
      menu.hide();
      audio.setMuted(adPaused);
    }
  }

  function endRun(wrecked: boolean): void {
    if (mode !== 'play' && mode !== 'paused' && mode !== 'wreck') return;
    mode = 'results';
    platform.gameplayStop();
    hud.setPlaying(false);
    const km = (car.s - runStart) / 1000;
    const prevBest = save.bestScore ?? 0;
    const newBest = scoring.score > prevBest;
    const earned = testDrive || settings.ghostTraffic ? 0 : runPayout(scoring.score, km, wrecked);
    money += earned;
    save.bestScore = Math.max(prevBest, Math.round(scoring.score));
    save.bestKm = Math.max(save.bestKm ?? 0, Math.round(km * 100) / 100);
    persist();
    refreshWallet();
    void platform.submitScore('distance', Math.round(km * 1000));
    menu.showResults({
      score: scoring.score,
      km,
      nearMisses: scoring.nearMisses,
      maxCombo,
      best: save.bestScore,
      newBest,
      crashed: wrecked,
      earned,
      testDrive,
    });
    audio.setMuted(true);
  }

  hud.onPause = () => setPaused(true);
  hud.onTouch = (a, down) => {
    audio.unlock();
    input.setTouch(a, down);
  };
  hud.onShift = (dir) => (dir > 0 ? car.shiftUp() : car.shiftDown());
  const shift = (dir: 1 | -1) => {
    if (mode !== 'play' || settings.gearbox !== 'manual') return;
    if (dir > 0) car.shiftUp();
    else car.shiftDown();
  };
  input.onKey('KeyE', () => shift(1));
  input.onKey('ShiftLeft', () => shift(1));
  input.onKey('KeyQ', () => shift(-1));
  input.onKey('ControlLeft', () => shift(-1));
  input.onKey('KeyN', () => void applyPreset(env.preset === 'golden' ? 'day' : env.preset === 'day' ? 'night' : 'golden'));
  input.onKey('KeyH', () => hud.toggle());
  input.onKey('KeyC', () => {
    rig.toggleMode();
    settings.camera = rig.mode;
    menu.setSettings(settings);
    persist();
  });
  input.onKey('Escape', () => {
    if (mode === 'play') setPaused(true);
    else if (mode === 'paused') setPaused(false);
    else if (mode === 'lobby') menu.back();
  });
  input.onKey('KeyP', () => (mode === 'play' ? setPaused(true) : mode === 'paused' ? setPaused(false) : undefined));
  const confirm = () => {
    if (mode !== 'lobby') return;
    if (menu.current === 'lobby' && owned.has(spec.id)) menu.go('maps');
    else if (menu.current === 'maps') void startRun(map);
  };
  input.onKey('Enter', confirm);
  input.onKey('Space', confirm);
  // Keys 1–9, then 0 for the tenth car (lobby only: no mid-run swaps).
  PLAYER_CARS.forEach((c, i) =>
    input.onKey(`Digit${(i + 1) % 10}`, () => {
      if (mode !== 'lobby') return;
      menu.setCar(i);
      menu.setTuning(tunings[c.id] ?? {});
      void switchCar(c);
    }),
  );
  platform.onPauseChange((p) => {
    adPaused = p;
    audio.setMuted(p || (mode !== 'play' && mode !== 'lobby'));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });

  const onResize = () => {
    renderer.setSize(innerWidth, innerHeight);
    rig.setAspect(innerWidth / innerHeight);
    showroom.setAspect(innerWidth / innerHeight);
    post.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);

  const focus = new THREE.Vector3();
  let time = 0;
  let hudTimer = 0;
  const controls = { throttle: 0, brake: 0, steer: 0 };

  loop = new GameLoop({
    fixedUpdate: (dt) => {
      // The lobby, ads, hidden tabs and the pause menu freeze the simulation.
      if (adPaused || mode === 'lobby' || mode === 'paused' || mode === 'results') return;
      if (mode === 'wreck') {
        controls.throttle = 0;
        controls.brake = 0.6;
        controls.steer = 0;
      } else {
        // Controls stay locked until the intro crane shot lands.
        const live = rig.introDone;
        if (live) platform.gameplayStart();
        controls.throttle = live && input.isDown('throttle') ? 1 : 0;
        controls.brake = live && input.isDown('brake') ? 1 : 0;
        controls.steer = live ? input.steer : 0;
      }
      car.update(dt, controls);
      for (const k of ['abs', 'esp', 'tcs'] as const) {
        const on = k === 'abs' ? car.absActive : k === 'esp' ? car.espActive : car.tcsActive;
        aidT[k] = on ? 0.35 : Math.max(0, aidT[k] - dt);
      }
      syncPlayerState();
      traffic.update(dt, pstate);
      // Ghost traffic: no contacts and no points.
      const hit = settings.ghostTraffic ? 0 : resolveTrafficContacts(car, traffic);
      if (hit > 0.4) {
        rig.bump(hit);
        audio.impact(hit);
        if (mode === 'play') {
          scoring.crash();
          if (hit > WRECK_SPEED) {
            mode = 'wreck';
            crashed = true;
            wreckT = 1.6;
          }
        }
      }
      if (mode === 'play' && !settings.ghostTraffic) scoring.update(dt, car, traffic.cars);
    },
    update: (dt) => {
      time += dt;
      if (mode === 'lobby') {
        showroom.update(dt);
        audio.update(dt, {
          speed: 0,
          topSpeed: spec.handling.topSpeed,
          throttle: 0,
          brake: 0,
          slip: 0,
          traffic: null,
          engine: { rpm: spec.handling.idleRpm, gear: 1, shifting: false },
        });
        return;
      }
      if (mode === 'wreck') {
        wreckT -= dt;
        if (wreckT <= 0) endRun(crashed);
      }
      if (car.s - origin > ORIGIN_STEP) {
        origin += ORIGIN_STEP;
        world.position.z = origin;
      }
      if (car.impact > 0) {
        rig.bump(car.impact);
        if (car.impact > 1) {
          audio.scrape(car.impact, Math.sign(car.x));
          if (mode === 'play') scoring.crash();
        }
        car.impact = 0;
      }
      road.update(car.s);
      view.update(dt, car, origin);
      trafficView.update(dt, traffic.cars, origin);
      rig.update(dt, cameraTarget(), origin);
      focus.set(car.x, 0, -(car.s - origin) - 18);
      env.follow(focus);
      lights.update(car.s, origin);
      scenery.update(rig.camera.position, car.s);
      post.update(mode === 'play' && rig.introDone ? car.speed / (300 * KMH) : 0, time);

      // Closest traffic car for the pass-by whoosh.
      let near: { dx: number; ds: number; v: number } | null = null;
      let best = 30;
      for (const c of traffic.cars) {
        const d = Math.hypot(c.x - car.x, c.s - car.s);
        if (d < best) {
          best = d;
          near = { dx: c.x - car.x, ds: c.s - car.s, v: c.v };
        }
      }
      audio.update(dt, {
        speed: car.speed,
        topSpeed: spec.handling.topSpeed,
        throttle: controls.throttle,
        brake: controls.brake,
        slip: Math.max(car.tireSlip * 1.4, car.wheelspin),
        traffic: near,
        engine: { rpm: car.rpm, gear: car.gear, shifting: car.shifting },
      });

      hudTimer -= dt;
      if (hudTimer <= 0 && mode === 'play') {
        hudTimer = 0.05;
        const zone = road.layout.zoneAt(car.s + 200) ?? road.layout.zoneAt(car.s);
        let pocketInfo = '';
        if (zone) {
          const side = zone.side === 1 ? 'справа' : 'слева';
          if (car.s < zone.start) pocketInfo = `карман ${side} через ${Math.round(zone.start - car.s)} м`;
          else if (car.s < zone.fullEnd) pocketInfo = `карман ${side}, сужение через ${Math.round(zone.fullEnd - car.s)} м`;
          else pocketInfo = 'сужение';
        }
        hud.update({
          speedKmh: car.speed / KMH,
          fps: loop!.fps,
          showFps: settings.showFps,
          laneLabel: LANE_LABELS[car.laneIndex] ?? 'Обочина',
          pocketInfo,
          score: scoring.score,
          multiplier: scoring.multiplier,
          comboLeft: scoring.multiplier > 1 ? scoring.comboTimer / 3.5 : 0,
          km: (car.s - runStart) / 1000,
          rpm01: car.rpm / spec.handling.redline,
          gear: spec.handling.cvt ? 'D' : String(car.gear),
          abs: aidT.abs > 0,
          esp: aidT.esp > 0,
          tcs: aidT.tcs > 0,
        });
      }
    },
    render: () => {
      if (mode === 'lobby') showroom.render(renderer);
      else post.render(1 / 60);
    },
  });
  loop.fpsLimit = settings.fpsLimit;
  hud.setRedline(0.94);
  loop.start();

  if (params.get('play') === '1') {
    // Debug start: a car the profile doesn't own runs as a test drive.
    testDrive = !owned.has(spec.id);
    void startRun(map);
  } else toLobby();

  // Debug handle for console tinkering and automated screenshots.
  Object.assign(window, {
    __game: {
      renderer, scene, car, road, env, rig, showroom, menu, settings, applyPreset, switchCar, platform, scoring, audio, startRun, endRun, setPaused,
      get traffic() { return traffic; },
      get view() { return view; },
      get mode() { return mode; },
      get money() { return money; },
    },
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="fatal">Не удалось запустить WebGL: ${String(err?.message ?? err)}</div>`,
  );
});
