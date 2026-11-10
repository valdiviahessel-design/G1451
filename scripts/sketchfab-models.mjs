/**
 * Sketchfab vehicles fetched by `npm run fetch-assets` (needs SKETCHFAB_TOKEN).
 * Only CC BY / CC0 models: the script re-checks each license via the API and
 * refuses anything else, because Yandex Games is a commercial platform.
 *
 * `id` matches the car/traffic ids in src/assets/vehicles.ts. `maxTris` and
 * `texSize` bound what ships to the browser.
 */
export const SKETCHFAB_MODELS = [
  // Player garage (shown in-game under fictional names).
  { id: 'samurai', uid: 'd52227ff4f034942a86dfcefe44deeac', maxTris: 140_000, texSize: 2048 },
  { id: 'vesta', uid: '3c333139feb744ae9d36767c0e9cabfd', maxTris: 140_000, texSize: 2048 },
  { id: 'priora', uid: '1551b8223bdf4d78ab3e8e568530836d', maxTris: 120_000, texSize: 2048 },
  { id: 'bavaria', uid: '5478e978bd634337adc8e3dc413fbfa3', maxTris: 140_000, texSize: 2048 },
  { id: 'stuttgart', uid: 'f61d8efb0b9b4c499fc66fcf35a4d09c', maxTris: 140_000, texSize: 2048 },
  // Traffic (many instances on screen, so lighter budgets).
  { id: 'traffic-camry', uid: '560c174d073f4a10bb153ded41ada8c9', maxTris: 30_000, texSize: 1024 },
  { id: 'traffic-zhiguli', uid: '31201f80892b404a8e49c272490a664c', maxTris: 35_000, texSize: 1024 },
  { id: 'traffic-logan', uid: 'e4f9463f6e004b90bb977d12f6375b9c', maxTris: 30_000, texSize: 1024 },
  { id: 'traffic-octavia', uid: 'd567807ce57e415ba9a1ffdf07e0cf5b', maxTris: 30_000, texSize: 1024 },
  { id: 'traffic-cruiser', uid: '8c6e399714754b31b2bc5208c926204a', maxTris: 35_000, texSize: 1024 },
  { id: 'traffic-taxi', uid: '0b5310fbf2c14b3e807c63f2ee1ca7bf', maxTris: 30_000, texSize: 1024 },
  { id: 'traffic-kamaz', uid: 'e86a62f4b8c84e03b2c6e32c51474bc7', maxTris: 35_000, texSize: 1024 },
];

export const ALLOWED_LICENSES = new Set(['by', 'cc0']);
