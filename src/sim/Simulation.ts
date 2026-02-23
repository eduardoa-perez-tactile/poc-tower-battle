import type { Link, Owner, Tower, UnitPacket, Vec2, World } from "./World";
import { armorFromMultiplier, combineArmorMultiplicative } from "./TerritoryControl";

export interface UnitRuleSet {
  speedPxPerSec: number;
  dpsPerUnit: number;
  hpPerUnit: number;
}

export interface SimulationPacketStatCaps {
  speedMin: number;
  speedMax: number;
  damageMin: number;
  damageMax: number;
  hpMin: number;
  hpMax: number;
  armorMin: number;
  armorMax: number;
}

export interface SimulationFightModel {
  shieldArmorUptimeMultiplier: number;
  combatHoldFactor: number;
  rangedHoldFactor: number;
  linkCutterHoldFactor: number;
}

export interface SimulationRules {
  sendRatePerSec: number;
  collisionDistancePx: number;
  captureSeedTroops: number;
  captureRateMultiplier: number;
  playerCaptureEfficiencyMul: number;
  regenMinPerSec: number;
  regenMaxPerSec: number;
  playerRegenMultiplier: number;
  enemyRegenMultiplier: number;
  defaultPacketArmor: number;
  playerPacketArmorAdd: number;
  playerPacketArmorMul: number;
  linkDecayPerSec: number;
  linkDecayCanBreak: boolean;
  packetStatCaps: SimulationPacketStatCaps;
  fightModel: SimulationFightModel;
  defaultUnit: UnitRuleSet;
}

export interface SimulationTemporaryModifiers {
  playerPacketSpeedMul: number;
}

const PACKET_MERGE_PROGRESS_THRESHOLD = 0.15;
let packetSequence = 0;

const DEFAULT_TEMPORARY_MODIFIERS: SimulationTemporaryModifiers = {
  playerPacketSpeedMul: 1,
};

export function updateWorld(
  world: World,
  dtSec: number,
  rules: SimulationRules,
  temporaryModifiers: SimulationTemporaryModifiers = DEFAULT_TEMPORARY_MODIFIERS,
): void {
  world.tickLinkRuntime(dtSec, rules.linkDecayPerSec, rules.linkDecayCanBreak);
  applyOverchargeDrain(world, dtSec);
  regenTowers(world, dtSec, rules);
  sendTroops(world, dtSec, rules);
  preparePacketRuntime(world, dtSec, rules, temporaryModifiers);
  applySupportAuras(world);
  refreshEffectivePacketArmor(world);
  resolvePacketCombat(world, dtSec, rules);
  movePackets(world, dtSec, rules);
  removeDestroyedPackets(world);
}

function applyOverchargeDrain(world: World, dtSec: number): void {
  for (const link of world.links) {
    if (link.overchargeDrain <= 0) {
      continue;
    }

    const originTower = world.getTowerById(link.fromTowerId);
    if (!originTower || originTower.owner === "neutral") {
      continue;
    }

    const drainAmount = link.overchargeDrain * dtSec;
    originTower.troops = Math.max(0, originTower.troops - drainAmount);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function regenTowers(world: World, dtSec: number, rules: SimulationRules): void {
  const auraBonuses = computeTowerAuraBonuses(world);

  for (const tower of world.towers) {
    if (tower.owner === "neutral") {
      continue;
    }

    const auraBonus = auraBonuses.get(tower.id) ?? 0;
    const ownerRegenMul = tower.owner === "player" ? rules.playerRegenMultiplier : rules.enemyRegenMultiplier;
    const effectiveRegen = Number.isFinite(tower.effectiveRegen) ? tower.effectiveRegen : tower.regenRate;
    const regenRate = effectiveRegen * ownerRegenMul * (1 + auraBonus);
    const clampedRegenRate = clamp(regenRate, rules.regenMinPerSec, rules.regenMaxPerSec);
    tower.troops = Math.min(tower.maxTroops, tower.troops + clampedRegenRate * dtSec);
  }
}

function computeTowerAuraBonuses(world: World): Map<string, number> {
  const auraBonuses = new Map<string, number>();

  for (const auraTower of world.towers) {
    if (auraTower.owner === "neutral" || auraTower.auraRadius <= 0 || auraTower.auraRegenBonusPct <= 0) {
      continue;
    }

    for (const targetTower of world.towers) {
      if (targetTower.id === auraTower.id || targetTower.owner !== auraTower.owner) {
        continue;
      }

      const dist = Math.hypot(auraTower.x - targetTower.x, auraTower.y - targetTower.y);
      if (dist > auraTower.auraRadius) {
        continue;
      }

      auraBonuses.set(
        targetTower.id,
        (auraBonuses.get(targetTower.id) ?? 0) + auraTower.auraRegenBonusPct,
      );
    }
  }

  return auraBonuses;
}

function sendTroops(world: World, dtSec: number, rules: SimulationRules): void {
  const desiredSend = rules.sendRatePerSec * dtSec;
  if (desiredSend <= 0) {
    return;
  }

  for (const tower of world.towers) {
    const outgoingLinks = world.getOutgoingLinks(tower.id);
    if (outgoingLinks.length === 0) {
      continue;
    }

    const sendBudget = Math.min(desiredSend, tower.troops);
    if (sendBudget <= 0) {
      continue;
    }

    const sendPerLink = sendBudget / outgoingLinks.length;
    if (sendPerLink <= 0) {
      continue;
    }

    tower.troops -= sendBudget;

    for (const link of outgoingLinks) {
      const mergeTarget = findMergeTarget(world.packets, link.id, tower.owner);
      if (mergeTarget) {
        mergeTarget.count += sendPerLink;
        mergeTarget.baseCount += sendPerLink;
        continue;
      }

      world.packets.push(createPacket(world, link, tower, sendPerLink, rules.defaultUnit, rules));
    }
  }
}

function preparePacketRuntime(
  world: World,
  dtSec: number,
  rules: SimulationRules,
  temporaryModifiers: SimulationTemporaryModifiers,
): void {
  for (const packet of world.packets) {
    packet.ageSec += dtSec;
    packet.attackCooldownRemainingSec = Math.max(0, packet.attackCooldownRemainingSec - dtSec);
    packet.holdRemainingSec = Math.max(0, packet.holdRemainingSec - dtSec);
    packet.tempSpeedMultiplier =
      packet.baseSpeedMultiplier * (packet.owner === "player" ? temporaryModifiers.playerPacketSpeedMul : 1);
    packet.tempArmorMultiplier = packet.baseArmorMultiplier;
    if (!Number.isFinite(packet.baseArmor)) {
      packet.baseArmor = armorFromMultiplier(packet.baseArmorMultiplier);
    }
    packet.dpsPerUnit = packet.baseDpsPerUnit;

    if (packet.shieldCycleSec > 0 && packet.shieldUptimeSec > 0) {
      const timeInCycle = packet.ageSec % packet.shieldCycleSec;
      if (timeInCycle <= packet.shieldUptimeSec) {
        packet.tempArmorMultiplier *= rules.fightModel.shieldArmorUptimeMultiplier;
      }
    }
  }
}

function refreshEffectivePacketArmor(world: World): void {
  for (const packet of world.packets) {
    const runtimeArmor = armorFromMultiplier(packet.tempArmorMultiplier);
    const territoryArmor = Number.isFinite(packet.territoryArmorBonus) ? packet.territoryArmorBonus : 0;
    packet.effectiveArmor = combineArmorMultiplicative([runtimeArmor, territoryArmor]);
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

      const dist = Math.hypot(supportPos.x - allyPos.x, supportPos.y - allyPos.y);
      if (dist > supportPacket.supportAuraRadiusPx) {
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
          packetA.holdRemainingSec = Math.max(
            packetA.holdRemainingSec,
            packetA.attackCooldownSec * rules.fightModel.combatHoldFactor,
          );
        }
      }

      let damageBtoA = 0;
      if (packetB.attackCooldownRemainingSec <= 0) {
        damageBtoA = packetB.count * packetB.dpsPerUnit * dtSec;
        packetB.attackCooldownRemainingSec = positiveOrOne(packetB.attackCooldownSec);
        if (packetB.canStopToShoot) {
          packetB.holdRemainingSec = Math.max(
            packetB.holdRemainingSec,
            packetB.attackCooldownSec * rules.fightModel.combatHoldFactor,
          );
        }
      }

      const damageTakenByB = damageAtoB * (1 - packetB.effectiveArmor);
      const damageTakenByA = damageBtoA * (1 - packetA.effectiveArmor);
      const killsOnB = damageTakenByB / positiveOrOne(packetB.hpPerUnit);
      const killsOnA = damageTakenByA / positiveOrOne(packetA.hpPerUnit);

      packetA.count = Math.max(0, packetA.count - killsOnA);
      packetB.count = Math.max(0, packetB.count - killsOnB);
    }
  }
}

function movePackets(world: World, dtSec: number, rules: SimulationRules): void {
  for (let i = world.packets.length - 1; i >= 0; i -= 1) {
    const packet = world.packets[i];

    if (packet.isLinkCutter) {
      moveLinkCutterPacket(world, packet, dtSec, rules);
      continue;
    }

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

    const originTower = world.getTowerById(link.fromTowerId);
    const originSpeedBonus = originTower ? originTower.linkSpeedBonus : 0;
    const effectiveSpeed =
      packet.speedPxPerSec *
      packet.tempSpeedMultiplier *
      (1 + link.speedMultiplier) *
      (1 + originSpeedBonus);

    packet.progress01 += (effectiveSpeed / linkLengthPx) * dtSec;
    if (packet.progress01 >= 1) {
      resolveArrival(world, packet, rules);
      world.removePacketAt(i);
    }
  }
}

function moveLinkCutterPacket(
  world: World,
  packet: UnitPacket,
  dtSec: number,
  rules: SimulationRules,
): void {
  if (!packet.hasWorldPosition) {
    const start = getPacketPosFromLink(world, packet) ?? { x: 0, y: 0 };
    packet.worldX = start.x;
    packet.worldY = start.y;
    packet.hasWorldPosition = true;
  }

  if (packet.holdRemainingSec > 0) {
    return;
  }

  const currentPos = { x: packet.worldX, y: packet.worldY };
  const targetLink = findNearestTargetLink(world, packet.owner, currentPos);
  const stepDistance = packet.speedPxPerSec * packet.tempSpeedMultiplier * dtSec;

  if (targetLink) {
    const linkMid = samplePointOnPolyline(targetLink.points, 0.5) ?? targetLink.points[targetLink.points.length - 1];
    if (!linkMid) {
      return;
    }

    movePacketTowards(packet, linkMid, stepDistance);

    if (distance({ x: packet.worldX, y: packet.worldY }, linkMid) <= packet.attackRangePx) {
      const integrityDamage = packet.linkIntegrityDamagePerSec * packet.count * dtSec;
      world.damageLinkIntegrity(targetLink.id, integrityDamage);
      packet.holdRemainingSec = Math.max(
        packet.holdRemainingSec,
        packet.attackCooldownSec * rules.fightModel.linkCutterHoldFactor,
      );
    }
    return;
  }

  const fallbackTower = pickNearestTower(world.towers, currentPos, packet.owner);
  if (!fallbackTower) {
    return;
  }

  movePacketTowards(packet, fallbackTower, stepDistance);

  if (distance({ x: packet.worldX, y: packet.worldY }, fallbackTower) > packet.attackRangePx) {
    return;
  }

  if (packet.attackCooldownRemainingSec > 0) {
    packet.holdRemainingSec = Math.max(packet.holdRemainingSec, 0.08);
    return;
  }

  const damage = packet.count * packet.dpsPerUnit * dtSec;
  applyDamageToTower(fallbackTower, damage);
  packet.attackCooldownRemainingSec = positiveOrOne(packet.attackCooldownSec);
  packet.holdRemainingSec = Math.max(
    packet.holdRemainingSec,
    packet.attackCooldownSec * rules.fightModel.combatHoldFactor,
  );

  if (fallbackTower.hp <= 0) {
    captureTower(world, fallbackTower, packet.owner, rules.captureSeedTroops);
  }
}

function findNearestTargetLink(world: World, owner: Owner, origin: Vec2): Link | null {
  let best: Link | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const link of world.links) {
    if (link.isScripted || link.owner === owner) {
      continue;
    }

    const midpoint = samplePointOnPolyline(link.points, 0.5) ?? link.points[link.points.length - 1];
    if (!midpoint) {
      continue;
    }

    const dist = distance(origin, midpoint);
    if (dist < bestDist || (dist === bestDist && best && link.id < best.id)) {
      bestDist = dist;
      best = link;
    }
  }

  return best;
}

function pickNearestTower(towers: Tower[], origin: Vec2, packetOwner: Owner): Tower | null {
  let best: Tower | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const tower of towers) {
    if (tower.owner === packetOwner) {
      continue;
    }
    const dist = Math.hypot(tower.x - origin.x, tower.y - origin.y);
    if (dist < bestDist || (dist === bestDist && best && tower.id < best.id)) {
      bestDist = dist;
      best = tower;
    }
  }

  return best;
}

function movePacketTowards(packet: UnitPacket, target: Vec2, distanceStep: number): void {
  const dx = target.x - packet.worldX;
  const dy = target.y - packet.worldY;
  const len = Math.hypot(dx, dy);
  if (len <= 0.001) {
    return;
  }

  const t = Math.min(1, distanceStep / len);
  packet.worldX += dx * t;
  packet.worldY += dy * t;
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
  applyDamageToTower(targetTower, damage);
  packet.attackCooldownRemainingSec = positiveOrOne(packet.attackCooldownSec);
  packet.holdRemainingSec = Math.max(
    packet.holdRemainingSec,
    packet.attackCooldownSec * rules.fightModel.rangedHoldFactor,
  );

  if (targetTower.hp > 0) {
    return true;
  }

  captureTower(world, targetTower, packet.owner, rules.captureSeedTroops);
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
    targetTower.troops = Math.min(targetTower.maxTroops, targetTower.troops + packet.count);
    return;
  }

  const captureMul = packet.owner === "player" ? rules.playerCaptureEfficiencyMul : 1;
  const incomingStrength =
    packet.count * captureMul * targetTower.captureSpeedTakenMultiplier * rules.captureRateMultiplier;
  const defendersRemaining = targetTower.troops - incomingStrength;
  if (defendersRemaining >= 0) {
    targetTower.troops = defendersRemaining;
    return;
  }

  const overflow = -defendersRemaining;
  targetTower.troops = 0;
  applyDamageToTower(targetTower, overflow * packet.dpsPerUnit);

  if (targetTower.hp > 0) {
    return;
  }

  captureTower(world, targetTower, packet.owner, rules.captureSeedTroops);
}

function captureTower(world: World, tower: Tower, newOwner: Owner, captureSeedTroops: number): void {
  const previousOwner = tower.owner;
  tower.owner = newOwner;
  tower.hp = tower.maxHp;
  tower.troops = Math.min(tower.maxTroops, captureSeedTroops);
  world.clearOutgoingLink(tower.id);

  if (previousOwner !== newOwner) {
    world.notifyTowerCaptured(tower, previousOwner, newOwner);
  }
}

function applyDamageToTower(tower: Tower, rawDamage: number): void {
  tower.hp -= rawDamage / positiveOrOne(tower.defenseMultiplier);
}

function createPacket(
  world: World,
  link: Link,
  originTower: Tower,
  count: number,
  unit: UnitRuleSet,
  rules: SimulationRules,
): UnitPacket {
  packetSequence += 1;

  const packetDamageMultiplier = originTower.packetDamageMultiplier * (1 + link.damageBonus);
  const caps = rules.packetStatCaps;
  const speedPxPerSec = clamp(unit.speedPxPerSec, caps.speedMin, caps.speedMax);
  const dpsPerUnit = clamp(unit.dpsPerUnit * packetDamageMultiplier, caps.damageMin, caps.damageMax);
  const hpPerUnit = clamp(unit.hpPerUnit, caps.hpMin, caps.hpMax);
  const armorMul = originTower.owner === "player" ? rules.playerPacketArmorMul : 1;
  const armorAdd = originTower.owner === "player" ? rules.playerPacketArmorAdd : 0;
  const baseArmorMultiplier = clamp(
    (rules.defaultPacketArmor + armorAdd + link.armorBonus) * armorMul,
    caps.armorMin,
    caps.armorMax,
  );
  const baseArmor = armorFromMultiplier(baseArmorMultiplier);

  const packet: UnitPacket = {
    id: `pkt-${packetSequence}`,
    owner: originTower.owner,
    count,
    baseCount: count,
    speedPxPerSec,
    baseSpeedMultiplier: 1,
    dpsPerUnit,
    baseDpsPerUnit: dpsPerUnit,
    hpPerUnit,
    linkId: link.id,
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
    isLinkCutter: false,
    linkIntegrityDamagePerSec: 0,
    hasWorldPosition: false,
    worldX: 0,
    worldY: 0,
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
    baseArmor,
    effectiveArmor: baseArmor,
    territoryArmorBonus: 0,
    baseArmorMultiplier,
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

function getPacketPosFromLink(world: World, packet: UnitPacket): Vec2 | null {
  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }
  return samplePointOnPolyline(link.points, packet.progress01);
}

function getPacketPos(world: World, packet: UnitPacket): Vec2 | null {
  if (packet.hasWorldPosition) {
    return {
      x: packet.worldX,
      y: packet.worldY,
    };
  }
  return getPacketPosFromLink(world, packet);
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
