/*
 * Patch Notes (2026-02-24):
 * - Added campaign v2 build/validation script with map metrics reporting.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CampaignMapDefinition,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "../src/campaign/CampaignTypes.ts";
import { validateCampaignSpec } from "../src/campaign/CampaignValidator.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const campaignPath = path.join(ROOT, "data", "campaign", "campaign_v2.json");
const presetsPath = path.join(ROOT, "data", "waves", "presets.json");
const mapDir = path.join(ROOT, "levels", "v2");
const shouldGenerateMissing = process.argv.includes("--generate-missing");

const campaign = readJson<CampaignSpecV2>(campaignPath);
const presets = readJson<CampaignWavePresetCatalog>(presetsPath);
const mapById = new Map<string, CampaignMapDefinition>();

for (const stage of campaign.stages) {
  for (const level of stage.levels) {
    const mapPath = path.join(mapDir, `${level.mapId}.json`);
    if (!fs.existsSync(mapPath)) {
      if (shouldGenerateMissing) {
        const generated = generateFallbackMap(level.mapId, level.dynamic, stage.id, level.id);
        fs.mkdirSync(mapDir, { recursive: true });
        fs.writeFileSync(mapPath, JSON.stringify(generated, null, 2));
      } else {
        continue;
      }
    }
    mapById.set(level.mapId, readJson<CampaignMapDefinition>(mapPath));
  }
}

const validation = validateCampaignSpec(campaign, presets, mapById);
if (!validation.valid) {
  console.error("[campaign_v2] Validation failed:");
  for (const issue of validation.issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("[campaign_v2] Validation passed.");
}

console.log("\nCampaign Report");
console.log("==============");
for (const stage of campaign.stages) {
  console.log(`\n${stage.displayName} (${stage.id})`);
  for (const level of stage.levels) {
    const map = mapById.get(level.mapId);
    if (!map) {
      console.log(`- ${level.id}: map missing (${level.mapId})`);
      continue;
    }
    const metrics = computeMapMetrics(map);
    console.log(
      `- ${level.id} | dynamic=${level.dynamic} | nodes=${map.nodes.length} links=${map.links.length} avgDist=${metrics.avgLinkDistance.toFixed(2)} allowlist=[${level.archetypeAllowlist.join(", ")}]`,
    );
  }
}

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function computeMapMetrics(map: CampaignMapDefinition): { avgLinkDistance: number } {
  const byId = new Map<string, { x: number; y: number }>();
  for (const node of map.nodes) {
    byId.set(node.id, { x: node.x, y: node.y });
  }

  let total = 0;
  let count = 0;
  for (const link of map.links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) {
      continue;
    }
    total += Math.hypot(a.x - b.x, a.y - b.y);
    count += 1;
  }

  return {
    avgLinkDistance: count > 0 ? total / count : 0,
  };
}

function generateFallbackMap(
  mapId: string,
  dynamic: string,
  stageId: string,
  levelId: string,
): CampaignMapDefinition {
  const seed = hash(`${stageId}:${levelId}:${mapId}`);
  const rng = createRng(seed);
  const nodeCount = stageId === "training" ? 10 : 18;
  const width = stageId === "training" ? 28 : 36;
  const height = stageId === "training" ? 18 : 22;
  const nodes: CampaignMapDefinition["nodes"] = [
    { id: "p_start", x: 2, y: Math.floor(height / 2), owner: "player", tier: 2, cap: 120, regen: 3 },
    { id: "e_start", x: width - 3, y: Math.floor(height / 2), owner: "enemy", tier: 2, cap: 120, regen: 3 },
  ];

  for (let i = 0; i < nodeCount - 2; i += 1) {
    nodes.push({
      id: `n${i + 1}`,
      x: 4 + Math.floor(rng() * (width - 8)),
      y: 2 + Math.floor(rng() * (height - 4)),
      owner: "neutral",
      tier: 1,
      cap: 72,
      regen: 1.05,
    });
  }

  const links: CampaignMapDefinition["links"] = [];
  for (let i = 2; i < nodes.length; i += 1) {
    const previous = nodes[Math.max(0, i - 1)].id;
    links.push({ a: previous, b: nodes[i].id });
  }
  links.push({ a: "p_start", b: nodes[2]?.id ?? "e_start" });
  links.push({ a: nodes[nodes.length - 1]?.id ?? "p_start", b: "e_start" });

  return {
    id: mapId,
    size: { w: width, h: height },
    nodes,
    links,
    tags: {
      chokepoints: dynamic.includes("chokepoint") ? 0.7 : 0.35,
      linkDensity: stageId === "training" ? 1.1 : 0.9,
      lanes: dynamic.includes("multi_front") ? 2 : 1,
    },
  };
}

function hash(value: string): number {
  let state = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    state ^= value.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
