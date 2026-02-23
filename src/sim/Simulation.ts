import type { Owner, UnitPacket, Vec2, World } from "./World";

export interface UnitRuleSet {
  speedPxPerSec: number;
  dpsPerUnit: number;
  hpPerUnit: number;
}

export interface SimulationRules {
  sendRatePerSec: number;
  defaultUnit: UnitRuleSet;
}

const PACKET_MERGE_PROGRESS_THRESHOLD = 0.15;
let packetSequence = 0;

export function updateWorld(world: World, dtSec: number, rules: SimulationRules): void {
  regenTowers(world, dtSec);
  sendTroops(world, dtSec, rules);
  movePackets(world, dtSec);
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

function movePackets(world: World, dtSec: number): void {
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
      resolveArrival(world, packet);
      world.packets.splice(i, 1);
    }
  }
}

function resolveArrival(world: World, packet: UnitPacket): void {
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
  }
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
