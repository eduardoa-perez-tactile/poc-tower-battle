# Local Multiplayer (Skirmish) Implementation Notes

## Systems changed
- Added data-driven game mode loading (`/data/gameModes.json`) and wired a new `Local Multiplayer` flow in the main menu.
- Updated Play flow to show a dedicated mode selection screen with `Story Mode` and `Skirmish` cards:
  - `Story Mode` routes to World Map progression.
  - `Skirmish` routes to local multiplayer bootstrap.
- Added skirmish mission bootstrap in `src/main.ts`.
- Extended match runtime in `src/game/Game.ts` with configurable match rules:
  - Human faction owner
  - Multiple AI faction owners
  - Elimination-only win/loss handling
- Generalized owner/faction support to include `red`, `green`, and `yellow` across parsing, runtime, and rendering.
- Updated HUD capture/pressure ownership logic to track incoming power by owner instead of binary player/enemy assumptions.
- Updated ownership color/tint paths for towers, links, packets, overlays, and faction tint config defaults.
- Updated skirmish level visual setup to reuse the same mission tile palette/art pipeline used by regular missions.
- Synced Level Editor preview behavior:
  - Campaign preview and Levels preview now use the same map preview behavior.
  - Skirmish map is available in the editable level list.
- Fixed unit archetype vertical facing presentation (`up/down` atlas rows) in both runtime packet rendering and Level Editor Archetypes live preview.

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
