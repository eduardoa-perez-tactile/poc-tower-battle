# Game Rules (PoC + Territory Control)

## Towers
- Owned towers regenerate troops over time.
- Regen formula: `troopCount += effectiveRegen * ownerRegenMultiplier * (1 + auraBonus) * dt`.
- `effectiveRegen` is derived from tower `baseRegen` plus active cluster bonus.
- Troops are clamped to `maxTroops`.

## Links
- Player/AI links are restricted to direct neighbors in the map graph (1 hop).
- Each tower has `maxOutgoingLinks` capacity (base + tower modifiers).
- A new link is rejected when capacity is full or when the same link already exists.
- Scripted wave links are separate and hidden from normal rendering.

## Territory control clusters
- A cluster is a connected component of owned towers using active links only.
- Connectivity is computed on owned towers only; enemy/neutral towers are excluded from graph traversal.
- Bonuses apply only while threshold is met and update immediately on topology/ownership change.
- Cluster thresholds:
- Size `3+`: `+10%` tower regen
- Size `5+`: `+15%` packet armor
- Size `8+`: `+20%` tower vision radius
- Recompute triggers:
- Tower ownership change (capture)
- Link created
- Link destroyed

## Sending troops
- If a tower has an outgoing link, it continuously sends troops.
- Send amount per tick: `min(sendRatePerSec * dt, tower.troopCount)`.
- Sent troops become or merge into a `UnitPacket` on that link.

## Unit packets
- Packets carry group combat data and move along link polylines.
- Progress formula: `progress01 += (speedPxPerSec / linkLengthPx) * dt`.
- On `progress01 >= 1`, arrival resolution triggers.

## Packet combat
- Opposing packets fight when within effective range.
- Effective range uses max of collision distance and packet attack ranges.
- Attack cadence uses cooldown fields on packets.
- Shield packets gain periodic temporary armor during shield uptime windows.
- Support packets apply local aura buffs to allied speed/armor.
- Ranged packets can stop and fire before reaching tower center.
- Damage resolution uses armor directly:
- `damageTaken = incomingDamage * (1 - effectiveArmor)`
- `kills = damageTaken / hpPerUnit`
- Armor sources stack multiplicatively (territory + temporary effects).

## Territory visual feedback
- Player towers in cluster `3+` render a faint green glow ring.
- Player towers in cluster `5+` render a shield marker above the tower.
- Player towers in cluster `8+` render an expanded vision circle.

## Mission HUD additions
- Mission HUD includes a tower selection block.
- Selected tower displays:
- `Cluster Size`
- Active bonuses (`Regen`, `Armor`, `Vision`)
- Capture overlay uses two phases to communicate takeover progress:
- `Contested`: incoming hostile pressure is reducing defenders.
- `Breaching`: defenders are depleted and hostile pressure is now burning tower HP.
- Tower ownership color does not change until ownership actually flips.
- Capture overlay uses separate progress tracks:
- Outer pressure ring = defender pressure.
- Inner breach ring = tower HP breach progress after defenders are broken.

## Arrival resolution
- Friendly target tower: packet count is added to `troopCount` and clamped.
- Enemy/neutral target tower:
- defenders are reduced first
- overflow damages tower hp
- if hp reaches 0, tower flips ownership
- capture sets hp to `maxHp` and troops to `captureSeedTroops`
- World tooltip shows contextual control state (`Stable`, `Contested`, `Breaching`) and a capture rule hint:
- `Control transfers only when HP reaches 0.`
- Mission event feed emits capture milestones:
- `Defenders broken at <tower>` when phase enters breaching.
- `<tower> captured` / `<tower> lost` when ownership changes.

## Enemy wave system
- Missions run wave progression with deterministic generation from run seed.
- Wave definitions support both handcrafted waves and procedural waves.
- Procedural generation inputs: difficulty tier, wave index, seed, lane count.
- Wave output includes scheduled spawn entries with offsets, enemy id, count, elite chance, and lane.

## Enemy archetypes
- Swarm: low hp, very fast, low per-unit threat, high volume.
- Tank: high hp, slow, high frontline pressure.
- Ranged: long-range packet behavior that halts to attack.
- Shield: timed defensive window with stronger mitigation.
- Splitter: on defeat in transit, spawns smaller child packets.
- Support: buffs nearby enemies with aura multipliers.

## Wave modifiers
- Double Speed: increases enemy movement and tempo.
- Armored: increases defense and favors tank/shield composition.
- Ranged Heavy: increases ranged/support composition pressure.
- Elite Wave: significantly increases elite spawn chance.
- Swarm Rush: increases spawn rate and swarm weighting.
- Mini-boss Escort: injects escort package and composition weighting.

## Elites
- Elite packets receive hp/damage/size multipliers and tint.
- Elite defeat grants extra gold and can apply temporary player buff.
- Elite rewards are data-driven per archetype with config fallback.

## Mini-boss and boss
- Miniboss escort behavior starts from configured early waves.
- Final wave includes a boss packet with phased behavior.
- Boss abilities:
- Slam AoE with windup telegraph and tower damage
- Summon adds with windup telegraph
- Enrage below threshold hp with speed/damage increase

## Rewards
- Gold is awarded on enemy defeats by base value plus tag bonuses.
- Elite kills grant extra gold bonus.
- Wave clear grants additional gold.
- Gold rewards still apply from mission/run progression systems.

## Mission end conditions
- Win when wave progression is fully completed and player still owns at least one tower.
- Lose when player owns zero towers.
