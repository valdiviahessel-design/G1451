# Custom vehicle models

Put a `.glb` here named after a car id to replace its stock body:

| File | Car |
| --- | --- |
| `samurai.glb` | Samurai II |
| `vesta.glb` | Vesta RS |
| `priora.glb` | Priora Drive |
| `bavaria.glb` | Bavaria M-Sedan |
| `stuttgart.glb` | Stuttgart E-AMG |

`VehicleLoader` handles any reasonable model automatically:

- **Orientation:** the forward axis is detected from the head and tail lights.
- **Size:** the model is rescaled to the dimensions in `src/assets/vehicles.ts`.
- **Wheels:** found by node names (`wheel`, `tire`, `rim`, …), clustered into four, and rigged for spin and steering.
- **Materials:** replaced by name (`body`/`paint`, `glass`/`window`, `light`/`head`/`tail`, `chrome`, …). Palette-atlas models are classified per triangle by texel colour.
- **Compression:** Draco and Meshopt are supported.

Only use models you are licensed to ship on Yandex Games. Avoid real brand logos and badges.
