import { Rng } from '../core/math';

export type MissionKind = 'near' | 'squeeze' | 'km' | 'score' | 'combo' | 'speed' | 'clean' | 'nitro';

/** Saved with the profile. */
export interface MissionState {
  kind: MissionKind;
  goal: number;
  progress: number;
  reward: number;
}

/** What the menu shows. */
export interface MissionView {
  id: string;
  title: string;
  progress: number;
  goal: number;
  reward: number;
  done: boolean;
}

export interface MissionReward {
  title: string;
  reward: number;
}

interface Template {
  /** Cumulative across runs; otherwise the best single-run value counts. */
  cumulative: boolean;
  goals: number[];
  /** Cash per goal tier. */
  rewards: number[];
  title: (goal: number) => string;
}

const TEMPLATES: Record<MissionKind, Template> = {
  near: { cumulative: true, goals: [15, 30, 60], rewards: [1500, 3000, 6000], title: (g) => `Совершите ${g} опасных обгонов` },
  squeeze: { cumulative: true, goals: [2, 4, 8], rewards: [2000, 4000, 8000], title: (g) => `Проскочите между машинами ${g} раз` },
  km: { cumulative: true, goals: [5, 12, 25], rewards: [1500, 3500, 7000], title: (g) => `Проедьте ${g} км` },
  score: { cumulative: false, goals: [5000, 15000, 40000], rewards: [2000, 4500, 9000], title: (g) => `Наберите ${g.toLocaleString('ru-RU')} очков за заезд` },
  combo: { cumulative: false, goals: [2, 3.5, 5], rewards: [1500, 3500, 7000], title: (g) => `Разгоните комбо до ×${g}` },
  speed: { cumulative: false, goals: [150, 200, 260], rewards: [1000, 3000, 6000], title: (g) => `Разгонитесь до ${g} км/ч` },
  clean: { cumulative: false, goals: [2, 4, 8], rewards: [2000, 4000, 8000], title: (g) => `Проедьте ${g} км без касаний за заезд` },
  nitro: { cumulative: true, goals: [20, 45, 90], rewards: [1500, 3000, 6000], title: (g) => `Продержите нитро ${g} с` },
};

const KINDS = Object.keys(TEMPLATES) as MissionKind[];
const SLOTS = 3;

/** Per-frame facts of the current run; cumulative fields are deltas since the last call. */
export interface MissionTick {
  near?: number;
  squeeze?: number;
  km?: number;
  nitro?: number;
  score?: number;
  combo?: number;
  speedKmh?: number;
  cleanKm?: number;
}

/**
 * Three rotating objectives. Progress is tracked during a run, rewards are paid
 * when the run ends, and a finished mission is replaced by a new one.
 */
export class Missions {
  private list: MissionState[];
  private rng = new Rng((Date.now() & 0xffff) + 7);

  constructor(saved?: MissionState[]) {
    this.list = (saved ?? []).filter((m) => m && TEMPLATES[m.kind] && m.goal > 0).slice(0, SLOTS);
    while (this.list.length < SLOTS) this.list.push(this.roll());
  }

  private roll(): MissionState {
    const taken = new Set(this.list.map((m) => m.kind));
    const free = KINDS.filter((k) => !taken.has(k));
    const kind = free[Math.floor(this.rng.next() * free.length)] ?? 'km';
    const t = TEMPLATES[kind];
    const tier = Math.floor(this.rng.next() * t.goals.length);
    return { kind, goal: t.goals[tier], progress: 0, reward: t.rewards[tier] };
  }

  get state(): MissionState[] {
    return this.list;
  }

  views(): MissionView[] {
    return this.list.map((m, i) => ({
      id: `${i}-${m.kind}`,
      title: TEMPLATES[m.kind].title(m.goal),
      progress: Math.min(m.goal, m.progress),
      goal: m.goal,
      reward: m.reward,
      done: m.progress >= m.goal,
    }));
  }

  track(t: MissionTick): void {
    for (const m of this.list) {
      const v = t[m.kind === 'speed' ? 'speedKmh' : m.kind === 'clean' ? 'cleanKm' : m.kind];
      if (v === undefined) continue;
      if (TEMPLATES[m.kind].cumulative) m.progress += v;
      else m.progress = Math.max(m.progress, v);
    }
  }

  /** Pays out finished missions and replaces them; unfinished single-run goals start over. */
  endRun(): MissionReward[] {
    const paid: MissionReward[] = [];
    this.list = this.list.map((m) => {
      if (m.progress >= m.goal) {
        paid.push({ title: TEMPLATES[m.kind].title(m.goal), reward: m.reward });
        return null;
      }
      if (!TEMPLATES[m.kind].cumulative) m.progress = 0;
      return m;
    }).filter((m): m is MissionState => m !== null);
    while (this.list.length < SLOTS) this.list.push(this.roll());
    return paid;
  }
}
