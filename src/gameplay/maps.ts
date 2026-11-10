import type { LightingPreset } from '../core/EventBus';

/** A playable "map": time of day, lighting and traffic character on the endless highway. */
export interface MapDef {
  id: string;
  name: string;
  subtitle: string;
  preset: LightingPreset;
  /** Traffic cars per km per main lane (TrafficSystem density). */
  density: number;
  /** Card background (CSS) for the menu. */
  art: string;
}

export const MAPS: MapDef[] = [
  {
    id: 'sunset',
    name: 'Закатное шоссе',
    subtitle: 'Золотой час · умеренный поток',
    preset: 'golden',
    density: 6,
    art: 'linear-gradient(180deg, #f7a35c 0%, #d0563b 45%, #3a1f24 100%)',
  },
  {
    id: 'rush',
    name: 'Полуденный час пик',
    subtitle: 'Ясный день · плотный трафик',
    preset: 'day',
    density: 9,
    art: 'linear-gradient(180deg, #8fc3f0 0%, #cfe3f2 45%, #59636b 100%)',
  },
  {
    id: 'night',
    name: 'Ночная магистраль',
    subtitle: 'Мокрый асфальт · огни города',
    preset: 'night',
    density: 5,
    art: 'linear-gradient(180deg, #0b1230 0%, #23264f 45%, #ff8a3d 100%)',
  },
];

export const findMap = (id: string | null | undefined): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];
