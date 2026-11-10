import { KMH } from '../config';

export type Drivetrain = 'RWD' | 'FWD' | 'AWD';

/** Handling parameters consumed by PlayerCar (and refined by Step 3 physics). */
export interface Handling {
  massKg: number;
  /** Peak power at the wheels, watts. */
  powerW: number;
  topSpeed: number;
  drivetrain: Drivetrain;
  /** Lateral grip limit, m/s². Caps steering lock at speed. */
  grip: number;
  /** Yaw response time constant, s (lower = sharper turn-in). */
  yawLag: number;
  /** Steering wind-on speed at standstill / at top speed, in fractions of full lock per second. */
  rackSpeed: [number, number];
  /** Body roll (rad) per m/s² of lateral acceleration, and pitch per m/s² longitudinal. */
  rollGain: number;
  pitchGain: number;
  /** Suspension natural frequency (Hz) and damping ratio of the body motion. */
  suspensionHz: number;
  damping: number;
  /** Gearbox and engine speed range; a CVT holds the revs at peak power instead of shifting. */
  gears: number;
  idleRpm: number;
  redline: number;
  cvt: boolean;
}

export interface VehicleSpec {
  id: string;
  name: string;
  /** Short line under the name in the garage/HUD. */
  tagline: string;
  /** Model URLs tried in order, relative to BASE_URL; drop-in custom models go first. */
  sources: string[];
  /** Target real-world size, meters. The loader rescales any model to it. */
  length: number;
  width: number;
  height: number;
  wheelDiameter: number;
  /** Paint colour, or -1 to keep the model's own colour. */
  paint: number;
  /** Metallic flake amount 0..1 (0 = solid/gloss paint). */
  metallic: number;
  rim: number;
  /** Window tint: 0 clear .. 1 limo. */
  tint: number;
  /** Ride height offset from the model's stock stance, meters (negative = lowered). */
  stance: number;
  /** Model faces backwards after auto-detection (no readable tail lamps). */
  flip?: boolean;
  handling: Handling;
}

const custom = (id: string) => `assets/vehicles/custom/${id}.glb`;
const garage = (id: string) => `assets/vehicles/garage/${id}.glb`;
const kenney = (name: string) => `assets/vehicles/kenney/${name}.glb`;
const traffic = (id: string) => `assets/vehicles/traffic/${id}.glb`;

type HandlingInput = Pick<Handling, 'massKg' | 'drivetrain' | 'grip' | 'yawLag'> & {
  kw: number;
  topKmh: number;
  /** 0 = soft old saloon … 1 = stiff modern performance car. */
  stiffness: number;
  rack: [number, number];
};

/** Derives body motion from one stiffness figure so the garage reads as a smooth progression. */
function handling(h: HandlingInput): Handling {
  const s = h.stiffness;
  return {
    massKg: h.massKg,
    powerW: h.kw * 1000,
    topSpeed: h.topKmh * KMH,
    drivetrain: h.drivetrain,
    grip: h.grip,
    yawLag: h.yawLag,
    rackSpeed: h.rack,
    rollGain: 0.0095 - 0.007 * s,
    pitchGain: 0.0065 - 0.004 * s,
    suspensionHz: 1.1 + 0.85 * s,
    damping: 0.3 + 0.4 * s,
    gears: 5,
    idleRpm: 800,
    redline: 6800,
    cvt: false,
  };
}

/** Engines (match the sound profiles in AudioEngine). */
const ENGINES: Record<string, Pick<Handling, 'gears' | 'idleRpm' | 'redline' | 'cvt'>> = {
  zhiga: { gears: 4, idleRpm: 850, redline: 6000, cvt: false },
  prius: { gears: 1, idleRpm: 1000, redline: 5200, cvt: true },
  camry: { gears: 6, idleRpm: 700, redline: 6600, cvt: false },
  e34: { gears: 5, idleRpm: 750, redline: 6500, cvt: false },
  samurai: { gears: 5, idleRpm: 800, redline: 7200, cvt: false },
  sl300: { gears: 4, idleRpm: 750, redline: 6200, cvt: false },
  evo: { gears: 5, idleRpm: 900, redline: 7000, cvt: false },
  r34: { gears: 6, idleRpm: 850, redline: 7600, cvt: false },
  supra: { gears: 6, idleRpm: 800, redline: 7000, cvt: false },
  m4: { gears: 8, idleRpm: 800, redline: 7300, cvt: false },
};

/**
 * Player garage, ordered from the worst car to the best. The local models
 * live in public/assets/vehicles/garage (see CREDITS.md); a drop-in
 * `custom/<id>.glb` overrides one, Kenney is the last resort.
 */
export const PLAYER_CARS: VehicleSpec[] = [
  {
    id: 'zhiga',
    name: 'Жига',
    tagline: 'RWD · 64 л.с. · ржавая классика, всё впереди',
    sources: [custom('zhiga'), garage('kopeyka'), kenney('sedan')],
    length: 4.13, width: 1.62, height: 1.44, wheelDiameter: 0.58,
    paint: -1, metallic: 0, rim: 0x8a8d90, tint: 0.45, stance: 0, flip: true,
    handling: handling({ massKg: 1030, kw: 47, topKmh: 150, drivetrain: 'RWD', grip: 8.6, yawLag: 0.2, rack: [3.4, 1.8], stiffness: 0 }),
  },
  {
    id: 'prius',
    name: 'Гибрид',
    tagline: 'FWD · 122 л.с. · тихий, но шустрый в потоке',
    sources: [custom('prius'), garage('prius'), kenney('hatchback-sports')],
    length: 4.48, width: 1.75, height: 1.49, wheelDiameter: 0.63,
    paint: 0xd9dadc, metallic: 0.4, rim: 0x9a9da3, tint: 0.3, stance: 0,
    handling: handling({ massKg: 1380, kw: 90, topKmh: 180, drivetrain: 'FWD', grip: 9.4, yawLag: 0.14, rack: [4.8, 2.6], stiffness: 0.25 }),
  },
  {
    id: 'camry',
    name: 'Камри 3.5',
    tagline: 'FWD · 249 л.с. · «3.5» решает',
    sources: [custom('camry'), garage('camry'), kenney('sedan')],
    length: 4.88, width: 1.84, height: 1.45, wheelDiameter: 0.68,
    paint: 0x111214, metallic: 0.6, rim: 0x2a2b2e, tint: 0.85, stance: -0.02,
    handling: handling({ massKg: 1590, kw: 183, topKmh: 235, drivetrain: 'FWD', grip: 10, yawLag: 0.12, rack: [5, 2.8], stiffness: 0.35 }),
  },
  {
    id: 'e34',
    name: 'Пятёрка E34',
    tagline: 'RWD · 192 л.с. · занижена на стенсе',
    sources: [custom('e34'), garage('e34'), kenney('sedan-sports')],
    length: 4.72, width: 1.75, height: 1.38, wheelDiameter: 0.64,
    paint: -1, metallic: 0.3, rim: 0xc8c9cc, tint: 0.7, stance: 0,
    handling: handling({ massKg: 1500, kw: 141, topKmh: 235, drivetrain: 'RWD', grip: 10.2, yawLag: 0.13, rack: [4.4, 2.3], stiffness: 0.4 }),
  },
  {
    id: 'samurai',
    name: 'Samurai II',
    tagline: 'Chaser Tourer · RWD · 2.5 турбо R6',
    sources: [custom('samurai'), garage('chaser'), kenney('sedan-sports')],
    length: 4.76, width: 1.76, height: 1.38, wheelDiameter: 0.66,
    paint: 0xe8e6df, metallic: 0.35, rim: 0x2b2d31, tint: 0.85, stance: -0.03,
    handling: handling({ massKg: 1490, kw: 260, topKmh: 268, drivetrain: 'RWD', grip: 10.6, yawLag: 0.15, rack: [4.2, 2.2], stiffness: 0.5 }),
  },
  {
    id: 'sl300',
    name: 'Stuttgart 300SL',
    tagline: 'RWD · «Крыло чайки» · классика с рестомодом',
    sources: [custom('sl300'), garage('sl300'), kenney('sedan-sports')],
    length: 4.52, width: 1.79, height: 1.3, wheelDiameter: 0.68,
    paint: 0x9ea2a8, metallic: 0.95, rim: 0xc8c9cc, tint: 0.2, stance: -0.02,
    handling: handling({ massKg: 1300, kw: 250, topKmh: 265, drivetrain: 'RWD', grip: 11, yawLag: 0.12, rack: [4.6, 2.5], stiffness: 0.55 }),
  },
  {
    id: 'evo',
    name: 'Эво X',
    tagline: 'AWD · 295 л.с. · раллийная цепкость',
    sources: [custom('evo'), garage('evo'), kenney('sedan-sports')],
    length: 4.5, width: 1.81, height: 1.48, wheelDiameter: 0.66,
    paint: 0xb3121a, metallic: 0.5, rim: 0x1a1b1d, tint: 0.6, stance: -0.02,
    handling: handling({ massKg: 1560, kw: 220, topKmh: 250, drivetrain: 'AWD', grip: 12, yawLag: 0.07, rack: [6, 3.3], stiffness: 0.65 }),
  },
  {
    id: 'r34',
    name: 'Скайлайн R34',
    tagline: 'AWD · 330 л.с. · Godzilla',
    sources: [custom('r34'), garage('r34'), kenney('sedan-sports')],
    length: 4.6, width: 1.79, height: 1.36, wheelDiameter: 0.66,
    paint: 0x2c4a8a, metallic: 0.7, rim: 0x2b2d31, tint: 0.6, stance: -0.02,
    handling: handling({ massKg: 1560, kw: 290, topKmh: 285, drivetrain: 'AWD', grip: 12.3, yawLag: 0.08, rack: [5.6, 3.1], stiffness: 0.7 }),
  },
  {
    id: 'supra',
    name: 'Супра MK4',
    tagline: 'RWD · 2JZ на 500 сил',
    sources: [custom('supra'), garage('supra'), kenney('sedan-sports')],
    length: 4.52, width: 1.81, height: 1.27, wheelDiameter: 0.66,
    paint: 0xd98c1c, metallic: 0.4, rim: 0xc0c2c5, tint: 0.5, stance: -0.02,
    handling: handling({ massKg: 1510, kw: 370, topKmh: 300, drivetrain: 'RWD', grip: 11.6, yawLag: 0.1, rack: [5, 2.8], stiffness: 0.75 }),
  },
  {
    id: 'm4',
    name: 'Bavaria M4',
    tagline: 'AWD · 510 л.с. · моментальная переставка',
    sources: [custom('m4'), garage('m4'), kenney('sedan-sports')],
    length: 4.79, width: 1.89, height: 1.39, wheelDiameter: 0.7,
    paint: 0x1d6b4a, metallic: 0.8, rim: 0x1b1c1f, tint: 0.7, stance: -0.02,
    handling: handling({ massKg: 1725, kw: 375, topKmh: 305, drivetrain: 'AWD', grip: 12.8, yawLag: 0.06, rack: [6, 3.5], stiffness: 0.9 }),
  },
];
for (const c of PLAYER_CARS) Object.assign(c.handling, ENGINES[c.id]);

/** Traffic body types for the Step 4 pool (paint `-1` keeps the model's own livery). */
export interface TrafficSpec {
  id: string;
  sources: string[];
  length: number;
  width: number;
  height: number;
  wheelDiameter: number;
  paints: number[];
  weight: number;
  /** Model faces backwards after auto-detection. */
  flip?: boolean;
}

const CIVIL_PAINTS = [0xdedede, 0x1a1a1c, 0x8c9096, 0x5b1a1a, 0x23324a, 0xc9c3b4, 0x2f3d33, 0x7a7d80];

/** Low-poly (1–6k triangles, 512 px textures) so dozens can be on screen at once. */
export const TRAFFIC_CARS: TrafficSpec[] = [
  { id: 'sedan', sources: [traffic('sedan'), kenney('sedan')], length: 4.6, width: 1.8, height: 1.45, wheelDiameter: 0.64, paints: CIVIL_PAINTS, weight: 4 },
  { id: 'sedan2', sources: [traffic('sedan2'), kenney('sedan')], length: 4.7, width: 1.82, height: 1.45, wheelDiameter: 0.66, paints: CIVIL_PAINTS, weight: 3 },
  { id: 'hatch', sources: [traffic('hatch'), kenney('hatchback-sports')], length: 4.2, width: 1.76, height: 1.45, wheelDiameter: 0.62, paints: CIVIL_PAINTS, weight: 3 },
  { id: 'compact', sources: [traffic('compact'), kenney('hatchback-sports')], length: 3.9, width: 1.7, height: 1.5, wheelDiameter: 0.6, paints: CIVIL_PAINTS, weight: 2 },
  { id: 'wagon', sources: [traffic('wagon'), kenney('sedan')], length: 4.7, width: 1.8, height: 1.5, wheelDiameter: 0.64, paints: CIVIL_PAINTS, weight: 2 },
  { id: 'coupe', sources: [traffic('coupe'), kenney('sedan-sports')], length: 4.4, width: 1.8, height: 1.35, wheelDiameter: 0.64, paints: CIVIL_PAINTS, weight: 1 },
  { id: 'red', sources: [traffic('redcar'), kenney('sedan')], length: 4.4, width: 1.78, height: 1.45, wheelDiameter: 0.63, paints: [-1], weight: 1 },
  { id: 'blue', sources: [traffic('bluecar'), kenney('sedan')], length: 4.4, width: 1.78, height: 1.45, wheelDiameter: 0.63, paints: [-1], weight: 1 },
  { id: 'suv', sources: [traffic('suv'), kenney('suv')], length: 4.8, width: 1.92, height: 1.78, wheelDiameter: 0.76, paints: CIVIL_PAINTS, weight: 3 },
  { id: 'pickup', sources: [traffic('pickup'), kenney('truck')], length: 5.3, width: 1.9, height: 1.8, wheelDiameter: 0.66, paints: CIVIL_PAINTS, weight: 1 },
  { id: 'van', sources: [traffic('van'), kenney('van')], length: 5.3, width: 2.0, height: 2.25, wheelDiameter: 0.7, paints: [0xf2f2f2, 0xd8d8d8], weight: 2 },
  { id: 'police', sources: [traffic('police'), kenney('police')], length: 4.8, width: 1.85, height: 1.55, wheelDiameter: 0.66, paints: [-1], weight: 1 },
  // Simplified copies of the garage sedans (16–33k triangles, 512 px textures): realistic bodies in the flow.
  { id: 'hq-camry', sources: [traffic('hq-camry'), kenney('sedan')], length: 4.88, width: 1.84, height: 1.45, wheelDiameter: 0.68, paints: CIVIL_PAINTS, weight: 3 },
  { id: 'hq-prius', sources: [traffic('hq-prius'), kenney('hatchback-sports')], length: 4.48, width: 1.75, height: 1.49, wheelDiameter: 0.63, paints: CIVIL_PAINTS, weight: 3 },
  { id: 'hq-e34', sources: [traffic('hq-e34'), kenney('sedan')], length: 4.72, width: 1.75, height: 1.38, wheelDiameter: 0.64, paints: CIVIL_PAINTS, weight: 2 },
  { id: 'hq-chaser', sources: [traffic('hq-chaser'), kenney('sedan')], length: 4.76, width: 1.76, height: 1.38, wheelDiameter: 0.66, paints: CIVIL_PAINTS, weight: 2 },
];

export const findPlayerCar = (id: string | null): VehicleSpec => PLAYER_CARS.find((c) => c.id === id) ?? PLAYER_CARS[0];
