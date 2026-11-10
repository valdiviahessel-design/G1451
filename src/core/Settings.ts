import type { Drivetrain } from '../assets/vehicles';

export type Gearbox = 'auto' | 'manual';
/** Arcade: extra grip and a strong lane-keeping helper; sim: raw physics. */
export type DrivingStyle = 'arcade' | 'standard' | 'sim';
export type DriveOverride = 'stock' | Drivetrain;
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type TrafficDensity = 'low' | 'normal' | 'high' | 'extreme';
export type TrafficPace = 'slow' | 'normal' | 'fast';
export type CameraView = 'chase' | 'far' | 'bumper';

/** Everything the player can change in the settings screen; persisted with the save. */
export interface Settings {
  // Game
  volume: number;
  camera: CameraView;
  /** Camera inertia 0..1 (0 = rigid, 1 = loose and cinematic). */
  cameraInertia: number;
  showFps: boolean;
  // Car
  gearbox: Gearbox;
  style: DrivingStyle;
  drive: DriveOverride;
  abs: boolean;
  esp: boolean;
  tcs: boolean;
  // Traffic
  trafficDensity: TrafficDensity;
  trafficPace: TrafficPace;
  trafficLaneChanges: boolean;
  /** Traffic ghosts through the player (no crashes), for relaxed driving. */
  ghostTraffic: boolean;
  // Graphics
  quality: Quality;
  /** Render scale, 0.4..1. */
  resolution: number;
  /** 0 = unlimited (vsync). */
  fpsLimit: number;
  /** Visible road distance, m. */
  drawDistance: number;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  camera: 'chase',
  cameraInertia: 0.5,
  showFps: false,
  gearbox: 'auto',
  style: 'standard',
  drive: 'stock',
  abs: true,
  esp: true,
  tcs: true,
  trafficDensity: 'normal',
  trafficPace: 'normal',
  trafficLaneChanges: true,
  ghostTraffic: false,
  quality: 'high',
  resolution: 1,
  fpsLimit: 0,
  drawDistance: 1100,
};

/** Fills gaps and drops invalid values from an older or tampered save. */
export function sanitizeSettings(raw: Partial<Settings> | undefined, mobile: boolean): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(mobile ? { quality: 'medium' as Quality, resolution: 0.8 } : {}) };
  if (!raw || typeof raw !== 'object') return s;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = raw[key];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[key]) (s as unknown as Record<string, unknown>)[key] = v;
  }
  s.volume = Math.min(1, Math.max(0, s.volume));
  s.resolution = Math.min(1, Math.max(0.4, s.resolution));
  s.drawDistance = Math.min(1100, Math.max(300, s.drawDistance));
  s.cameraInertia = Math.min(1, Math.max(0, s.cameraInertia));
  return s;
}

/** Traffic cars per km per lane, relative to the map's own density. */
export const DENSITY_SCALE: Record<TrafficDensity, number> = { low: 0.55, normal: 1, high: 1.45, extreme: 1.9 };
/** Traffic cruise-speed multiplier. */
export const PACE_SCALE: Record<TrafficPace, number> = { slow: 0.8, normal: 1, fast: 1.2 };
