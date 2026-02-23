
# Game Rules (PoC)

## Towers
- Owned towers regenerate troops:
  - troopCount += regenRatePerSec * dt
  - clamp to maxTroops

## Links
- Each tower can have at most 1 outgoing link.
- Creating a new link from a tower replaces its existing outgoing link.
- Link owner == source tower owner at creation time.

## Sending troops
- If a tower has an outgoing link, it sends troops continuously:
  - sendAmount = min(sendRatePerSec * dt, tower.troopCount)
  - tower.troopCount -= sendAmount
  - create or add to a UnitPacket on that link for that owner

## UnitPackets (recommended representation)
- A UnitPacket represents a group count traveling along a link.
- Movement:
  - progress01 += (speedPxPerSec / linkLengthPx) * dt
  - when progress01 >= 1 -> arrives at target

## Combat on a link
- If opposing packets on the same link are within collisionDistancePx:
  - Each deals damage simultaneously each tick:
    - damage = packet.count * dpsPerUnit * dt
    - kills = damage / hpPerUnit
    - packet.count -= kills
  - If count <= 0 remove packet
- For PoC, rounding can be simple (e.g., keep floats internally, render rounded).

## Arrival resolution
- If target tower is same owner:
  - target.troopCount += packet.count (clamp to maxTroops)
  - remove packet
- If target tower is different owner:
  1) subtract from target troopCount first
  2) overflow damage reduces target hp
  3) if target hp <= 0:
     - capture:
       - owner flips to packet.owner
       - hp = maxHp
       - troopCount = captureSeedTroops
  - remove packet

## Win/Lose
- Win when enemy owns 0 towers.
- Lose when player owns 0 towers.
