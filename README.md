# Городской поток: Шашки

Browser 3D traffic-weaving game (No Hesi style) on **TypeScript + Three.js (r187) + Vite**, targeting Yandex Games.

## Run

```bash
npm install
npm run dev        # fetches CC0 assets on first run, then starts Vite
npm run build      # type-check + production build into dist/ (relative paths for Yandex Games)
```

`npm run fetch-assets` downloads every asset into `public/assets/`, so it ships inside the build (Yandex Games doesn't
allow loading from third-party domains at runtime):

- HDRIs (Poly Haven, CC0) and the Kenney Car Kit (CC0): always.
- Sketchfab models of the real prototypes and traffic cars (CC BY), in one of two ways:

  ```bash
  # a file downloaded by hand from the model's page (Download 3D Model → glTF or "Autoconverted format (glb)")
  npm run import-model -- samurai ~/Downloads/toyota_chaser_tourer_v_jzx100.zip

  # or all of them at once with an API token
  SKETCHFAB_TOKEN=<token from sketchfab.com/settings/password> npm run fetch-assets
  ```

  Either way:
  - every license is re-checked through the Sketchfab API, and anything other than CC BY / CC0 is refused;
  - meshes are simplified and textures recompressed to WebP + Meshopt (`scripts/optimize-glb.mjs`);
  - attribution is written to `public/assets/vehicles/sketchfab/credits.json` and the table in [CREDITS.md](CREDITS.md).

  The optimized `.glb` files are meant to be committed, so builds don't need the originals or the token.

If a download fails, the game falls back to the next source: Sketchfab → Kenney → procedural.

### Controls

The game opens in the lobby: the car stands in a photoreal evening courtyard (Poly Haven `neuer_zollhof`, projected
onto the ground with `GroundedSkybox`; drag to orbit). Pick a car (‹ ›), press **Играть**, choose a track.

| Key | Action |
| --- | --- |
| W / ↑, S / ↓ | throttle / brake |
| A / ←, D / → | steer (hold to change lanes; with the arcade/standard style the car straightens itself when released) |
| E / Shift, Q / Ctrl | gear up / down (manual gearbox) |
| Esc / P | pause (continue · restart · finish the run); Esc also goes back from lobby sub-screens |
| Enter / Space | lobby → track choice → start |
| 1–9, 0 | preview a car in the lobby (ten cars, worst → best) |
| C | camera: chase → far → bumper |
| N | cycle lighting (debug) |
| H | toggle HUD |

On touch screens the HUD shows ◀ ▶ steering buttons, ГАЗ / ТОРМОЗ pedals and +/− shift buttons for the manual gearbox.

URL params: `?map=sunset|rush|night`, `?car=e34`, `?play=1` (skip the lobby), `?platform=local` (skip the SDK),
`?intro=0` (skip the crane shot), `?s=600` (start 600 m down the road), `?cam=bumper|far`.

### Menu, settings, economy

- Top bar: player name (from the SDK when signed in), shop · screen title · settings, cash with a rewarded-video
  button (+5 000).
- Lobby: characteristics card (top speed, power, 0–100 measured by the real physics, weight, drive), **Тюнинг** and
  **Играть**, or **Купить** / **Тест-драйв** (after a rewarded video) for cars you don't own.
- Tuning (owned cars, free): paint (14 colours), rim colour, window tint, ride height; saved per car.
- Shop: every car with price and status. Start cash 20 000; a run pays `0.35 × score + 400 × km` (half after a
  wreck, nothing in a test drive or with ghost traffic). Prices are in `src/gameplay/economy.ts`.
- Settings (saved with the profile):
  - **Игра** — volume, camera view, camera inertia, FPS counter;
  - **Машина** — gearbox (auto / manual), driving style (arcade / standard / simulator), drive (car's own / FWD /
    RWD / AWD), ABS / ESP / TCS;
  - **Трафик** — density (×0.55 … ×1.9 of the track's own), flow speed (×0.8 / 1 / 1.2), bot lane changes, ghost bots
    (no collisions, no points);
  - **Графика** — quality (pixel-ratio cap, shadow map 0/1k/2k/4k, MSAA 0/0/4/8, bloom and lens effects), render
    resolution 40–100 %, FPS cap 30 / 60 / unlimited, draw distance 300–1100 m (road streaming + fog).

### Maps

| Map | Lighting | Traffic |
| --- | --- | --- |
| Закатное шоссе | golden hour (Poly Haven `venice_sunset`) | moderate, 6 cars/km/lane |
| Полуденный час пик | clear midday (Poly Haven `kloofendal_48d_partly_cloudy_puresky`) | dense, 9 cars/km/lane |
| Ночная магистраль | wet night (Poly Haven `shanghai_bund`) | light, 5 cars/km/lane |

### Scoring

- **Near Miss** — overtaking a car above 90 km/h with 0.2–0.8 m between the bodies (OBB distance, not centres): +250 × combo,
  combo +0.25. **Crazy Close** under 0.2 m: +600 at double the combo, combo +0.5.
- **Double Squeeze** — threading the marking between two cars side by side with < 0.9 m on each side: +1500 × combo, combo +1.
- Combo ×1.0 – ×5.0 burns out after 3.5 s without an award and resets on any contact with traffic or a barrier.
- A hard hit (closing speed > 13 m/s ≈ 47 km/h) wrecks the car and ends the run; scrapes only cost the combo.

## Garage

Ten cars, from worst to best. The models are committed in `public/assets/vehicles/garage` (≈15 MB after optimization);
sources and authors are in [CREDITS.md](CREDITS.md). This build is for private, local use.

| Key | In game | Car | Drive | Power | Triangles |
| --- | --- | --- | --- | --- | --- |
| 1 | Жига | VAZ «classic» (AI-generated model) | RWD | 64 hp | 5k |
| 2 | Гибрид | Toyota Prius | FWD | 122 hp | 19k |
| 3 | Камри 3.5 | Toyota Camry XV70 | FWD | 249 hp | 80k |
| 4 | Пятёрка E34 | BMW E34, stance | RWD | 192 hp | 113k |
| 5 | Samurai II | Toyota Chaser Tourer V JZX100 | RWD | 350 hp | 121k |
| 6 | Stuttgart 300SL | Mercedes-Benz 300SL «Gullwing», restomod | RWD | 340 hp | 90k |
| 7 | Эво X | Mitsubishi Lancer Evo X | AWD | 295 hp | 30k |
| 8 | Скайлайн R34 | Nissan Skyline GT-R R34 | AWD | 390 hp | 87k |
| 9 | Супра MK4 | Toyota Supra A80, 2JZ build | RWD | 500 hp | 77k |
| 0 | Bavaria M4 | BMW M4 G82 | AWD | 510 hp | 97k |

Grip, steering sharpness and suspension stiffness rise along the list (`handling()` in `src/assets/vehicles.ts`).
The HUD shows the model credit under the car name. A `public/assets/vehicles/custom/<id>.glb` overrides any car
(see the [README there](public/assets/vehicles/custom/README.md)).

Traffic models are low-poly, 1–6k triangles with 512 px textures, in `public/assets/vehicles/traffic`.

## Yandex Games SDK

`src/platform/YandexPlatform.ts` loads `/sdk.js` and runs `YaGames.init()`. If the script isn't there (plain
`npm run dev`), a local stand-in with the same interface takes over and saves to `localStorage`. The HUD shows which one
is active.

| SDK call | When |
| --- | --- |
| `features.LoadingAPI.ready()` | the loading screen closes |
| `features.GameplayAPI.start()` / `stop()` | driving starts; stops for the menu, pause, results, ads and hidden tabs (the simulation pauses too) |
| `getPlayer().getData()` / `setData()` | the selected car and map, volume, best score and best distance |
| `adv.showFullscreenAdv()` | between runs (restart / back to menu), at most once a minute |
| `leaderboards.setScore('distance', m)` | distance of each finished run (authorized players only) |

To test against the real SDK locally:

```bash
npm run build
npx @yandex-games/sdk-dev-proxy -p dist --dev-mode=true   # https://localhost:8080
```

## Status

**Step 1 — scene, lighting, road (done)**

- HDRI image-based lighting; the sun is detected from the brightest HDRI texel, rotated ahead-left of the driver and
  drives a 4K soft PCF shadow map that follows the camera with texel snapping. (`PCFSoftShadowMap` was removed
  in r18x, so this uses `PCFShadowMap` + `shadow.radius`.)
- Procedural PBR asphalt: aggregate albedo/normal/roughness tiles generated at startup, plus world-anchored shader
  detail: rubbered wheel paths, repair patches, skid marks, cracks, tar seals, oil drips, dusty shoulders.
  The night preset adds puddles through a clear-coat water film.
- Endless 3-lane road (3.75 m lanes) with procedural 4th-lane overtake pockets: 60–80 m tapers, 300–600 m
  pockets, «Конец полосы» signs with a 150 m plate, and merge arrows in the last 150 m.
- W-beam guardrail, New-Jersey median barrier, street lights (a pooled set of real spot lights at night),
  instanced skyline, ACES tone mapping, bloom, and speed-driven radial blur, chromatic aberration and FOV warp.
- Floating origin keeps GPU coordinates small on long runs.

**Step 2 — vehicle loading (done)**

- `VehicleLoader` (GLTF + Draco + Meshopt, tested on Kenney, the three.js Ferrari 458 and Khronos CarConcept) handles arbitrary car models:
  - finds the forward axis from the lights;
  - finds wheels by name and clusters them spatially into four rigged units (steer + spin);
  - classifies surfaces into paint / glass / head / tail / trim / plate / tyre / rim, by node and material names or,
    for palette-atlas models, per triangle (the atlas is segmented into swatches);
  - applies PBR materials: clear-coat metallic paint, tinted glass, emissive lamps;
  - rescales to real dimensions with the pivot on the ground between the axles. Analysis is cached per file, so
    instances share geometry (ready for the traffic pool).
- Free steering (pulled forward from Step 3): a speed-sensitive steering rack with lag, lock limited by grip,
  per-car yaw response, a heading cap so sideways speed stays near ~5–6 m/s, self-straightening on release, and barrier
  collisions with speed loss. Body roll and pitch run on damped springs, the wheels spin and steer, and the brake
  lights work. The chase camera lags behind lateral moves.

**Yandex Games SDK adapter (done, ahead of Step 6)** — see above.

**Step 3 — chassis physics (reworked)** — `PlayerCar` is a dynamic bicycle model with weight transfer, friction
circles and a Pacejka-style tyre curve. The old version let the nose swing far faster than the car's path (yaw rate
up to 1.4 rad/s at 150 km/h, slip capped by force), so the car darted left/right and RWD cars spun under power. Now:

- the rear axle is stiffer and grippier than the front (mild understeer), which keeps the yaw motion damped at speed;
- full steering lock shrinks with speed to what the grip can actually use, so a key press at 200 km/h is a lane
  change, not a spin (yaw rate at 150 km/h ≈ 0.3 rad/s, body slip ≤ 0.06 rad, settles in 1–2.5 s);
- gearbox with a power curve (auto or manual, CVT for the hybrid); top speeds match the spec; the engine sound
  follows the physics revs and gears;
- ABS (no locked wheels), TCS (drive force trimmed before wheelspin), ESP (yaw-rate and slip-angle control through a
  corrective yaw moment with a throttle cut); HUD lamps light up when they intervene;
- driving style: arcade (more grip, strong lane-keeping, ESP always on), standard (straightens on release, caps the
  lane-change angle), simulator (raw physics);
- two physics substeps per 120 Hz tick.

**Step 4 — traffic without walls (done)**

- `TrafficSystem`: IDM car following, per-lane flow speeds (left fastest), heavy vans keep right, signalled lane
  changes (indicator first, then a smooth 2–3 s move), cars brake behind the player.
- No impassable rows: the rearmost car of any would-be roadblock (every open lane covered within 30 m) treats the
  closing point as a moving obstacle and drops back gently; spawns and lane changes check the same rule with a 10 m
  margin, and a closing pocket doesn't count as an escape lane.
- Pocket exits: pocket cars start merging 260 m before the narrowing, match the neighbour lane's speed, and late
  mergers ask for a zipper gap (the car behind in the neighbouring lane yields); pocket cars never spawn too close to the end.
- `TrafficView`: object pool per model type (repainted on reuse), brake lights, blinking indicators, body pitch.
- Player ↔ traffic contacts: SAT on oriented boxes, mass-weighted separation and an impulse with friction.
- Soak test (240 s, 5–11 cars/km/lane, player at 60/110/200 km/h): no car overlaps, no stuck pocket cars; a
  full-width row existed within 150 m of the player for at most 1.8 s per run, each time with the rear car already braking out of it.

**Step 5 — Near Miss / Double Squeeze / combo (done)** — see Scoring. **Step 6 — touch controls (done).**

**Menu, audio, image**

- Lobby in a showroom scene (`src/graphics/Showroom.ts`), shop, tuning, settings with tabs, track choice; pause and
  results screens (with the cash earned); best score and distance saved through the SDK. Condensed UI font: Oswald
  (SIL OFL, bundled in `src/assets/fonts`).
- Procedural Web Audio, no samples: an engine synth per car (cylinder count, idle/redline, gear count, turbo, grit)
  driven by a simulated gearbox with shift cuts, load-dependent timbre, turbo whistle and blow-off, overrun
  crackles, CVT whine for the hybrid; tyre squeal, wind, road rumble, traffic pass-by whoosh, impacts and score cues.
- Exposure: bloom runs on scene-linear HDR, so its threshold is now per map (3.0 golden, 3.6 day, 1.7 night) and the
  HDRIs are clamped (sun disc 40, night 4) — the sunset no longer veils the frame, lamps and headlights glow without
  blowing out. Daytime headlights stay below the bloom threshold; brake lights and indicators cross it.

## Layout

```
src/
├── assets/     vehicle manifest, VehicleLoader, car materials
├── audio/      procedural engine / tyres / wind / impacts (Web Audio)
├── core/       game loop (fixed step), event bus, input, math, OBB (SAT)
├── gameplay/   maps, Near Miss / Double Squeeze / combo scoring, traffic contacts
├── graphics/   environment/IBL, materials, procedural textures, road shader, post FX, camera, scenery
├── road/       RoadLayout (pocket zones, lane queries), chunk builder, streamer
├── traffic/    TrafficSystem (AI, no-wall rule, pocket merges), TrafficView (object pool)
├── vehicle/    PlayerCar (handling), CarView (model, suspension, wheels, lights)
├── platform/   Yandex Games SDK adapter + local stand-in
└── ui/         loading screen, HUD (score, combo, popups, touch pedals), menu / pause / results
```
