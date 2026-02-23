# Tower Battle: Connect Towers — Web 2D PoC Spec

## Goal
Build a playable 2D browser PoC inspired by “Tower Battle: Connect Towers”.

## Tech Stack
- TypeScript (strict)
- Vite
- HTML5 Canvas 2D (single canvas)
- Minimal DOM overlay (no React for PoC)

## Core Gameplay (PoC)
- Top-down map with Towers (nodes).
- Player draws a connection from an owned tower to another tower (neutral/enemy).
- Towers generate troops over time.
- Connected towers send troops as moving packets along the line.
- Packets fight opposing packets on the same line.
- Packets reaching enemy towers reduce defenders / HP; towers can be captured.
- Simple enemy AI periodically creates a connection and attacks.
- Win: enemy has 0 towers. Lose: player has 0 towers.
- One level is enough.

## Controls
- Mouse drag from owned tower to target tower to create/replace outgoing link.
- ESC or right-click cancels a drag.
- Restart button.

## Entities (minimum)
- Tower: id, x, y, owner(player/enemy/neutral), hp, maxHp, troopCount, regenRatePerSec, maxTroops
- Link: id, fromTowerId, toTowerId, owner, points[] (for PoC can be straight line)
- UnitPacket: id, owner, count, speedPxPerSec, dpsPerUnit, hpPerUnit, linkId, progress01

## Rules (minimum)
- Each tower: max 1 outgoing link (new replaces old).
- Sending: if link exists, source sends troops at sendRatePerSec, reducing tower troopCount.
- Movement: progress increases by (speed / linkLength) * dt.
- Link combat: opposing packets on the same link within collisionDistance trade damage each tick.
- Arrival:
  - Friendly tower: add count to troopCount (clamp).
  - Enemy/neutral: reduce troopCount then hp; capture when hp<=0 -> flip owner, reset hp, set troopCount=captureSeed.
- Tower regen: +regenRatePerSec * dt up to maxTroops.

## AI (simple)
Every aiThinkInterval seconds:
- pick an enemy tower with troopCount >= aiMinTroopsToAttack
- target nearest player tower
- create/replace outgoing link and let normal sending rules apply

## Non-goals
No meta progression, no multiple levels UI, no portals, no sound, no fancy VFX.

## Deliverable
`npm install && npm run dev` runs the playable PoC in browser.

