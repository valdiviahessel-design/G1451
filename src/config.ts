/** World-scale constants shared by every module (meters, seconds). */
export const LANE_WIDTH = 3.75;
export const BASE_LANES = 3;
export const BASE_HALF_WIDTH = (LANE_WIDTH * BASE_LANES) / 2;

/** Paved shoulder beyond the outer edge line. */
export const SHOULDER_WIDTH = 1.6;
export const MEDIAN_SHOULDER_WIDTH = 0.9;

/** Overtake pocket ("4th lane") generation ranges. */
export const POCKET = {
  taperMin: 60,
  taperMax: 80,
  lengthMin: 300,
  lengthMax: 600,
  gapMin: 260,
  gapMax: 720,
  warningDistance: 150,
} as const;

/**
 * Road chunks must tile the 375 m texture period and the 1000 m shader noise
 * period exactly, otherwise UV/noise seams appear at chunk borders.
 */
export const CHUNK_LENGTH = 125;
export const CHUNK_STEP = 2.5;
export const UV_PERIOD = 375;
export const NOISE_PERIOD = 1000;

export const VIEW_AHEAD = 1100;
export const VIEW_BEHIND = 140;

export const KMH = 1 / 3.6;
