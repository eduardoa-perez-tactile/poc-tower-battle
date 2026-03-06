# Local Multiplayer (Skirmish) Implementation Notes

## Systems changed
- Added data-driven game mode loading (`/data/gameModes.json`) and wired a new `Local Multiplayer` flow in the main menu.
- Added a dedicated skirmish setup screen and skirmish mission bootstrap in `src/main.ts`.
- Extended match runtime in `src/game/Game.ts` with configurable match rules:
  - Human faction owner
  - Multiple AI faction owners
  - Elimination-only win/loss handling
- Generalized owner/faction support to include `red`, `green`, and `yellow` across parsing, runtime, and rendering.
- Updated HUD capture/pressure ownership logic to track incoming power by owner instead of binary player/enemy assumptions.
- Updated ownership color/tint paths for towers, links, packets, overlays, and faction tint config defaults.

## Data/files added
- `public/data/gameModes.json`
- `data/gameModes.json`
- `levels/skirmish/skirmish_4p.json`
- `public/levels/skirmish/skirmish_4p.json`
- `src/modes/GameModes.ts`
- `src/sim/Factions.ts`

## Key assumptions
- Human faction for skirmish uses owner id `player` (rendered as blue).
- AI skirmish factions use owner ids `red`, `green`, and `yellow`.
- Existing campaign/run wave systems remain unchanged; skirmish runs without wave scripting and uses elimination rules only.
- Legacy `enemy` owner remains supported for existing campaign/run content.
