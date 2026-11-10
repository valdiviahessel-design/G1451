import type { LightingPreset } from '../core/EventBus';

/** Roadside world built around the highway: props, scenery, ground and road furniture. */
export type ThemeId = 'city' | 'japan' | 'tokyo';
export type Weather = 'clear' | 'rain' | 'petals';

/** A playable "map": scenery theme, time of day, weather and traffic character on the endless highway. */
export interface MapDef {
  id: string;
  name: string;
  subtitle: string;
  /** Short place label for the card, e.g. "Россия" or "Япония". */
  region: string;
  /** Optional chip on the card ("Новая"). */
  badge?: string;
  theme: ThemeId;
  preset: LightingPreset;
  weather: Weather;
  /** Traffic cars per km per main lane (TrafficSystem density). */
  density: number;
  /** Card background (CSS), used when there is no image. */
  art: string;
  /** Card picture URL (a render of the map). */
  image?: string;
}

// Renders of each map (captured in game), bundled by Vite when present.
const shots = import.meta.glob<string>('../assets/maps/*.webp', { eager: true, query: '?url', import: 'default' });
const shot = (id: string): string | undefined => shots[`../assets/maps/${id}.webp`];

export const MAPS: MapDef[] = [
  {
    id: 'sunset',
    name: 'Закатное шоссе',
    subtitle: 'Золотой час · умеренный поток',
    region: 'Город',
    theme: 'city',
    preset: 'golden',
    weather: 'clear',
    density: 6,
    art: 'linear-gradient(180deg, #f7a35c 0%, #d0563b 45%, #3a1f24 100%)',
  },
  {
    id: 'rush',
    name: 'Полуденный час пик',
    subtitle: 'Ясный день · плотный трафик',
    region: 'Город',
    theme: 'city',
    preset: 'day',
    weather: 'clear',
    density: 9,
    art: 'linear-gradient(180deg, #8fc3f0 0%, #cfe3f2 45%, #59636b 100%)',
  },
  {
    id: 'night',
    name: 'Ночная магистраль',
    subtitle: 'Дождь · мокрый асфальт · огни города',
    region: 'Город',
    theme: 'city',
    preset: 'night',
    weather: 'rain',
    density: 5,
    art: 'linear-gradient(180deg, #0b1230 0%, #23264f 45%, #ff8a3d 100%)',
  },
  {
    id: 'sakura',
    name: 'Сакура-лайн',
    subtitle: 'Цветущая сакура · вид на Фудзи',
    region: 'Япония',
    badge: 'Новая',
    theme: 'japan',
    preset: 'sakura',
    weather: 'petals',
    density: 6,
    art: 'linear-gradient(180deg, #ffc4d6 0%, #f58fb0 40%, #5b3a66 100%)',
  },
  {
    id: 'tokyo',
    name: 'Ночной Токио',
    subtitle: 'Неон · хайвей Шуто · быстрый поток',
    region: 'Япония',
    badge: 'Новая',
    theme: 'tokyo',
    preset: 'neon',
    weather: 'clear',
    density: 7,
    art: 'linear-gradient(180deg, #12062e 0%, #5a1a8a 45%, #ff3fa4 100%)',
  },
].map((m): MapDef => ({ ...m, image: shot(m.id) }) as MapDef);

export const findMap = (id: string | null | undefined): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0];
