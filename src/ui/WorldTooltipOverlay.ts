import { TOWER_RADIUS_PX, type Tower, type UnitPacket, type Vec2, type World } from "../sim/World";
import type { EnemyArchetypeDefinition } from "../waves/Definitions";
import { clampToViewport, useWorldToScreen } from "./worldToScreen";

export interface BossTooltipState {
  phase: string;
  upcomingTelegraph: string;
}

export interface WorldTooltipOverlayOptions {
  canvas: HTMLCanvasElement;
  getWorld: () => World | null;
  isMissionScreen: () => boolean;
  isDraggingLink: () => boolean;
  isTowerTooltipsEnabled: () => boolean;
  isEnemyTooltipsEnabled: () => boolean;
  getBossTooltipState: () => BossTooltipState | null;
  enemyArchetypesById: ReadonlyMap<string, EnemyArchetypeDefinition>;
}

interface HoverTowerData {
  tower: Tower;
  incomingFriendlyCount: number;
  incomingEnemyCount: number;
  incomingPlayerUnits: number;
  incomingEnemyUnits: number;
  incomingNeutralUnits: number;
  outgoingTargets: string[];
  statusChips: string[];
}

interface HoverEnemyData {
  packet: UnitPacket;
  archetype: EnemyArchetypeDefinition | null;
  mechanicText: string | null;
}

interface TowerControlState {
  statusLabel: string;
  ruleHint: string | null;
}

const PICK_INTERVAL_MS = 80;
const SMOOTH_FACTOR = 0.33;
const VIEWPORT_PADDING_PX = 10;

export class WorldTooltipOverlay {
  private readonly options: WorldTooltipOverlayOptions;
  private readonly root: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly toScreen: (position: Vec2) => { x: number; y: number } | null;

  private pickTimer: number | null;
  private rafHandle: number | null;
  private pointerInsideCanvas: boolean;
  private pointerCanvasPos: Vec2;
  private hoveredAnchorWorld: Vec2 | null;
  private smoothedScreenPos: Vec2 | null;
  private visible: boolean;
  private contentSignature: string;

  constructor(options: WorldTooltipOverlayOptions) {
    this.options = options;
    this.root = document.createElement("div");
    this.root.className = "world-tooltip-overlay";

    this.tooltip = document.createElement("div");
    this.tooltip.className = "world-tooltip";
    this.tooltip.style.opacity = "0";
    this.root.appendChild(this.tooltip);

    this.toScreen = useWorldToScreen(options.canvas);
    this.pickTimer = null;
    this.rafHandle = null;
    this.pointerInsideCanvas = false;
    this.pointerCanvasPos = { x: 0, y: 0 };
    this.hoveredAnchorWorld = null;
    this.smoothedScreenPos = null;
    this.visible = false;
    this.contentSignature = "";
  }

  start(): void {
    document.body.appendChild(this.root);
    this.options.canvas.addEventListener("mouseenter", this.onMouseEnter);
    this.options.canvas.addEventListener("mouseleave", this.onMouseLeave);
    this.options.canvas.addEventListener("mousemove", this.onMouseMove);

    this.pickTimer = window.setInterval(() => {
      this.pickHoveredEntity();
    }, PICK_INTERVAL_MS);

    this.rafHandle = requestAnimationFrame(this.onAnimationFrame);
  }

  dispose(): void {
    this.options.canvas.removeEventListener("mouseenter", this.onMouseEnter);
    this.options.canvas.removeEventListener("mouseleave", this.onMouseLeave);
    this.options.canvas.removeEventListener("mousemove", this.onMouseMove);

    if (this.pickTimer !== null) {
      window.clearInterval(this.pickTimer);
      this.pickTimer = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }

    this.root.remove();
  }

  private readonly onMouseEnter = (): void => {
    this.pointerInsideCanvas = true;
  };

  private readonly onMouseLeave = (): void => {
    this.pointerInsideCanvas = false;
    this.hideTooltip();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const rect = this.options.canvas.getBoundingClientRect();
    this.pointerCanvasPos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  private readonly onAnimationFrame = (): void => {
    this.rafHandle = requestAnimationFrame(this.onAnimationFrame);

    if (!this.visible || !this.hoveredAnchorWorld) {
      return;
    }

    const anchorScreen = this.toScreen(this.hoveredAnchorWorld);
    if (!anchorScreen) {
      this.hideTooltip();
      return;
    }

    const bounds = this.tooltip.getBoundingClientRect();
    const targetX = clampToViewport(
      anchorScreen.x - bounds.width / 2,
      VIEWPORT_PADDING_PX,
      window.innerWidth - bounds.width - VIEWPORT_PADDING_PX,
    );

    const aboveY = anchorScreen.y - bounds.height - 16;
    const belowY = anchorScreen.y + 16;
    const rawTargetY = aboveY < VIEWPORT_PADDING_PX ? belowY : aboveY;
    const targetY = clampToViewport(
      rawTargetY,
      VIEWPORT_PADDING_PX,
      window.innerHeight - bounds.height - VIEWPORT_PADDING_PX,
    );

    if (!this.smoothedScreenPos) {
      this.smoothedScreenPos = { x: targetX, y: targetY };
    } else {
      this.smoothedScreenPos.x += (targetX - this.smoothedScreenPos.x) * SMOOTH_FACTOR;
      this.smoothedScreenPos.y += (targetY - this.smoothedScreenPos.y) * SMOOTH_FACTOR;
    }

    this.tooltip.style.transform = `translate3d(${this.smoothedScreenPos.x.toFixed(1)}px, ${this.smoothedScreenPos.y.toFixed(1)}px, 0)`;
  };

  private pickHoveredEntity(): void {
    if (!this.options.isMissionScreen() || !this.pointerInsideCanvas) {
      this.hideTooltip();
      return;
    }

    const world = this.options.getWorld();
    if (!world) {
      this.hideTooltip();
      return;
    }

    const dragging = this.options.isDraggingLink();

    if (this.options.isTowerTooltipsEnabled()) {
      const hoveredTower = world.getTowerAtPoint(this.pointerCanvasPos.x, this.pointerCanvasPos.y);
      if (hoveredTower) {
        const towerData = this.collectTowerData(world, hoveredTower);
        this.showTowerTooltip(towerData, dragging);
        this.hoveredAnchorWorld = {
          x: hoveredTower.x,
          y: hoveredTower.y - TOWER_RADIUS_PX,
        };
        return;
      }
    }

    if (dragging) {
      this.hideTooltip();
      return;
    }

    if (!this.options.isEnemyTooltipsEnabled()) {
      this.hideTooltip();
      return;
    }

    const enemyHit = this.pickEnemyPacket(world, this.pointerCanvasPos);
    if (!enemyHit) {
      this.hideTooltip();
      return;
    }

    this.showEnemyTooltip(enemyHit);
    const position = getPacketWorldPosition(world, enemyHit.packet);
    this.hoveredAnchorWorld = position
      ? {
          x: position.x,
          y: position.y - 12,
        }
      : null;

    if (!this.hoveredAnchorWorld) {
      this.hideTooltip();
    }
  }

  private collectTowerData(world: World, tower: Tower): HoverTowerData {
    let incomingFriendlyCount = 0;
    let incomingEnemyCount = 0;
    let incomingPlayerUnits = 0;
    let incomingEnemyUnits = 0;
    let incomingNeutralUnits = 0;

    for (const packet of world.packets) {
      const link = world.getLinkById(packet.linkId);
      if (!link || link.toTowerId !== tower.id) {
        continue;
      }
      if (packet.owner === tower.owner) {
        incomingFriendlyCount += 1;
      } else {
        incomingEnemyCount += 1;
      }

      if (packet.owner === "player") {
        incomingPlayerUnits += packet.count;
      } else if (packet.owner === "enemy") {
        incomingEnemyUnits += packet.count;
      } else {
        incomingNeutralUnits += packet.count;
      }
    }

    const outgoingTargets = world
      .getOutgoingLinks(tower.id)
      .map((link) => link.toTowerId)
      .sort((a, b) => a.localeCompare(b));

    const statusChips: string[] = [];
    if (tower.defenseMultiplier > 1.05) {
      statusChips.push("Shielded");
    }
    if (tower.auraRegenBonusPct > 0.01) {
      statusChips.push("Aura");
    }
    if (tower.captureSpeedTakenMultiplier < 0.95) {
      statusChips.push("Fortified");
    }

    return {
      tower,
      incomingFriendlyCount,
      incomingEnemyCount,
      incomingPlayerUnits,
      incomingEnemyUnits,
      incomingNeutralUnits,
      outgoingTargets,
      statusChips,
    };
  }

  private pickEnemyPacket(world: World, cursor: Vec2): HoverEnemyData | null {
    let bestPacket: UnitPacket | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (const packet of world.packets) {
      if (packet.owner !== "enemy") {
        continue;
      }

      const position = getPacketWorldPosition(world, packet);
      if (!position) {
        continue;
      }

      const radius = Math.max(10, 8 * packet.sizeScale + 6);
      const dx = cursor.x - position.x;
      const dy = cursor.y - position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > radius * radius) {
        continue;
      }

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestPacket = packet;
      }
    }

    if (!bestPacket) {
      return null;
    }

    const archetype = this.options.enemyArchetypesById.get(bestPacket.archetypeId) ?? null;

    return {
      packet: bestPacket,
      archetype,
      mechanicText: resolveMechanicText(bestPacket),
    };
  }

  private showTowerTooltip(data: HoverTowerData, minimalMode: boolean): void {
    const ownerLabel = ownerText(data.tower.owner);
    const outgoingVisible = data.outgoingTargets.slice(0, 3);
    const outgoingOverflow = Math.max(0, data.outgoingTargets.length - outgoingVisible.length);
    const controlState = resolveTowerControlState(data);

    const signature = [
      "tower",
      data.tower.id,
      data.tower.owner,
      Math.round(data.tower.troops),
      data.tower.regenRate.toFixed(2),
      data.incomingFriendlyCount,
      data.incomingEnemyCount,
      Math.round(data.tower.hp),
      outgoingVisible.join(","),
      outgoingOverflow,
      data.statusChips.join(","),
      controlState.statusLabel,
      controlState.ruleHint ?? "",
      minimalMode ? "minimal" : "full",
    ].join("|");

    if (signature !== this.contentSignature) {
      this.tooltip.replaceChildren();

      const title = document.createElement("div");
      title.className = "world-tooltip-title";
      title.textContent = `${data.tower.id} (${ownerLabel})`;
      this.tooltip.appendChild(title);

      const mainValue = document.createElement("div");
      mainValue.className = "world-tooltip-main";
      mainValue.textContent = `Troops ${Math.round(data.tower.troops)} • Regen ${data.tower.regenRate.toFixed(2)}/s`;
      this.tooltip.appendChild(mainValue);

      if (!minimalMode) {
        this.tooltip.appendChild(createTooltipRow("Tower", data.tower.archetype));

        const incomingText =
          data.incomingFriendlyCount + data.incomingEnemyCount > 0
            ? `F ${data.incomingFriendlyCount} / E ${data.incomingEnemyCount}`
            : "?";
        this.tooltip.appendChild(createTooltipRow("Incoming", incomingText));
        this.tooltip.appendChild(createTooltipRow("Control", controlState.statusLabel));
        if (controlState.ruleHint) {
          this.tooltip.appendChild(createTooltipRow("Capture", controlState.ruleHint));
        }

        if (outgoingVisible.length > 0) {
          const outgoingText =
            outgoingOverflow > 0
              ? `${outgoingVisible.join(", ")} +${outgoingOverflow} more`
              : outgoingVisible.join(", ");
          this.tooltip.appendChild(createTooltipRow("Outgoing", outgoingText));
        }

        if (data.statusChips.length > 0) {
          this.tooltip.appendChild(createTooltipChipRow(data.statusChips));
        }
      }

      this.contentSignature = signature;
    }

    this.showTooltip();
  }

  private showEnemyTooltip(data: HoverEnemyData): void {
    const packet = data.packet;
    const archetypeName = data.archetype?.name ?? packet.archetypeId;
    const description = data.archetype?.description ?? "Behavior data not available.";

    const tagChips: string[] = [];
    if (packet.isElite) {
      tagChips.push("Elite");
    }
    if (packet.tags.includes("miniboss")) {
      tagChips.push("Miniboss");
    }
    if (packet.isBoss || packet.tags.includes("boss")) {
      tagChips.push("Boss");
    }
    for (const tag of packet.tags) {
      const normalized = normalizeTag(tag);
      if (!tagChips.includes(normalized)) {
        tagChips.push(normalized);
      }
    }

    const bossState = packet.isBoss ? this.options.getBossTooltipState() : null;

    const signature = [
      "enemy",
      packet.id,
      packet.archetypeId,
      Math.round(packet.count),
      packet.dpsPerUnit.toFixed(2),
      packet.speedPxPerSec.toFixed(1),
      tagChips.join(","),
      description,
      data.mechanicText ?? "",
      bossState?.phase ?? "",
      bossState?.upcomingTelegraph ?? "",
    ].join("|");

    if (signature !== this.contentSignature) {
      this.tooltip.replaceChildren();

      const title = document.createElement("div");
      title.className = "world-tooltip-title";
      title.textContent = archetypeName;
      this.tooltip.appendChild(title);

      if (tagChips.length > 0) {
        this.tooltip.appendChild(createTooltipChipRow(tagChips));
      }

      const body = document.createElement("div");
      body.className = "world-tooltip-desc";
      body.textContent = description;
      this.tooltip.appendChild(body);

      this.tooltip.appendChild(
        createTooltipRow(
          "Stats",
          `HP ${Math.round(packet.count * packet.hpPerUnit)} • SPD ${packet.speedPxPerSec.toFixed(0)} • DMG ${packet.dpsPerUnit.toFixed(1)}`,
        ),
      );

      if (data.mechanicText) {
        this.tooltip.appendChild(createTooltipRow("Mechanic", data.mechanicText));
      }

      if (packet.isBoss) {
        this.tooltip.appendChild(
          createTooltipRow("Phase", bossState?.phase ?? "Phase 1"),
        );
        this.tooltip.appendChild(
          createTooltipRow(
            "Telegraphs",
            bossState?.upcomingTelegraph ?? "Slam / Summon / Enrage",
          ),
        );
      }

      this.contentSignature = signature;
    }

    this.showTooltip();
  }

  private showTooltip(): void {
    this.visible = true;
    this.tooltip.style.opacity = "1";
  }

  private hideTooltip(): void {
    this.visible = false;
    this.hoveredAnchorWorld = null;
    this.smoothedScreenPos = null;
    this.tooltip.style.opacity = "0";
    this.contentSignature = "";
  }
}

function createTooltipRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "world-tooltip-row";

  const labelNode = document.createElement("span");
  labelNode.className = "world-tooltip-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("span");
  valueNode.className = "world-tooltip-value";
  valueNode.textContent = value;

  row.append(labelNode, valueNode);
  return row;
}

function createTooltipChipRow(chips: string[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "world-tooltip-chips";

  for (const chip of chips) {
    const chipNode = document.createElement("span");
    chipNode.className = "world-tooltip-chip";
    chipNode.textContent = chip;
    row.appendChild(chipNode);
  }

  return row;
}

function resolveTowerControlState(data: HoverTowerData): TowerControlState {
  const tower = data.tower;
  let hostileUnits = 0;
  let attackerLabel = "unknown";

  if (tower.owner === "player") {
    const enemyPressure = data.incomingEnemyUnits;
    const neutralPressure = data.incomingNeutralUnits;
    hostileUnits = enemyPressure + neutralPressure;
    attackerLabel = enemyPressure >= neutralPressure ? "enemy pressure" : "neutral pressure";
  } else if (tower.owner === "enemy") {
    const playerPressure = data.incomingPlayerUnits;
    const neutralPressure = data.incomingNeutralUnits;
    hostileUnits = playerPressure + neutralPressure;
    attackerLabel = playerPressure >= neutralPressure ? "player pressure" : "neutral pressure";
  } else {
    const playerPressure = data.incomingPlayerUnits;
    const enemyPressure = data.incomingEnemyUnits;
    hostileUnits = Math.max(playerPressure, enemyPressure);
    attackerLabel = playerPressure >= enemyPressure ? "player pressure" : "enemy pressure";
  }

  const defendersBroken = tower.troops <= 0.001;
  const hpAboveZero = tower.hp > 0.001;
  const hasBreachDamage = hpAboveZero && tower.hp < tower.maxHp;

  if (defendersBroken && hpAboveZero && (hostileUnits > 0.001 || hasBreachDamage)) {
    return {
      statusLabel: `Breaching (${attackerLabel})`,
      ruleHint: "Control transfers only when HP reaches 0.",
    };
  }

  if (hostileUnits > 0.001) {
    return {
      statusLabel: `Contested (${attackerLabel})`,
      ruleHint: "Control transfers only when HP reaches 0.",
    };
  }

  return {
    statusLabel: "Stable",
    ruleHint: null,
  };
}

function resolveMechanicText(packet: UnitPacket): string | null {
  if (packet.shieldUptimeSec > 0) {
    return "Reduces incoming damage until broken";
  }
  if (packet.splitChildArchetypeId && packet.splitChildCount > 0) {
    return "Splits into smaller units on death";
  }
  if (packet.supportAuraRadiusPx > 0) {
    return "Buffs nearby enemies";
  }
  if (packet.isLinkCutter || packet.linkIntegrityDamagePerSec > 0) {
    return "Damages/interrupts links";
  }
  if (packet.canStopToShoot || packet.attackRangePx >= 90) {
    return "Attacks from distance";
  }
  if (packet.tags.includes("tank")) {
    return "High HP, slow";
  }
  if (packet.tags.includes("swarm")) {
    return "Many small units";
  }

  return null;
}

function normalizeTag(tag: string): string {
  return tag
    .replace(/_/g, " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function ownerText(owner: Tower["owner"]): string {
  if (owner === "player") {
    return "Owned";
  }
  if (owner === "enemy") {
    return "Enemy";
  }
  return "Neutral";
}

function getPacketWorldPosition(world: World, packet: UnitPacket): Vec2 | null {
  if (packet.hasWorldPosition) {
    return {
      x: packet.worldX,
      y: packet.worldY,
    };
  }

  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }

  return samplePointOnPolyline(link.points, packet.progress01);
}

function samplePointOnPolyline(points: Vec2[], progress01: number): Vec2 | null {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const clampedProgress = Math.max(0, Math.min(1, progress01));
  const totalLength = polylineLength(points);
  if (totalLength <= 0.001) {
    return points[0];
  }

  const targetDistance = clampedProgress * totalLength;
  let walkedDistance = 0;

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength <= 0.001) {
      continue;
    }

    if (walkedDistance + segmentLength >= targetDistance) {
      const t = (targetDistance - walkedDistance) / segmentLength;
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
    }

    walkedDistance += segmentLength;
  }

  return points[points.length - 1];
}

function polylineLength(points: Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}
