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
  resolvePacketCombat(world, dtSec, rules);
  movePackets(world, dtSec, rules);
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
      continue;
    }

    world.packets.push(createPacket(outgoingLink.id, tower.owner, sendAmount, rules.defaultUnit));
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
      if (!packetBPos || distance(packetAPos, packetBPos) > rules.collisionDistancePx) {
        continue;
      }

      const damageAtoB = packetA.count * packetA.dpsPerUnit * dtSec;
      const damageBtoA = packetB.count * packetB.dpsPerUnit * dtSec;

      const killsOnB = damageAtoB / positiveOrOne(packetB.hpPerUnit);
      const killsOnA = damageBtoA / positiveOrOne(packetA.hpPerUnit);

      packetA.count = Math.max(0, packetA.count - killsOnA);
      packetB.count = Math.max(0, packetB.count - killsOnB);
    }
  }

  removeDestroyedPackets(world);
}

function movePackets(world: World, dtSec: number, rules: SimulationRules): void {
  for (let i = world.packets.length - 1; i >= 0; i -= 1) {
    const packet = world.packets[i];
    const link = world.getLinkById(packet.linkId);
    if (!link) {
      world.packets.splice(i, 1);
      continue;
    }

    const linkLengthPx = getPolylineLength(link.points);
    if (linkLengthPx <= 0.001) {
      world.packets.splice(i, 1);
      continue;
    }

    packet.progress01 += (packet.speedPxPerSec / linkLengthPx) * dtSec;
    if (packet.progress01 >= 1) {
      resolveArrival(world, packet, rules);
      world.packets.splice(i, 1);
    }
  }
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
  linkId: string,
  owner: Owner,
  count: number,
  unit: UnitRuleSet,
): UnitPacket {
  packetSequence += 1;
  return {
    id: `pkt-${packetSequence}`,
    owner,
    count,
    speedPxPerSec: unit.speedPxPerSec,
    dpsPerUnit: unit.dpsPerUnit,
    hpPerUnit: unit.hpPerUnit,
    linkId,
    progress01: 0,
  };
}

function findMergeTarget(
  packets: UnitPacket[],
  linkId: string,
  owner: Owner,
): UnitPacket | null {
  for (const packet of packets) {
    if (
      packet.linkId === linkId &&
      packet.owner === owner &&
      packet.progress01 < PACKET_MERGE_PROGRESS_THRESHOLD
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

function removeDestroyedPackets(world: World): void {
  for (let i = world.packets.length - 1; i >= 0; i -= 1) {
    if (world.packets[i].count <= 0) {
      world.packets.splice(i, 1);
    }
  }
}

function positiveOrOne(value: number): number {
  return value > 0 ? value : 1;
}

export function getPacketPos(world: World, packet: UnitPacket): Vec2 | null {
  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }
  return samplePointOnPolyline(link.points, packet.progress01);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
