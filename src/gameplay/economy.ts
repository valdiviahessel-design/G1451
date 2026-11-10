/** Garage prices, starting cash and run payouts. */
export const START_MONEY = 20_000;
/** Cash for watching a rewarded video in the lobby. */
export const AD_REWARD = 5_000;

export const CAR_PRICES: Record<string, number> = {
  zhiga: 0,
  prius: 15_000,
  camry: 35_000,
  e34: 50_000,
  samurai: 80_000,
  sl300: 110_000,
  evo: 140_000,
  r34: 180_000,
  supra: 230_000,
  m4: 300_000,
};

export const priceOf = (id: string): number => CAR_PRICES[id] ?? 0;

/** Cash earned for a run: points plus distance, halved after a wreck. */
export function runPayout(score: number, km: number, crashed: boolean): number {
  const base = score * 0.35 + km * 400;
  return Math.round((crashed ? base * 0.5 : base) / 10) * 10;
}

/** Per-car visual tuning, saved with the profile. Missing fields mean factory spec. */
export interface CarTuning {
  paint?: number;
  rim?: number;
  /** Window tint 0..1. */
  tint?: number;
  /** Suspension drop, m (0 = stock, negative = lower). */
  drop?: number;
}

export const PAINTS: { name: string; color: number }[] = [
  { name: 'Белый', color: 0xf1f1ef },
  { name: 'Серебро', color: 0xb9bcc1 },
  { name: 'Графит', color: 0x4a4d52 },
  { name: 'Чёрный', color: 0x0d0e10 },
  { name: 'Красный', color: 0xb3121a },
  { name: 'Вишня', color: 0x5b0f17 },
  { name: 'Оранжевый', color: 0xe8611a },
  { name: 'Жёлтый', color: 0xf2c014 },
  { name: 'Лайм', color: 0x7cc12a },
  { name: 'Зелёный', color: 0x1d4d33 },
  { name: 'Бирюза', color: 0x1f8a8a },
  { name: 'Голубой', color: 0x6fa8d6 },
  { name: 'Синий', color: 0x16357a },
  { name: 'Фиолетовый', color: 0x4b2a7a },
];

export const RIMS: { name: string; color: number }[] = [
  { name: 'Серебро', color: 0xc8c9cc },
  { name: 'Хром', color: 0xf0f2f5 },
  { name: 'Чёрный', color: 0x18191b },
  { name: 'Графит', color: 0x3c3e42 },
  { name: 'Золото', color: 0xc9a24a },
  { name: 'Бронза', color: 0x8a5a2e },
  { name: 'Белый', color: 0xe9e9e6 },
  { name: 'Красный', color: 0xa3141b },
];

export const TINTS: { name: string; value: number }[] = [
  { name: 'Без тонировки', value: 0.05 },
  { name: '35 %', value: 0.35 },
  { name: '70 %', value: 0.7 },
  { name: 'Лимузин', value: 0.97 },
];

export const DROPS: { name: string; value: number }[] = [
  { name: 'Сток', value: 0 },
  { name: '−2 см', value: -0.02 },
  { name: '−4 см', value: -0.04 },
  { name: '−6 см', value: -0.06 },
];
