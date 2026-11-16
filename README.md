# Foxy Frontiers

A top-down 3D territory-capture game built with Three.js. Steer a fabulous little animal across an
enchanted floating meadow, loop out of your land to claim more, and cut rival trails to eliminate them.

## Play

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Rules

- **Move**: your animal never stops. Steer with the mouse, WASD / arrow keys, or drag on touch screens.
- **Claim**: leaving your territory draws a glowing trail. Return to your land to fill the enclosed loop.
- **Cut**: crossing a rival's exposed trail eliminates them. Crossing your own trail is harmless.
- **Safe zone**: inside your own territory you cannot be cut, and head-on bumps knock out the intruder.
- **Speed**: the more land you hold, the faster you run. Each kill gives a short ⚡ speed rush plus a
  small lasting boost (until you die), and claiming a big area in one loop also triggers a rush. Running along the arena's edge is faster too, and keeps speeding up the longer you stay on it.
- **Win**: hold 25% of the arena, or have the most land when the 2:30 timer ends.
- **Lose**: get eliminated, or end the round behind another animal.

Esc / P pauses, M mutes.

## Development

```bash
npm test         # deterministic mechanics tests (capture, cuts, self-collision, win/lose)
npm run sim      # headless bot-vs-bot balance simulation
```

- `src/game/` — pure simulation (grid territory, flood-fill capture, collisions, bot AI). No rendering.
- `src/render/` — Three.js layers: territory shader, trail ribbons, procedural animals, particles, environment.
- `src/main.js` — renderer, post-processing, camera, input, HUD and game-state flow.
