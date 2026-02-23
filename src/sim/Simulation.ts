import type { Owner, UnitPacket, Vec2, World } from "./World";

export interface UnitRuleSet {
  speedPxPerSec: number;
  dpsPerUnit: number;
  hpPerUnit: number;
}

export interface SimulationRules {
  sendRatePerSec: number;
  collisionDistancePx: number;
  captureSeedTroops: number;
  defaultUnit: UnitRuleSet;
}

const PACKET_MERGE_PROGRESS_THRESHOLD = 0.15;
let packetSequence = 0;

export function updateWorld(world: World, dtSec: number, rules: SimulationRules): void {
  regenTowers(world, dtSec);
  sendTroops(world, dtSec, rules);
  preparePacketRuntime(world, dtSec);
  applySupportAuras(world);
  resolvePacketCombat(world, dtSec, rules);
  movePackets(world, dtSec, rules);
  removeDestroyedPackets(world);
}

function regenTowers(world: World, dtSec: number): void {
  for (const tower of world.towers) {
    if (tower.owner === "neutral") {
      continue;
    }

    tower.troopCount = Math.min(tower.maxTroops, tower.troopCount + tower.regenRatePerSec * dtSec);
  }
}

function sendTroops(world: World, dtSec: number, rules: SimulationRules): void {
  const desiredSend = rules.sendRatePerSec * dtSec;
  if (desiredSend <= 0) {
    return;
  }

  for (const tower of world.towers) {
    const outgoingLink = world.getOutgoingLink(tower.id);
    if (!outgoingLink) {
      continue;
    }

    const sendAmount = Math.min(desiredSend, tower.troopCount);
    if (sendAmount <= 0) {
      continue;
    }

    tower.troopCount -= sendAmount;

    const mergeTarget = findMergeTarget(world.packets, outgoingLink.id, tower.owner);
    if (mergeTarget) {
      mergeTarget.count += sendAmount;
      mergeTarget.baseCount += sendAmount;
      continue;
    }

    world.packets.push(createPacket(world, outgoingLink.id, tower.owner, sendAmount, rules.defaultUnit));
  }
}

function preparePacketRuntime(world: World, dtSec: number): void {
  for (const packet of world.packets) {
    packet.ageSec += dtSec;
    packet.attackCooldownRemainingSec = Math.max(0, packet.attackCooldownRemainingSec - dtSec);
    packet.holdRemainingSec = Math.max(0, packet.holdRemainingSec - dtSec);
    packet.tempSpeedMultiplier = packet.baseSpeedMultiplier;
    packet.tempArmorMultiplier = packet.baseArmorMultiplier;
    packet.dpsPerUnit = packet.baseDpsPerUnit;

    if (packet.shieldCycleSec > 0 && packet.shieldUptimeSec > 0) {
      const timeInCycle = packet.ageSec % packet.shieldCycleSec;
      if (timeInCycle <= packet.shieldUptimeSec) {
        packet.tempArmorMultiplier *= 1.8;
      }
    }
  }
}

function applySupportAuras(world: World): void {
  for (const supportPacket of world.packets) {
    if (supportPacket.supportAuraRadiusPx <= 0) {
      continue;
    }

    const supportPos = getPacketPos(world, supportPacket);
    if (!supportPos) {
      continue;
    }

    for (const allyPacket of world.packets) {
      if (allyPacket.id === supportPacket.id || allyPacket.owner !== supportPacket.owner) {
        continue;
      }

      const allyPos = getPacketPos(world, allyPacket);
      if (!allyPos) {
        continue;
      }

      const distance = Math.hypot(supportPos.x - allyPos.x, supportPos.y - allyPos.y);
      if (distance > supportPacket.supportAuraRadiusPx) {
        continue;
      }

      allyPacket.tempSpeedMultiplier *= supportPacket.supportSpeedMultiplier;
      allyPacket.tempArmorMultiplier *= supportPacket.supportArmorMultiplier;
    }
  }
}

function resolvePacketCombat(world: World, dtSec: number, rules: SimulationRules): void {
  const packets = world.packets;

  for (let i = 0; i < packets.length; i += 1) {
    const packetA = packets[i];
    if (packetA.count <= 0) {
      continue;
    }

    const packetAPos = getPacketPos(world, packetA);
    if (!packetAPos) {
      continue;
    }

    for (let j = i + 1; j < packets.length; j += 1) {
      const packetB = packets[j];
      if (packetB.count <= 0 || packetA.owner === packetB.owner) {
        continue;
      }

      const packetBPos = getPacketPos(world, packetB);
      if (!packetBPos) {
        continue;
      }

      const effectiveRange = Math.max(
        rules.collisionDistancePx,
        packetA.attackRangePx,
        packetB.attackRangePx,
      );
      if (distance(packetAPos, packetBPos) > effectiveRange) {
        continue;
      }

      let damageAtoB = 0;
      if (packetA.attackCooldownRemainingSec <= 0) {
        damageAtoB = packetA.count * packetA.dpsPerUnit * dtSec;
        packetA.attackCooldownRemainingSec = positiveOrOne(packetA.attackCooldownSec);
        if (packetA.canStopToShoot) {
          packetA.holdRemainingSec = Math.max(packetA.holdRemainingSec, packetA.attackCooldownSec * 0.45);
        }
      }

      let damageBtoA = 0;
      if (packetB.attackCooldownRemainingSec <= 0) {
        damageBtoA = packetB.count * packetB.dpsPerUnit * dtSec;
        packetB.attackCooldownRemainingSec = positiveOrOne(packetB.attackCooldownSec);
        if (packetB.canStopToShoot) {
          packetB.holdRemainingSec = Math.max(packetB.holdRemainingSec, packetB.attackCooldownSec * 0.45);
        }
      }

      const killsOnB = damageAtoB / positiveOrOne(packetB.hpPerUnit * packetB.tempArmorMultiplier);
      const killsOnA = damageBtoA / positiveOrOne(packetA.hpPerUnit * packetA.tempArmorMultiplier);

      packetA.count = Math.max(0, packetA.count - killsOnA);
      packetB.count = Math.max(0, packetB.count - killsOnB);
    }
  }
}

function movePackets(world: World, dtSec: number, rules: SimulationRules): void {
  for (let i = world.packets.length - 1; i >= 0; i -= 1) {
    const packet = world.packets[i];
    const link = world.getLinkById(packet.linkId);
    if (!link) {
      world.removePacketAt(i);
      continue;
    }

    const linkLengthPx = getPolylineLength(link.points);
    if (linkLengthPx <= 0.001) {
      world.removePacketAt(i);
      continue;
    }

    if (packet.holdRemainingSec > 0) {
      continue;
    }

    if (resolveRangedSiege(world, packet, linkLengthPx, dtSec, rules)) {
      continue;
    }

    const effectiveSpeed = packet.speedPxPerSec * packet.tempSpeedMultiplier;
    packet.progress01 += (effectiveSpeed / linkLengthPx) * dtSec;
    if (packet.progress01 >= 1) {
      resolveArrival(world, packet, rules);
      world.removePacketAt(i);
    }
  }
}

function resolveRangedSiege(
  world: World,
  packet: UnitPacket,
  linkLengthPx: number,
  dtSec: number,
  rules: SimulationRules,
): boolean {
  if (packet.attackRangePx <= rules.collisionDistancePx) {
    return false;
  }

  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return false;
  }

  const targetTower = world.getTowerById(link.toTowerId);
  if (!targetTower || targetTower.owner === packet.owner) {
    return false;
  }

  const remainingDistancePx = (1 - packet.progress01) * linkLengthPx;
  if (remainingDistancePx > packet.attackRangePx) {
    return false;
  }

  if (packet.attackCooldownRemainingSec > 0) {
    packet.holdRemainingSec = Math.max(packet.holdRemainingSec, 0.08);
    return true;
  }

  const damage = packet.count * packet.dpsPerUnit * dtSec;
  targetTower.hp -= damage;
  packet.attackCooldownRemainingSec = positiveOrOne(packet.attackCooldownSec);
  packet.holdRemainingSec = Math.max(packet.holdRemainingSec, packet.attackCooldownSec * 0.65);

  if (targetTower.hp > 0) {
    return true;
  }

  targetTower.owner = packet.owner;
  targetTower.hp = targetTower.maxHp;
  targetTower.troopCount = Math.min(targetTower.maxTroops, rules.captureSeedTroops);
  world.clearOutgoingLink(targetTower.id);
  return false;
}

function resolveArrival(world: World, packet: UnitPacket, rules: SimulationRules): void {
  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return;
  }

  const targetTower = world.getTowerById(link.toTowerId);
  if (!targetTower) {
    return;
  }

  if (targetTower.owner === packet.owner) {
    targetTower.troopCount = Math.min(targetTower.maxTroops, targetTower.troopCount + packet.count);
    return;
  }

  const defendersRemaining = targetTower.troopCount - packet.count;
  if (defendersRemaining >= 0) {
    targetTower.troopCount = defendersRemaining;
    return;
  }

  const overflow = -defendersRemaining;
  targetTower.troopCount = 0;
  targetTower.hp -= overflow * packet.dpsPerUnit;

  if (targetTower.hp > 0) {
    return;
  }

  targetTower.owner = packet.owner;
  targetTower.hp = targetTower.maxHp;
  targetTower.troopCount = Math.min(targetTower.maxTroops, rules.captureSeedTroops);
  world.clearOutgoingLink(targetTower.id);
}

function createPacket(
  world: World,
  linkId: string,
  owner: Owner,
  count: number,
  unit: UnitRuleSet,
): UnitPacket {
  packetSequence += 1;

  const packet: UnitPacket = {
    id: `pkt-${packetSequence}`,
    owner,
    count,
    baseCount: count,
    speedPxPerSec: unit.speedPxPerSec,
    baseSpeedMultiplier: 1,
    dpsPerUnit: unit.dpsPerUnit,
    baseDpsPerUnit: unit.dpsPerUnit,
    hpPerUnit: unit.hpPerUnit,
    linkId,
    progress01: 0,
    archetypeId: "basic",
    tags: [],
    attackRangePx: 12,
    attackCooldownSec: 0.35,
    attackCooldownRemainingSec: 0,
    holdRemainingSec: 0,
    shieldCycleSec: 0,
    shieldUptimeSec: 0,
    supportAuraRadiusPx: 0,
    supportSpeedMultiplier: 1,
    supportArmorMultiplier: 1,
    splitChildArchetypeId: null,
    splitChildCount: 0,
    canStopToShoot: false,
    sizeScale: 1,
    colorTint: "",
    vfxHook: "",
    sfxHook: "",
    icon: "",
    isElite: false,
    eliteDropGold: 0,
    eliteDropBuffId: null,
    isBoss: false,
    bossEnraged: false,
    ageSec: 0,
    baseArmorMultiplier: 1,
    tempSpeedMultiplier: 1,
    tempArmorMultiplier: 1,
    sourceLane: -1,
    sourceWaveIndex: 0,
  };

  return world.acquirePacket(packet);
}

function findMergeTarget(packets: UnitPacket[], linkId: string, owner: Owner): UnitPacket | null {
  for (const packet of packets) {
    if (
      packet.linkId === linkId &&
      packet.owner === owner &&
      packet.progress01 < PACKET_MERGE_PROGRESS_THRESHOLD &&
      packet.archetypeId === "basic" &&
      !packet.isElite
    ) {
      return packet;
    }
  }
  return null;
}

function getPolylineLength(points: Vec2[]): number {
  if (points.length < 2) {
    return 0;
  }

  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.hypot(dx, dy);
  }
  return length;
}

function samplePointOnPolyline(points: Vec2[], progress01: number): Vec2 | null {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const clampedProgress = Math.max(0, Math.min(1, progress01));
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.001) {
    return points[0];
  }

  const targetDistance = clampedProgress * totalLength;
  let walkedDistance = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength <= 0.001) {
      continue;
    }

    if (walkedDistance + segmentLength >= targetDistance) {
      const t = (targetDistance - walkedDistance) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }

    walkedDistance += segmentLength;
  }

  return points[points.length - 1];
}

function getPacketPos(world: World, packet: UnitPacket): Vec2 | null {
  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }
  return samplePointOnPolyline(link.points, packet.progress01);
}

function removeDestroyedPackets(world: World): void {
  for (let i = world.packets.length - 1; i >= 0; i -= 1) {
    if (world.packets[i].count <= 0) {
      world.removePacketAt(i);
    }
  }
}

function positiveOrOne(value: number): number {
  return value > 0 ? value : 1;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
