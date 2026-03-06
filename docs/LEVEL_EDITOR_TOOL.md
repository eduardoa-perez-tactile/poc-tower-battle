# Level Editor Tool (Dev-Only)

## Overview
The Level Editor is a DEV-only tooling screen for editing campaign and wave data with:
- Project-wide JSON library browsing (campaign, presets, wave configs, maps).
- Editable inspectors for campaign missions and presets.
- Read-only **Resolved Mission** view that applies campaign overrides and runtime wave resolution.
- Validation (errors vs warnings), JSON diff, changed-file tracking, and browser-safe export.
- Local workspace autosave to prevent accidental data loss.

All tooling code is under:
- `src/tools/level_editor/model`
- `src/tools/level_editor/io`
- `src/tools/level_editor/services`
- `src/tools/level_editor/ui`

Business logic (load/resolve/validate/diff/export) is implemented outside UI.

## Enablement
The entry point is available by default in DEV builds:
1. `import.meta.env.DEV` is true.

Open from:
- Main Menu -> `Level Editor`

The legacy Level Generator entry has been removed.

## Data Sources
The editor loads and tracks these assets:
- `/data/campaign/campaign_v2.json`
- `/data/waves/presets.json`
- `/data/wave-balance.json`
- `/data/balanceBaselines.json`
- `/data/difficultyTiers.json`
- `/data/difficulty/stages.json`
- `/data/difficulty/ascensions.json`
- `/data/wave-modifiers.json`
- `/data/enemyArchetypes.json`
- `/data/unitArchetypes.json`
- `/data/towerArchetypes.json` (Tower Dictionary)
- `/data/waves-handcrafted.json`
- `/data/wavePacingTargets.json`
- `/data/missions.json`
- `/data/gameModes.json`
- `/levels/v2/map_tXX.json` campaign maps
- `/levels/skirmish/skirmish_4p.json` skirmish map

## Resolved Mission Model
Resolved mission view is produced via runtime-equivalent merge behavior:
- Campaign mission data + preset defaults + mission overrides
- Difficulty tier and run scalar
- Difficulty context build (`buildDifficultyContext`)
- Wave planning snapshot (`WaveDirector.getDifficultyDebugSnapshot`)

This view is read-only and deterministic for the same inputs.

## Validation
Validation includes:
- Per-file parse/load issues.
- Campaign schema consistency via `validateCampaignSpec`.
- Cross-file references (presets, modifiers, archetypes, handcrafted entries).
- Boss/miniboss ID integrity.
- Spawn weight and difficulty tier weight sanity.
- Campaign distribution warnings (non-fatal).

Issues are split into `error` and `warning` severities.

## Export Workflow
Because browser runtime cannot write into repo paths:
1. Edit in workspace (autosaved to localStorage key `tower-battle.level-editor.workspace.v1`).
2. Run Validate + Diff.
3. Click `Export Changed` to download changed JSON files.
4. Apply exported files back into repo manually.

## Tower Dictionary Runtime Sync
- Tower Dictionary edits are persisted in the editor workspace snapshot (`localStorage`) until exported.
- Mission start now resolves tower archetype art/modifier data from that snapshot first, then falls back to disk data.
- Result: in DEV flow, sprite/art changes made in Tower Dictionary are reflected in gameplay on next mission start without app reload.

## Revert and Duplicate
- `Revert` restores the selected owner document to its original loaded content.
- `Duplicate` supports:
  - Campaign mission duplication (cloned level entry in campaign file).

## Map Preview Editing
Map preview behavior is shared across `Levels` and `Campaign` editing contexts for consistency.
For mission/level selections, the preview map is editable:
- Drag node: move node position (snaps to integer grid coordinates).
- Drag background: pan camera.
- Mouse wheel: zoom camera.
- `Reset View`: reset pan/zoom to fitted framing.
- Grid overlay: visible cell grid to support precise node placement.

## Unit Archetypes Live Preview
- Unit archetype preview uses the same atlas/direction rendering conventions as runtime packet rendering.
- Vertical facings are remapped for atlas draw rows (`up`/`down`) so editor preview matches in-game movement visuals.
