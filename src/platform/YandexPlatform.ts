/**
 * Yandex Games SDK adapter (https://yandex.ru/dev/games/doc/ru/sdk/sdk-about).
 *
 * On Yandex Games (or under `npx @yandex-games/sdk-dev-proxy`) the platform
 * serves `/sdk.js`; anywhere else the script 404s and a local stand-in with the
 * same surface takes over, so the game code never branches on the platform.
 */

export interface Platform {
  readonly kind: 'yandex' | 'local';
  /** Game finished loading and is interactive (LoadingAPI.ready). */
  loadingReady(): void;
  /** Active play started/stopped (GameplayAPI); safe to call repeatedly. */
  gameplayStart(): void;
  gameplayStop(): void;
  loadData<T extends object>(): Promise<Partial<T>>;
  saveData(data: object): Promise<void>;
  submitScore(leaderboard: string, score: number): Promise<void>;
  /** Interstitial; resolves true if an ad was actually shown. */
  showInterstitial(): Promise<boolean>;
  /** Rewarded video; resolves true if the reward should be granted. */
  showRewarded(): Promise<boolean>;
  /** Display name of the signed-in player, or '' when anonymous. */
  playerName(): Promise<string>;
  /** Paused by the platform (ads) or by the tab being hidden. */
  onPauseChange(cb: (paused: boolean) => void): void;
}

/* Minimal typings for the parts of the SDK used here. */
interface YaPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: object, flush?: boolean): Promise<void>;
  getName?(): string;
}
interface YaSdk {
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  getPlayer(opts?: { scopes?: boolean }): Promise<YaPlayer>;
  isAvailableMethod(name: string): Promise<boolean>;
  leaderboards: { setScore(name: string, score: number): Promise<void> };
  adv: {
    showFullscreenAdv(o: { callbacks: { onOpen?(): void; onClose?(wasShown: boolean): void; onError?(e: unknown): void; onOffline?(): void } }): void;
    showRewardedVideo(o: { callbacks: { onOpen?(): void; onRewarded?(): void; onClose?(): void; onError?(e: unknown): void } }): void;
  };
}
declare global {
  interface Window {
    YaGames?: { init(opts?: object): Promise<YaSdk> };
  }
}

const SDK_URL = '/sdk.js';
const STORAGE_KEY = 'city-flow-shashki:save';
/** Yandex rejects interstitials shown more often than this. */
const INTERSTITIAL_COOLDOWN_MS = 60_000;

abstract class BasePlatform implements Platform {
  abstract readonly kind: 'yandex' | 'local';
  abstract playerName(): Promise<string>;
  private pauseListeners: ((paused: boolean) => void)[] = [];
  private adPaused = false;
  private hidden = document.hidden;
  private playing = false;
  private lastInterstitial = 0;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.emitPause();
    });
  }

  onPauseChange(cb: (paused: boolean) => void): void {
    this.pauseListeners.push(cb);
  }

  protected setAdPaused(on: boolean): void {
    this.adPaused = on;
    this.emitPause();
  }

  private emitPause(): void {
    const paused = this.adPaused || this.hidden;
    // GameplayAPI must not report play while an ad or a hidden tab blocks it.
    if (paused) this.rawStop();
    else if (this.playing) this.rawStart();
    this.pauseListeners.forEach((cb) => cb(paused));
  }

  gameplayStart(): void {
    this.playing = true;
    if (!this.adPaused && !this.hidden) this.rawStart();
  }

  gameplayStop(): void {
    this.playing = false;
    this.rawStop();
  }

  async showInterstitial(): Promise<boolean> {
    if (Date.now() - this.lastInterstitial < INTERSTITIAL_COOLDOWN_MS) return false;
    this.lastInterstitial = Date.now();
    return this.rawInterstitial();
  }

  abstract loadingReady(): void;
  abstract loadData<T extends object>(): Promise<Partial<T>>;
  abstract saveData(data: object): Promise<void>;
  abstract submitScore(leaderboard: string, score: number): Promise<void>;
  abstract showRewarded(): Promise<boolean>;
  protected abstract rawStart(): void;
  protected abstract rawStop(): void;
  protected abstract rawInterstitial(): Promise<boolean>;
}

class YandexPlatform extends BasePlatform {
  readonly kind = 'yandex';
  private player: Promise<YaPlayer | null>;
  private started = false;

  constructor(private readonly sdk: YaSdk) {
    super();
    this.player = sdk.getPlayer({ scopes: false }).catch(() => null);
  }

  loadingReady(): void {
    this.sdk.features.LoadingAPI?.ready();
  }

  protected rawStart(): void {
    if (this.started) return;
    this.started = true;
    this.sdk.features.GameplayAPI?.start();
  }

  protected rawStop(): void {
    if (!this.started) return;
    this.started = false;
    this.sdk.features.GameplayAPI?.stop();
  }

  async loadData<T extends object>(): Promise<Partial<T>> {
    const p = await this.player;
    return ((await p?.getData().catch(() => ({}))) ?? {}) as Partial<T>;
  }

  async saveData(data: object): Promise<void> {
    const p = await this.player;
    await p?.setData(data).catch(() => undefined);
  }

  async playerName(): Promise<string> {
    const p = await this.player;
    try {
      return p?.getName?.() ?? '';
    } catch {
      return '';
    }
  }

  async submitScore(leaderboard: string, score: number): Promise<void> {
    // Only authorized players can post scores.
    if (!(await this.sdk.isAvailableMethod('leaderboards.setScore').catch(() => false))) return;
    await this.sdk.leaderboards.setScore(leaderboard, Math.max(0, Math.round(score))).catch(() => undefined);
  }

  protected rawInterstitial(): Promise<boolean> {
    return new Promise((resolve) => {
      this.sdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => this.setAdPaused(true),
          onClose: (wasShown) => {
            this.setAdPaused(false);
            resolve(wasShown);
          },
          onError: () => {
            this.setAdPaused(false);
            resolve(false);
          },
          onOffline: () => resolve(false),
        },
      });
    });
  }

  showRewarded(): Promise<boolean> {
    return new Promise((resolve) => {
      let rewarded = false;
      this.sdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => this.setAdPaused(true),
          onRewarded: () => (rewarded = true),
          onClose: () => {
            this.setAdPaused(false);
            resolve(rewarded);
          },
          onError: () => {
            this.setAdPaused(false);
            resolve(false);
          },
        },
      });
    });
  }
}

/** Offline stand-in: localStorage saves, console-logged ads and leaderboard. */
class LocalPlatform extends BasePlatform {
  readonly kind = 'local';

  loadingReady(): void {
    console.info('[platform] LoadingAPI.ready (local)');
  }

  protected rawStart(): void {}
  protected rawStop(): void {}

  async loadData<T extends object>(): Promise<Partial<T>> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<T>;
    } catch {
      return {};
    }
  }

  async saveData(data: object): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota: saving is best-effort */
    }
  }

  async submitScore(leaderboard: string, score: number): Promise<void> {
    console.info(`[platform] leaderboard "${leaderboard}" ← ${Math.round(score)} (local)`);
  }

  protected async rawInterstitial(): Promise<boolean> {
    console.info('[platform] interstitial ad (local, skipped)');
    return false;
  }

  async showRewarded(): Promise<boolean> {
    console.info('[platform] rewarded video (local, granted)');
    return true;
  }

  async playerName(): Promise<string> {
    return '';
  }
}

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => resolve(false), timeoutMs);
    s.src = src;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

/** Connects to Yandex Games when available; `?platform=local` forces the stand-in. */
export async function initPlatform(): Promise<Platform> {
  if (new URLSearchParams(location.search).get('platform') !== 'local' && (await loadScript(SDK_URL, 4000)) && window.YaGames) {
    try {
      return new YandexPlatform(await window.YaGames.init());
    } catch (err) {
      console.warn('[platform] YaGames.init failed, running locally', err);
    }
  }
  return new LocalPlatform();
}
