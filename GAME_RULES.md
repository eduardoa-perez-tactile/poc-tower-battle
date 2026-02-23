# Game Rules (PoC + M7)

## Towers
- Owned towers regenerate troops over time.
- Regen formula: `troopCount += regenRatePerSec * dt`.
- Troops are clamped to `maxTroops`.

## Links
- Each tower has at most one player/AI outgoing link.
- Creating a new outgoing link replaces the previous outgoing link from the same source tower.
- Scripted wave links are separate and hidden from normal rendering.

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

## Arrival resolution
- Friendly target tower: packet count is added to `troopCount` and clamped.
- Enemy/neutral target tower:
- defenders are reduced first
- overflow damages tower hp
- if hp reaches 0, tower flips ownership
- capture sets hp to `maxHp` and troops to `captureSeedTroops`

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
- Glory rewards still apply from mission/run progression systems.

## Mission end conditions
- Win when wave progression is fully completed and player still owns at least one tower.
- Lose when player owns zero towers.
