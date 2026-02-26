/*
 * Patch Notes (2026-02-24):
 * - Added campaign v2 mission metadata wiring (difficulty mapping, wave presets, archetype allowlists).
 * - Added tutorial hint runner integration with HUD toast delivery.
 */

import { Game, type MatchResult } from "./game/Game";
import {
  DIFFICULTY_TIER_IDS,
  DEFAULT_DIFFICULTY_TIER,
  type DifficultyTierId,
} from "./config/Difficulty";
import { loadLevel, type LoadedLevel } from "./game/LevelLoader";
import { InputController } from "./input/InputController";
import { buildRuntimeLevelFromLevel } from "./levels/adapter";
import { createRandomSeed, generateLevel, saveGeneratedLevel } from "./levels/generator";
import { findLevelById, findStageById, loadLevelRegistry } from "./levels/registry";
import type { LevelSizePreset, LevelSourceEntry, StageRegistryEntry } from "./levels/types";
import type { CampaignMissionRuntimeMeta } from "./campaign/CampaignTypes";
import { BALANCE_CONFIG } from "./meta/BalanceConfig";
import {
  computeBaseMetaModifiers,
  computeMetaAccountLevel,
  createRunUnlockSnapshot,
  deriveUnlockedSkillIds,
  evaluateUnlocks,
  getAscensionRewardMultipliers,
  getNextUpgradeCost,
  getPurchasedRank,
  getUpgradeNodes,
  loadMetaUpgradeCatalog,
  loadSkillCatalog,
  loadAscensionCatalog,
  loadUnlockCatalog,
  purchaseUpgrade,
  refreshUnlocks,
  validateUnlockCatalog,
  type AscensionCatalog,
  type MetaUpgradeCatalog,
} from "./meta/MetaProgression";
import { calculateMissionGloryReward, calculateRunBonusGlory, type MissionGloryReward } from "./meta/Rewards";
import { Renderer2D } from "./render/Renderer2D";
import { loadMissionCatalog, type MissionTemplate } from "./run/RunGeneration";
import {
  createDefaultMetaProfile,
  type MetaProfile,
  type MetaModifiers,
  type RunMissionNode,
  type RunState,
  type RunSummary,
} from "./save/Schema";
import {
  clearRunState,
  loadMetaProfile,
  loadRunState,
  resetMetaProfile,
  saveMetaProfile,
  saveRunState,
} from "./save/Storage";
import { applyTowerArchetypeModifiers, loadDepthContent } from "./sim/DepthConfig";
import { canCreateLink, getNeighbors, validateNonScriptedLinksAdjacency } from "./sim/LinkRules";
import { updateWorld as updateQuickSimWorld } from "./sim/Simulation";
import { World, type Owner } from "./sim/World";
import { TowerArchetype, type TowerArchetypeCatalog } from "./sim/DepthTypes";
import type { BalanceBaselinesConfig, DifficultyTierConfig } from "./waves/Definitions";
import { loadWaveContent } from "./waves/Definitions";
import { WaveDirector, type MissionWaveTelemetry } from "./waves/WaveDirector";
import { SkillManager } from "./game/SkillManager";
import {
  computeUnlocks,
  loadCampaignProgress,
  markMissionComplete,
  resetCampaignProgress,
  toMissionKey,
  type CampaignProgress,
  type CampaignUnlocks,
} from "./progression/progression";
import {
  createBadge,
  createButton,
  createCard,
  createDivider,
  createIconButton,
  createPanel,
  createScrollArea,
  createTabs,
} from "./components/ui/primitives";
import { debugUiStore, type DebugUiState } from "./ui/debugStore";
import { renderLevelGeneratorScreen } from "./ui/screens/LevelGeneratorScreen";
import { renderLevelSelectScreen } from "./ui/screens/LevelSelectScreen";
import { renderMissionSelectScreen } from "./ui/screens/MissionSelectScreen";
import { renderStageSelectScreen } from "./ui/screens/StageSelectScreen";
import { WorldTooltipOverlay } from "./ui/WorldTooltipOverlay";
import { GameplayHUD } from "./ui/hud/GameplayHUD";
import { buildHudViewModel } from "./ui/hud/buildHudViewModel";
import type { HudToastInput, TowerCapturePhase, TowerOverlayVM } from "./ui/hud/types";
import { TutorialHintRunner } from "./tutorial/TutorialHintRunner";
import {
  assertDifficultyContextDeterministic,
  buildDifficultyContext,
  type DifficultyContext,
  type DifficultyInputs,
} from "./difficulty/DifficultyContext";
import { generateDifficultyReport } from "./debug/DifficultyReport";

type Screen =
  | "title"
  | "main-menu"
  | "profile-snapshot"
  | "meta"
  | "run-map"
  | "run-summary"
  | "stage-select"
  | "level-select"
  | "mission-select"
  | "level-generator"
  | "mission";
type DebugTab = "run" | "sim" | "ui" | "dev";

interface CampaignMissionContext {
  mode: "campaign";
  stageId: string;
  levelId: string;
  missionId: string;
  missionName: string;
  objectiveText: string;
}

interface RunMissionContext {
  mode: "run";
}

type MissionContext = CampaignMissionContext | RunMissionContext | null;

interface MissionEventEntry {
  id: number;
  tone: "neutral" | "warning" | "success";
  message: string;
}

interface MissionHudSignals {
  waveIndex: number;
  waveActive: boolean;
  nextWaveBucket: number | null;
  objectiveMilestonePct: number;
  playerTowers: number;
  enemyTowers: number;
  clusterBonusActive: boolean;
  towerCapturePhaseById: Record<string, TowerCapturePhase>;
  towerOwnerById: Record<string, Owner>;
}

interface AppState {
  screen: Screen;
  metaProfile: MetaProfile;
  runState: RunState | null;
  runSummary: RunSummary | null;
  campaignStages: StageRegistryEntry[];
  campaignMissionMetaByKey: Record<string, CampaignMissionRuntimeMeta>;
  campaignProgress: CampaignProgress;
  campaignUnlocks: CampaignUnlocks;
  selectedStageId: string | null;
  selectedLevelId: string | null;
  levelGeneratorSizePreset: LevelSizePreset;
  levelGeneratorSeed: number;
  levelGeneratorDraft: LevelSourceEntry["level"] | null;
  activeMissionContext: MissionContext;
  game: Game | null;
  inputController: InputController | null;
  missionResult: MatchResult;
  missionReward: MissionGloryReward | null;
  balanceDiagnosticsEnabled: boolean;
  pendingAscensionIds: string[];
  debugTab: DebugTab;
  debugDangerZoneOpen: boolean;
  frameTimeMs: number;
  fps: number;
  missionPaused: boolean;
  missionSpeedMul: 1 | 2;
  missionEvents: MissionEventEntry[];
  missionEventSeq: number;
  missionHudSignals: MissionHudSignals;
  tutorialHintRunner: TutorialHintRunner | null;
  activeDifficultyContext: DifficultyContext | null;
  difficultyReportPreviewWaves: number;
  difficultyReportIncludeSamples: boolean;
  difficultyReportOutput: string;
  difficultyReportMissionIndex: number | null;
}

const DEBUG_TOOLS_ENABLED = true;
void bootstrap();

async function bootstrap(): Promise<void> {
  const canvas = getCanvas();
  const ctx = getContext(canvas);
  const renderer = new Renderer2D(canvas, ctx);
  const screenRoot = getScreenRoot();
  const debugPanel = getDebugPanel();
  const debugIndicator = getDebugIndicator();
  const levelCache = new Map<string, LoadedLevel>();
  let debugPanelInteractionUntilSec = 0;
  debugIndicator.onclick = () => {
    if (DEBUG_TOOLS_ENABLED) {
      debugUiStore.toggleDebugOpen();
    }
  };
  const markDebugPanelInteraction = (): void => {
    debugPanelInteractionUntilSec = performance.now() / 1000 + 0.8;
  };
  debugPanel.addEventListener("pointerdown", markDebugPanelInteraction, true);
  debugPanel.addEventListener("focusin", markDebugPanelInteraction, true);
  debugPanel.addEventListener("wheel", markDebugPanelInteraction, { passive: true });

  const resize = () => resizeCanvas(canvas, ctx);
  window.addEventListener("resize", resize);
  resize();

  const [missionTemplates, upgradeCatalog, skillCatalog, ascensionCatalog, unlockCatalog, waveContent, depthContent, levelRegistry] = await Promise.all([
    loadMissionCatalog(),
    loadMetaUpgradeCatalog(),
    loadSkillCatalog(),
    loadAscensionCatalog(),
    loadUnlockCatalog(),
    loadWaveContent(),
    loadDepthContent(),
    loadLevelRegistry(),
  ]);

  const knownNodeIds = new Set(getUpgradeNodes(upgradeCatalog).map((node) => node.id));
  validateUnlockCatalog(unlockCatalog, {
    towerTypes: new Set<string>(Object.values(TowerArchetype)),
    enemyTypes: new Set<string>(waveContent.enemyCatalog.archetypes.map((entry) => entry.id)),
    ascensionIds: new Set<string>(ascensionCatalog.ascensions.map((entry) => entry.id)),
    knownNodeIds,
  });

  const campaignProgress = loadCampaignProgress();

  const app: AppState = {
    screen: "title",
    metaProfile: loadMetaProfile(),
    runState: loadRunState(),
    runSummary: null,
    campaignStages: levelRegistry.stages,
    campaignMissionMetaByKey: levelRegistry.missionMetaByKey,
    campaignProgress,
    campaignUnlocks: computeUnlocks(levelRegistry.stages, campaignProgress),
    selectedStageId: null,
    selectedLevelId: null,
    levelGeneratorSizePreset: "medium",
    levelGeneratorSeed: createRandomSeed(),
    levelGeneratorDraft: null,
    activeMissionContext: null,
    game: null,
    inputController: null,
    missionResult: null,
    missionReward: null,
    balanceDiagnosticsEnabled: DEBUG_TOOLS_ENABLED,
    pendingAscensionIds: [],
    debugTab: "run",
    debugDangerZoneOpen: false,
    frameTimeMs: 0,
    fps: 0,
    missionPaused: false,
    missionSpeedMul: 1,
    missionEvents: [],
    missionEventSeq: 0,
    missionHudSignals: createDefaultMissionHudSignals(),
    tutorialHintRunner: null,
    activeDifficultyContext: null,
    difficultyReportPreviewWaves: 6,
    difficultyReportIncludeSamples: true,
    difficultyReportOutput: "",
    difficultyReportMissionIndex: null,
  };

  const initialUnlockEvaluation = evaluateUnlocks(
    app.metaProfile,
    unlockCatalog,
    ascensionCatalog,
    Object.values(TowerArchetype),
    waveContent.enemyCatalog.archetypes.map((entry) => entry.id),
  );
  app.pendingAscensionIds = app.pendingAscensionIds.filter((id) =>
    initialUnlockEvaluation.snapshot.ascensionIds.includes(id),
  );

  if (app.runState && !DIFFICULTY_TIER_IDS.includes(app.runState.runModifiers.tier)) {
    app.runState.runModifiers.tier = DEFAULT_DIFFICULTY_TIER;
    saveRunState(app.runState);
  }

  const gameplayHud = new GameplayHUD({
    canvas,
    onTogglePause: () => {
      setMissionPaused(!app.missionPaused);
    },
    onSetSpeed: (speed) => {
      app.missionSpeedMul = speed;
      render();
    },
    onToggleOverlayRegen: () => {
      debugUiStore.toggle("showOverlayRegenNumbers");
    },
    onToggleOverlayCapture: () => {
      debugUiStore.toggle("showOverlayCaptureRings");
    },
    onToggleOverlayCluster: () => {
      debugUiStore.toggle("showOverlayClusterHighlight");
    },
  });

  const enemyArchetypesById = new Map(
    waveContent.enemyCatalog.archetypes.map((archetype) => [archetype.id, archetype] as const),
  );
  const worldTooltipOverlay = new WorldTooltipOverlay({
    canvas,
    getWorld: () => app.game?.getWorld() ?? null,
    isMissionScreen: () => app.screen === "mission",
    isDraggingLink: () => app.inputController?.isDragging() ?? false,
    isTowerTooltipsEnabled: () => debugUiStore.getState().showTowerTooltips,
    isEnemyTooltipsEnabled: () => debugUiStore.getState().showEnemyTooltips,
    getBossTooltipState: () => app.game?.getBossTooltipTelemetry() ?? null,
    enemyArchetypesById,
  });
  worldTooltipOverlay.start();
  window.addEventListener(
    "beforeunload",
    () => {
      worldTooltipOverlay.dispose();
      gameplayHud.dispose();
    },
    { once: true },
  );

  const render = (): void => {
    const debugState = debugUiStore.getState();
    renderer.setShowGridLines(debugState.showGridLines);
    gameplayHud.setOverlayToggles({
      regenNumbers: debugState.showOverlayRegenNumbers,
      captureRings: debugState.showOverlayCaptureRings,
      clusterHighlight: debugState.showOverlayClusterHighlight,
    });
    renderCurrentScreen(
      app,
      screenRoot,
      upgradeCatalog,
      ascensionCatalog,
      missionTemplates,
      openMetaScreen,
      openMainMenu,
      openProfileSnapshot,
      openRunMap,
      startCurrentMission,
      restartCurrentMission,
      abandonRun,
      purchaseUpgradeById,
      toggleRunAscension,
      finalizeRun,
      closeSummaryToMenu,
      openStageSelect,
      openLevelSelect,
      openMissionSelect,
      openLevelGenerator,
      generateDraftLevel,
      saveDraftLevel,
      startCampaignMissionById,
      gameplayHud,
      debugState,
      setMissionPaused,
    );
    renderDebugPanel(
      debugPanel,
      app,
      addDebugGlory,
      resetMeta,
      resetCampaign,
      forceMissionWin,
      forceMissionLose,
      debugSpawnEnemy,
      debugStartWave,
      toggleBalanceDiagnostics,
      validateLinksDebug,
      runQuickSimDebug,
      () => {
        void copyDifficultyReportDebug();
      },
      setDifficultyReportMissionIndex,
      setDifficultyReportPreviewWaves,
      setDifficultyReportIncludeSamples,
    );
    syncDebugIndicator(debugIndicator, DEBUG_TOOLS_ENABLED, debugState);
  };

  debugUiStore.subscribe(() => {
    render();
  });

  const setMissionPaused = (paused: boolean): void => {
    if (app.screen !== "mission" || !app.game || !app.inputController || app.missionResult !== null) {
      app.missionPaused = false;
      return;
    }
    app.missionPaused = paused;
    app.inputController.setEnabled(!paused);
    render();
  };

  const refreshCampaignRegistry = async (): Promise<void> => {
    try {
      const registry = await loadLevelRegistry();
      app.campaignStages = registry.stages;
      app.campaignMissionMetaByKey = registry.missionMetaByKey;
      app.campaignUnlocks = computeUnlocks(app.campaignStages, app.campaignProgress);
    } catch (error) {
      console.error("Failed to refresh level registry", error);
      showToast(screenRoot, "Failed to load levels. Check JSON format.");
    }
  };

  const buildDifficultyContextChecked = (inputs: DifficultyInputs): DifficultyContext => {
    if (import.meta.env.DEV && !assertDifficultyContextDeterministic(inputs)) {
      console.warn(
        `[Difficulty] Context determinism assertion failed for mission=${inputs.missionId ?? "--"} stage=${inputs.stageId ?? "--"} index=${inputs.missionIndex}`,
        new Error().stack,
      );
    }
    return buildDifficultyContext(inputs);
  };

  const openMainMenu = (): void => {
    stopMission();
    app.screen = "main-menu";
    render();
  };

  const openProfileSnapshot = (): void => {
    stopMission();
    app.screen = "profile-snapshot";
    render();
  };

  const openStageSelect = (): void => {
    stopMission();
    app.selectedStageId = null;
    app.selectedLevelId = null;
    app.screen = "stage-select";
    render();
  };

  const openLevelSelect = (stageId: string): void => {
    stopMission();
    const stage = findStageById(app.campaignStages, stageId);
    if (!stage) {
      showToast(screenRoot, "Stage not found.");
      return;
    }
    const stageState = app.campaignUnlocks.stage[stageId];
    if (!stageState?.unlocked) {
      showToast(screenRoot, "Stage is locked.");
      return;
    }

    app.selectedStageId = stageId;
    app.selectedLevelId = null;
    app.screen = "level-select";
    render();
  };

  const openMissionSelect = (levelId: string): void => {
    stopMission();
    if (!app.selectedStageId) {
      showToast(screenRoot, "Select a stage first.");
      return;
    }
    const levelEntry = findLevelById(app.campaignStages, app.selectedStageId, levelId);
    if (!levelEntry) {
      showToast(screenRoot, "Level not found.");
      return;
    }
    const levelState = app.campaignUnlocks.level[`${app.selectedStageId}:${levelId}`];
    if (!levelState?.unlocked) {
      showToast(screenRoot, "Level is locked.");
      return;
    }

    app.selectedLevelId = levelId;
    app.screen = "mission-select";
    render();
  };

  const openLevelGenerator = (): void => {
    stopMission();
    if (!app.levelGeneratorDraft) {
      app.levelGeneratorSeed = createRandomSeed();
      app.levelGeneratorDraft = generateLevel({
        sizePreset: app.levelGeneratorSizePreset,
        seed: app.levelGeneratorSeed,
      });
    }
    app.screen = "level-generator";
    render();
  };

  const generateDraftLevel = (): void => {
    app.levelGeneratorSeed = createRandomSeed();
    app.levelGeneratorDraft = generateLevel({
      sizePreset: app.levelGeneratorSizePreset,
      seed: app.levelGeneratorSeed,
    });
    render();
  };

  const saveDraftLevel = async (): Promise<void> => {
    if (!app.levelGeneratorDraft) {
      return;
    }
    try {
      saveGeneratedLevel(app.levelGeneratorDraft);
      await refreshCampaignRegistry();
      showToast(screenRoot, "Level saved to localStorage and downloaded.");
      app.selectedStageId = "user";
    } catch (error) {
      console.error("Failed to save generated level", error);
      showToast(screenRoot, "Failed to save generated level.");
    }
    render();
  };

  const openMetaScreen = (): void => {
    stopMission();
    app.screen = "meta";
    render();
  };

  const openRunMap = (): void => {
    stopMission();
    if (!app.runState) {
      app.screen = "main-menu";
    } else if (app.runState.currentMissionIndex >= app.runState.missions.length) {
      finalizeRun(true);
      return;
    } else {
      app.screen = "run-map";
    }
    render();
  };

  const startCampaignMissionById = async (missionId: string): Promise<void> => {
    if (!app.selectedStageId || !app.selectedLevelId) {
      showToast(screenRoot, "Select a level first.");
      return;
    }

    const levelEntry = findLevelById(app.campaignStages, app.selectedStageId, app.selectedLevelId);
    if (!levelEntry) {
      showToast(screenRoot, "Level not found.");
      return;
    }

    const mission = levelEntry.level.missions.find((entry) => entry.missionId === missionId);
    if (!mission) {
      showToast(screenRoot, "Mission not found.");
      return;
    }

    const missionKey = toMissionKey(app.selectedStageId, app.selectedLevelId, missionId);
    const missionState = app.campaignUnlocks.mission[missionKey];
    if (!missionState?.unlocked) {
      showToast(screenRoot, "Mission is locked.");
      return;
    }
    const missionMeta = app.campaignMissionMetaByKey[missionKey] ?? null;

    try {
      stopMission();
      const difficultyTierConfig = waveContent.difficultyTiers.difficultyTiers[DEFAULT_DIFFICULTY_TIER];
      const baseBonuses = computeBaseMetaModifiers(app.metaProfile, upgradeCatalog, ascensionCatalog, []);
      const baseLevel = buildRuntimeLevelFromLevel(levelEntry.level, {
        viewport: {
          width: canvas.clientWidth || window.innerWidth,
          height: canvas.clientHeight || window.innerHeight,
        },
      });
      const missionIndex = Math.max(
        0,
        levelEntry.level.missions.findIndex((entry) => entry.missionId === mission.missionId),
      );
      const stageIdForDifficulty = missionMeta?.difficulty.stageId ?? app.selectedStageId;
      const difficultyContext = buildDifficultyContextChecked({
        missionId: mission.missionId,
        missionName: mission.name,
        missionDifficulty: mission.difficulty ?? 1,
        runDifficultyScalar: 1,
        tierId: DEFAULT_DIFFICULTY_TIER,
        tierConfig: difficultyTierConfig,
        baselines: waveContent.balanceBaselines,
        waveBalance: waveContent.balance,
        stageCatalog: waveContent.stageDifficulty,
        ascensionCatalog: waveContent.ascensionDifficulty,
        stageId: stageIdForDifficulty,
        stageIndex: deriveStageIndexFromValue(stageIdForDifficulty),
        missionIndex: missionMeta?.difficulty.missionIndex ?? missionIndex,
        presetId: missionMeta?.wavePlan.preset,
        waveCountOverride: missionMeta?.wavePlan.waves,
        bossEnabledOverride: missionMeta?.wavePlan.bossEnabled,
        firstAppearanceWaveOverride: missionMeta?.wavePlan.firstAppearanceWave,
        minibossWaveOverride: missionMeta?.wavePlan.minibossWave,
        ascensionLevel: 0,
        activeAscensionIds: [],
        activeWaveModifierIds: [],
        metaModifiers: baseBonuses,
        simulationBase: {
          sendRatePerSec: baseLevel.rules.sendRatePerSec,
          captureRateMultiplier: baseLevel.rules.captureRateMultiplier,
          playerCaptureEfficiencyMul: baseLevel.rules.playerCaptureEfficiencyMul,
          playerRegenMultiplier: baseLevel.rules.playerRegenMultiplier,
          enemyRegenMultiplier: baseLevel.rules.enemyRegenMultiplier,
          linkDecayPerSec: baseLevel.rules.linkDecayPerSec,
          linkDecayCanBreak: baseLevel.rules.linkDecayCanBreak,
        },
        runSeed: mission.seed,
        missionSeed: mission.seed,
      });
      const missionModifiers = difficultyContext.appliedMetaModifiers;
      const tunedLevel = createMissionLevel(
        baseLevel,
        difficultyContext,
        depthContent.towerArchetypes,
        waveContent.balanceBaselines,
        Object.values(TowerArchetype),
      );
      const world = new World(
        tunedLevel.towers,
        tunedLevel.rules.maxOutgoingLinksPerTower,
        depthContent.linkLevels,
        tunedLevel.initialLinks,
        missionModifiers.linkIntegrityMul,
        tunedLevel.graphEdges,
      );
      const waveDirector = new WaveDirector(world, waveContent, {
        runSeed: mission.seed,
        difficultyContext,
        balanceDiagnosticsEnabled: app.balanceDiagnosticsEnabled,
        allowedEnemyIds: missionMeta?.archetypeAllowlist,
      });

      const inputController = new InputController(canvas, world);
      const skillManager = new SkillManager(
        skillCatalog,
        deriveUnlockedSkillIds(app.metaProfile, upgradeCatalog),
        missionModifiers,
      );
      app.inputController = inputController;
      app.game = new Game(world, renderer, inputController, tunedLevel.rules, tunedLevel.ai, waveDirector, skillManager);
      app.missionResult = null;
      app.missionReward = null;
      app.missionPaused = false;
      app.missionSpeedMul = 1;
      app.activeDifficultyContext = difficultyContext;
      app.difficultyReportMissionIndex = null;
      app.activeMissionContext = {
        mode: "campaign",
        stageId: app.selectedStageId,
        levelId: app.selectedLevelId,
        missionId: mission.missionId,
        missionName: mission.name,
        objectiveText: mission.objectiveText,
      };
      app.tutorialHintRunner = missionMeta ? new TutorialHintRunner(missionMeta.hints) : null;
      resetMissionHudUiState(app);
      gameplayHud.reset();
      pushMissionEvent(
        app,
        "Mission deployed. Hold the network and watch incoming threat telemetry.",
        "neutral",
        (toast) => gameplayHud.pushToast(toast),
      );
      renderer.setMapRenderData(baseLevel.mapRenderData ?? null);
      app.screen = "mission";
      render();
    } catch (error) {
      console.error("Failed to start campaign mission", error);
      showToast(screenRoot, "Failed to start mission. Check console for details.");
    }
  };

  const startCurrentMission = async (): Promise<void> => {
    if (!app.runState) {
      return;
    }

    const mission = getCurrentMission(app.runState);
    if (!mission) {
      finalizeRun(true);
      return;
    }

    stopMission();
    const difficultyTierConfig = waveContent.difficultyTiers.difficultyTiers[app.runState.runModifiers.tier];
    const baseLevel = await getLevelByPath(mission.levelPath, levelCache);
    const stageIdForDifficulty = deriveStageIdFromLevelPath(mission.levelPath);
    const runSeed = app.runState.seed + app.runState.currentMissionIndex * 911;
    const difficultyContext = buildDifficultyContextChecked({
      missionId: mission.id,
      missionName: mission.name,
      missionDifficulty: mission.difficulty,
      runDifficultyScalar: app.runState.runModifiers.difficulty,
      tierId: app.runState.runModifiers.tier,
      tierConfig: difficultyTierConfig,
      baselines: waveContent.balanceBaselines,
      waveBalance: waveContent.balance,
      stageCatalog: waveContent.stageDifficulty,
      ascensionCatalog: waveContent.ascensionDifficulty,
      stageId: stageIdForDifficulty,
      stageIndex: deriveStageIndexFromValue(stageIdForDifficulty),
      missionIndex: app.runState.currentMissionIndex,
      ascensionLevel: app.runState.runAscensionIds.length,
      activeAscensionIds: app.runState.runAscensionIds,
      activeWaveModifierIds: [],
      metaModifiers: app.runState.startingBonuses,
      simulationBase: {
        sendRatePerSec: baseLevel.rules.sendRatePerSec,
        captureRateMultiplier: baseLevel.rules.captureRateMultiplier,
        playerCaptureEfficiencyMul: baseLevel.rules.playerCaptureEfficiencyMul,
        playerRegenMultiplier: baseLevel.rules.playerRegenMultiplier,
        enemyRegenMultiplier: baseLevel.rules.enemyRegenMultiplier,
        linkDecayPerSec: baseLevel.rules.linkDecayPerSec,
        linkDecayCanBreak: baseLevel.rules.linkDecayCanBreak,
      },
      runSeed,
    });
    const missionModifiers = difficultyContext.appliedMetaModifiers;
    const tunedLevel = createMissionLevel(
      baseLevel,
      difficultyContext,
      depthContent.towerArchetypes,
      waveContent.balanceBaselines,
      app.runState.runUnlockSnapshot.towerTypes,
    );
    const world = new World(
      tunedLevel.towers,
      tunedLevel.rules.maxOutgoingLinksPerTower,
      depthContent.linkLevels,
      tunedLevel.initialLinks,
      missionModifiers.linkIntegrityMul,
      tunedLevel.graphEdges,
    );
    const waveDirector = new WaveDirector(world, waveContent, {
      runSeed,
      difficultyContext,
      balanceDiagnosticsEnabled: app.balanceDiagnosticsEnabled,
      allowedEnemyIds:
        app.runState.runUnlockSnapshot.enemyTypes.length > 0
          ? app.runState.runUnlockSnapshot.enemyTypes
          : undefined,
    });

    const inputController = new InputController(canvas, world);
    const skillManager = new SkillManager(
      skillCatalog,
      deriveUnlockedSkillIds(app.metaProfile, upgradeCatalog),
      missionModifiers,
    );
    app.inputController = inputController;
    app.game = new Game(world, renderer, inputController, tunedLevel.rules, tunedLevel.ai, waveDirector, skillManager);
    app.missionResult = null;
    app.missionReward = null;
    app.missionPaused = false;
    app.missionSpeedMul = 1;
    app.activeDifficultyContext = difficultyContext;
    app.difficultyReportMissionIndex = app.runState.currentMissionIndex;
    app.activeMissionContext = { mode: "run" };
    resetMissionHudUiState(app);
    gameplayHud.reset();
    pushMissionEvent(
      app,
      "Run mission deployed. First assault expected shortly.",
      "neutral",
      (toast) => gameplayHud.pushToast(toast),
    );
    renderer.setMapRenderData(tunedLevel.mapRenderData ?? null);
    app.screen = "mission";
    saveRunState(app.runState);
    render();
  };

  const handleMissionResult = (): void => {
    if (!app.game || app.missionResult) {
      return;
    }

    const result = app.game.getMatchResult();
    if (!result) {
      return;
    }

    if (app.activeMissionContext?.mode === "campaign") {
      app.missionResult = result;
      app.missionReward = null;
      app.missionPaused = false;
      app.missionSpeedMul = 1;
      if (result === "win") {
        app.campaignProgress = markMissionComplete(
          app.activeMissionContext.stageId,
          app.activeMissionContext.levelId,
          app.activeMissionContext.missionId,
          app.campaignProgress,
        );
        app.campaignUnlocks = computeUnlocks(app.campaignStages, app.campaignProgress);
      }
      render();
      return;
    }

    if (!app.runState) {
      return;
    }

    const mission = getCurrentMission(app.runState);
    if (!mission) {
      return;
    }

    const missionReward = calculateMissionGloryReward(
      app.runState.currentMissionIndex,
      mission.difficulty * app.runState.runModifiers.difficulty,
      result === "win",
      app.runState.startingBonuses.rewardGloryMul,
      getDifficultyGloryMultiplier(
        waveContent.balanceBaselines,
        waveContent.difficultyTiers.difficultyTiers[app.runState.runModifiers.tier],
        app.runState.runModifiers.tier,
      ),
    );
    app.metaProfile.glory += missionReward.total;
    app.runState.runGloryEarned += missionReward.total;
    app.missionResult = result;
    app.missionReward = missionReward;
    app.missionPaused = false;
    app.missionSpeedMul = 1;

    if (result === "win") {
      app.runState.currentMissionIndex += 1;
    }

    saveMetaProfile(app.metaProfile);
    saveRunState(app.runState);
    render();
  };

  const finalizeRun = (won: boolean): void => {
    if (!app.runState) {
      openMainMenu();
      return;
    }

    stopMission();
    const runState = app.runState;
    const missionsCompleted = won
      ? runState.missions.length
      : Math.min(runState.currentMissionIndex, runState.missions.length);
    const tier = runState.runModifiers.tier;
    const tierConfig = waveContent.difficultyTiers.difficultyTiers[tier];
    const runBonusGlory = calculateRunBonusGlory(
      won,
      runState.startingBonuses.rewardGloryMul,
      getDifficultyGloryMultiplier(waveContent.balanceBaselines, tierConfig, tier),
    );
    app.metaProfile.glory += runBonusGlory;
    app.metaProfile.metaProgress.gloryEarnedTotal += runState.runGloryEarned + runBonusGlory;
    app.metaProfile.metaProgress.runsCompleted += 1;
    app.metaProfile.stats.bestMissionIndex = Math.max(
      app.metaProfile.stats.bestMissionIndex,
      missionsCompleted,
    );
    app.metaProfile.stats.bestWave = Math.max(app.metaProfile.stats.bestWave, missionsCompleted * 10);
    if (won) {
      app.metaProfile.stats.wins += 1;
      app.metaProfile.metaProgress.runsWon += 1;
      app.metaProfile.metaProgress.bossesDefeated += 1;
      app.metaProfile.metaProgress.highestDifficultyCleared = maxDifficultyTier(
        app.metaProfile.metaProgress.highestDifficultyCleared,
        tier,
      );
      for (const ascensionId of runState.runAscensionIds) {
        const previous = app.metaProfile.metaProgress.ascensionsCleared[ascensionId] ?? 0;
        app.metaProfile.metaProgress.ascensionsCleared[ascensionId] = previous + 1;
      }
    } else {
      app.metaProfile.stats.losses += 1;
    }
    const unlockResult = evaluateUnlocks(
      app.metaProfile,
      unlockCatalog,
      ascensionCatalog,
      Object.values(TowerArchetype),
      waveContent.enemyCatalog.archetypes.map((entry) => entry.id),
    );
    const unlockNotifications = unlockResult.newlyUnlockedMessages;
    saveMetaProfile(app.metaProfile);

    const ascensionRewards = getAscensionRewardMultipliers(runState.runAscensionIds, ascensionCatalog);
    app.runSummary = {
      runId: runState.runId,
      won,
      missionsCompleted,
      missionGlory: runState.runGloryEarned,
      runBonusGlory,
      totalGloryEarned: runState.runGloryEarned + runBonusGlory,
      difficultyTier: tier,
      ascensionIds: [...runState.runAscensionIds],
      rewardMultipliers: ascensionRewards,
      appliedDifficultyMultipliers: {
        enemyHpMul: tierConfig.enemy.hpMul,
        enemyDmgMul: tierConfig.enemy.dmgMul,
        enemySpeedMul: tierConfig.enemy.speedMul,
        waveIntensityMul: tierConfig.wave.intensityMul,
        economyGoldMul: tierConfig.economy.goldMul,
        economyGloryMul: getDifficultyGloryMultiplier(
          waveContent.balanceBaselines,
          tierConfig,
          tier,
        ),
      },
      unlockNotifications,
    };
    app.runState = null;
    clearRunState();
    app.screen = "run-summary";
    render();
  };

  const closeSummaryToMenu = (): void => {
    app.runSummary = null;
    openMainMenu();
  };

  const restartCurrentMission = (): void => {
    if (app.screen !== "mission") {
      return;
    }
    app.missionPaused = false;
    if (app.activeMissionContext?.mode === "campaign") {
      app.selectedStageId = app.activeMissionContext.stageId;
      app.selectedLevelId = app.activeMissionContext.levelId;
      void startCampaignMissionById(app.activeMissionContext.missionId);
      return;
    }
    if (app.runState) {
      void startCurrentMission();
    }
  };

  const purchaseUpgradeById = (upgradeId: string): void => {
    const result = purchaseUpgrade(app.metaProfile, upgradeCatalog, upgradeId);
    if (!result.ok) {
      render();
      return;
    }

    refreshUnlocks(
      app.metaProfile,
      unlockCatalog,
      ascensionCatalog,
      Object.values(TowerArchetype),
      waveContent.enemyCatalog.archetypes.map((entry) => entry.id),
    );
    const unlockSnapshot = createRunUnlockSnapshot(
      app.metaProfile,
      unlockCatalog,
      ascensionCatalog,
      Object.values(TowerArchetype),
      waveContent.enemyCatalog,
    );
    app.pendingAscensionIds = app.pendingAscensionIds.filter((id) => unlockSnapshot.ascensionIds.includes(id));
    saveMetaProfile(app.metaProfile);
    render();
  };

  const toggleRunAscension = (ascensionId: string, enabled: boolean): void => {
    if (!app.runState) {
      return;
    }
    if (!app.runState.runUnlockSnapshot.ascensionIds.includes(ascensionId)) {
      return;
    }

    const set = new Set(app.runState.runAscensionIds);
    if (enabled) {
      set.add(ascensionId);
    } else {
      set.delete(ascensionId);
    }

    const nextIds = [...set].sort((a, b) => a.localeCompare(b)).slice(0, ascensionCatalog.maxSelected);
    app.runState.runAscensionIds = nextIds;
    app.runState.startingBonuses = computeBaseMetaModifiers(
      app.metaProfile,
      upgradeCatalog,
      ascensionCatalog,
      nextIds,
    );
    saveRunState(app.runState);
    render();
  };

  const abandonRun = (): void => {
    stopMission();
    app.runState = null;
    app.missionReward = null;
    app.missionResult = null;
    clearRunState();
    app.screen = "main-menu";
    render();
  };

  const addDebugGlory = (): void => {
    app.metaProfile.glory += 250;
    saveMetaProfile(app.metaProfile);
    render();
  };

  const resetMeta = (): void => {
    app.metaProfile = resetMetaProfile();
    app.runSummary = null;
    render();
  };

  const resetCampaign = (): void => {
    app.campaignProgress = resetCampaignProgress();
    app.campaignUnlocks = computeUnlocks(app.campaignStages, app.campaignProgress);
    render();
  };

  const forceMissionWin = (): void => {
    if (app.game && !app.missionResult) {
      app.game.debugForceResult("win");
    }
  };

  const forceMissionLose = (): void => {
    if (app.game && !app.missionResult) {
      app.game.debugForceResult("lose");
    }
  };

  const debugSpawnEnemy = (enemyId: string, elite: boolean): void => {
    if (app.game && app.screen === "mission" && app.missionResult === null) {
      app.game.debugSpawnEnemy(enemyId, elite);
    }
  };

  const debugStartWave = (waveIndex: number): void => {
    if (app.game && app.screen === "mission" && app.missionResult === null) {
      app.game.debugStartWave(waveIndex);
    }
  };

  const toggleBalanceDiagnostics = (): void => {
    app.balanceDiagnosticsEnabled = !app.balanceDiagnosticsEnabled;
    if (app.game) {
      app.game.setBalanceDiagnosticsEnabled(app.balanceDiagnosticsEnabled);
    }
    render();
  };

  const validateLinksDebug = (): void => {
    if (!app.game) {
      return;
    }

    const result = validateNonScriptedLinksAdjacency(app.game.getWorld());
    if (result.ok) {
      gameplayHud.pushToast({
        type: "success",
        title: "Link Validation",
        body: "All active links connect adjacent towers.",
        ttl: 1800,
      });
      return;
    }

    const sample = result.invalidLinkIds.slice(0, 3).join(", ");
    gameplayHud.pushToast({
      type: "danger",
      title: "Link Validation Failed",
      body:
        result.invalidLinkIds.length > 0
          ? `${result.invalidLinkIds.length} non-adjacent link(s): ${sample}`
          : "Found non-adjacent links.",
      ttl: 3200,
    });
    console.error("[LinkRules] Invalid runtime links", result.invalidLinkIds);
  };

  const runQuickSimDebug = (): void => {
    void runQuickSim(24);
  };

  const setDifficultyReportPreviewWaves = (value: number): void => {
    app.difficultyReportPreviewWaves = clampInt(value, 1, 24);
    render();
  };

  const setDifficultyReportIncludeSamples = (enabled: boolean): void => {
    app.difficultyReportIncludeSamples = enabled;
    render();
  };

  const setDifficultyReportMissionIndex = (value: number | null): void => {
    app.difficultyReportMissionIndex = value;
    render();
  };

  const copyDifficultyReportDebug = async (): Promise<void> => {
    let snapshot = app.game?.getDifficultyDebugSnapshot(app.difficultyReportPreviewWaves) ?? null;

    if (app.runState) {
      const missionIndex = clampInt(
        app.difficultyReportMissionIndex ?? app.runState.currentMissionIndex,
        0,
        Math.max(0, app.runState.missions.length - 1),
      );
      const mission = app.runState.missions[missionIndex];
      if (mission) {
        const tierId = app.runState.runModifiers.tier;
        const tierConfig = waveContent.difficultyTiers.difficultyTiers[tierId];
        const baseLevel = await getLevelByPath(mission.levelPath, levelCache);
        const stageIdForDifficulty = deriveStageIdFromLevelPath(mission.levelPath);
        const runSeed = app.runState.seed + missionIndex * 911;
        const difficultyContext = buildDifficultyContextChecked({
          missionId: mission.id,
          missionName: mission.name,
          missionDifficulty: mission.difficulty,
          runDifficultyScalar: app.runState.runModifiers.difficulty,
          tierId,
          tierConfig,
          baselines: waveContent.balanceBaselines,
          waveBalance: waveContent.balance,
          stageCatalog: waveContent.stageDifficulty,
          ascensionCatalog: waveContent.ascensionDifficulty,
          stageId: stageIdForDifficulty,
          stageIndex: deriveStageIndexFromValue(stageIdForDifficulty),
          missionIndex,
          ascensionLevel: app.runState.runAscensionIds.length,
          activeAscensionIds: app.runState.runAscensionIds,
          activeWaveModifierIds: [],
          metaModifiers: app.runState.startingBonuses,
          simulationBase: {
            sendRatePerSec: baseLevel.rules.sendRatePerSec,
            captureRateMultiplier: baseLevel.rules.captureRateMultiplier,
            playerCaptureEfficiencyMul: baseLevel.rules.playerCaptureEfficiencyMul,
            playerRegenMultiplier: baseLevel.rules.playerRegenMultiplier,
            enemyRegenMultiplier: baseLevel.rules.enemyRegenMultiplier,
            linkDecayPerSec: baseLevel.rules.linkDecayPerSec,
            linkDecayCanBreak: baseLevel.rules.linkDecayCanBreak,
          },
          runSeed,
        });
        const missionModifiers = difficultyContext.appliedMetaModifiers;
        const level = createMissionLevel(
          baseLevel,
          difficultyContext,
          depthContent.towerArchetypes,
          waveContent.balanceBaselines,
          app.runState.runUnlockSnapshot.towerTypes,
        );
        const world = new World(
          level.towers,
          level.rules.maxOutgoingLinksPerTower,
          depthContent.linkLevels,
          level.initialLinks,
          missionModifiers.linkIntegrityMul,
          level.graphEdges,
        );
        const waveDirector = new WaveDirector(world, waveContent, {
          runSeed,
          difficultyContext,
          balanceDiagnosticsEnabled: false,
          allowedEnemyIds:
            app.runState.runUnlockSnapshot.enemyTypes.length > 0
              ? app.runState.runUnlockSnapshot.enemyTypes
              : undefined,
        });
        snapshot = waveDirector.getDifficultyDebugSnapshot(app.difficultyReportPreviewWaves);
      }
    }

    if (!snapshot) {
      app.difficultyReportOutput = "No mission difficulty snapshot available.";
      render();
      return;
    }

    const report = generateDifficultyReport({
      snapshot,
      content: waveContent,
      previewWaves: app.difficultyReportPreviewWaves,
      includeUnitSamples: app.difficultyReportIncludeSamples,
    });

    app.difficultyReportOutput = report;
    console.info(report);

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(report);
      } catch {
        // Fallback textarea remains visible in debug panel.
      }
    }

    render();
  };

  const castSkillByHotkey = (key: string): boolean => {
    if (app.screen !== "mission" || !app.game || app.missionResult !== null || app.missionPaused) {
      return false;
    }

    const index = Number.parseInt(key, 10);
    if (!Number.isFinite(index) || index < 1 || index > 9) {
      return false;
    }

    const skill = app.game.getSkillHudState()[index - 1];
    if (!skill) {
      return false;
    }

    if (!skill.ready) {
      gameplayHud.pushToast({
        type: "info",
        title: `${skill.name} Cooling Down`,
        body: `${skill.cooldownRemainingSec.toFixed(1)}s remaining.`,
        ttl: 1500,
      });
      return true;
    }

    const targetTowerId =
      skill.targeting === "NONE"
        ? undefined
        : app.inputController?.getSelectedTowerId() ?? undefined;
    if (skill.targeting !== "NONE" && !targetTowerId) {
      gameplayHud.pushToast({
        type: "warning",
        title: "No Target Tower",
        body: "Select a player tower before casting this skill.",
        ttl: 1700,
      });
      return true;
    }

    const casted = app.game.castSkill(skill.id, targetTowerId);
    if (!casted) {
      gameplayHud.pushToast({
        type: "danger",
        title: "Skill Cast Failed",
        body: "Command was not accepted by the skill manager.",
        ttl: 1700,
      });
    }
    return true;
  };

  const runQuickSim = async (runCount: number): Promise<void> => {
    if (!app.runState) {
      return;
    }
    const mission = getCurrentMission(app.runState);
    if (!mission) {
      return;
    }

    const tierId = app.runState.runModifiers.tier;
    const tierConfig = waveContent.difficultyTiers.difficultyTiers[tierId];
    const fixedSeedBase = 13371337;
    const maxWaves = waveContent.balance.totalWaveCount;
    const towersOwnedCurveTotals = new Array<number>(maxWaves).fill(0);
    const gloryCurveTotals = new Array<number>(maxWaves).fill(0);

    let wins = 0;
    let totalWaveDurationSec = 0;
    let completedRuns = 0;

    const baseLevel = await getLevelByPath(mission.levelPath, levelCache);
    const stageIdForDifficulty = deriveStageIdFromLevelPath(mission.levelPath);
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const runSeed = fixedSeedBase + runIndex * 101;
      const difficultyContext = buildDifficultyContextChecked({
        missionId: mission.id,
        missionName: mission.name,
        missionDifficulty: mission.difficulty,
        runDifficultyScalar: app.runState.runModifiers.difficulty,
        tierId,
        tierConfig,
        baselines: waveContent.balanceBaselines,
        waveBalance: waveContent.balance,
        stageCatalog: waveContent.stageDifficulty,
        ascensionCatalog: waveContent.ascensionDifficulty,
        stageId: stageIdForDifficulty,
        stageIndex: deriveStageIndexFromValue(stageIdForDifficulty),
        missionIndex: app.runState.currentMissionIndex,
        ascensionLevel: app.runState.runAscensionIds.length,
        activeAscensionIds: app.runState.runAscensionIds,
        activeWaveModifierIds: [],
        metaModifiers: app.runState.startingBonuses,
        simulationBase: {
          sendRatePerSec: baseLevel.rules.sendRatePerSec,
          captureRateMultiplier: baseLevel.rules.captureRateMultiplier,
          playerCaptureEfficiencyMul: baseLevel.rules.playerCaptureEfficiencyMul,
          playerRegenMultiplier: baseLevel.rules.playerRegenMultiplier,
          enemyRegenMultiplier: baseLevel.rules.enemyRegenMultiplier,
          linkDecayPerSec: baseLevel.rules.linkDecayPerSec,
          linkDecayCanBreak: baseLevel.rules.linkDecayCanBreak,
        },
        runSeed,
      });
      const quickSimModifiers = difficultyContext.appliedMetaModifiers;
      const level = createMissionLevel(
        baseLevel,
        difficultyContext,
        depthContent.towerArchetypes,
        waveContent.balanceBaselines,
        app.runState.runUnlockSnapshot.towerTypes,
      );
      const world = new World(
        level.towers,
        level.rules.maxOutgoingLinksPerTower,
        depthContent.linkLevels,
        level.initialLinks,
        quickSimModifiers.linkIntegrityMul,
        level.graphEdges,
      );
      const waveDirector = new WaveDirector(world, waveContent, {
        runSeed,
        difficultyContext,
        balanceDiagnosticsEnabled: false,
        allowedEnemyIds:
          app.runState.runUnlockSnapshot.enemyTypes.length > 0
            ? app.runState.runUnlockSnapshot.enemyTypes
            : undefined,
      });

      let aiAccumulatorSec = 0;
      let simSec = 0;
      let result: MatchResult = null;
      let lastRecordedWave = 0;
      const stepSec = 1 / 30;

      while (simSec < 900 && result === null) {
        waveDirector.updatePreStep(stepSec);
        updateQuickSimWorld(world, stepSec, level.rules);
        waveDirector.updatePostStep(stepSec);
        world.drainTowerCapturedEvents();

        aiAccumulatorSec += stepSec;
        if (level.ai.aiThinkIntervalSec <= 0) {
          runQuickSimAiDecision(world, level.ai.aiMinTroopsToAttack);
        } else {
          while (aiAccumulatorSec >= level.ai.aiThinkIntervalSec) {
            aiAccumulatorSec -= level.ai.aiThinkIntervalSec;
            runQuickSimAiDecision(world, level.ai.aiMinTroopsToAttack);
          }
        }

        const telemetry = waveDirector.getTelemetry();
        const currentWave = telemetry.currentWaveIndex;
        if (currentWave > lastRecordedWave) {
          const waveSlot = Math.max(0, Math.min(maxWaves - 1, currentWave - 1));
          const owned = countPlayerTowers(world);
          towersOwnedCurveTotals[waveSlot] += owned;
          gloryCurveTotals[waveSlot] +=
            telemetry.missionGold *
            getDifficultyGloryMultiplier(waveContent.balanceBaselines, tierConfig, tierId);
          lastRecordedWave = currentWave;
        }

        result = evaluateQuickSimResult(world, waveDirector);
        simSec += stepSec;
      }

      if (result === "win") {
        wins += 1;
      }
      totalWaveDurationSec += simSec;
      completedRuns += 1;
    }

    const divisor = Math.max(1, completedRuns);
    const summary = {
      difficultyTier: tierId,
      runCount: completedRuns,
      seedBase: fixedSeedBase,
      winRate: wins / divisor,
      averageWaveDurationSec: totalWaveDurationSec / divisor,
      towersOwnedCurve: towersOwnedCurveTotals.map((value) => value / divisor),
      gloryEarnedCurve: gloryCurveTotals.map((value) => value / divisor),
    };

    (window as unknown as { __towerBattleQuickSim?: unknown }).__towerBattleQuickSim = summary;
    console.log("[QuickSim] Summary", summary);
  };

  const stopMission = (): void => {
    app.inputController?.dispose();
    app.inputController = null;
    app.game = null;
    app.activeMissionContext = null;
    app.activeDifficultyContext = null;
    app.difficultyReportMissionIndex = null;
    app.missionResult = null;
    app.missionReward = null;
    app.missionPaused = false;
    app.missionSpeedMul = 1;
    app.tutorialHintRunner = null;
    resetMissionHudUiState(app);
    gameplayHud.reset();
    renderer.setMapRenderData(null);
    renderer.clear();
  };

  window.addEventListener("keydown", (event) => {
    const isTyping = isTypingTarget(event.target);
    const key = event.key;

    if (DEBUG_TOOLS_ENABLED && (key === "d" || key === "D") && !isTyping && !event.repeat) {
      debugUiStore.toggleDebugOpen();
      event.preventDefault();
      return;
    }

    if (key === "Escape") {
      if (debugUiStore.getState().debugOpen) {
        debugUiStore.setState({ debugOpen: false });
        event.preventDefault();
        return;
      }
      if (
        !isTyping &&
        app.screen === "mission" &&
        app.game &&
        app.missionResult === null &&
        !(app.inputController?.isDragging() ?? false)
      ) {
        setMissionPaused(!app.missionPaused);
        event.preventDefault();
        return;
      }
      if (!isTyping && triggerHotkeyButton("escape", screenRoot)) {
        event.preventDefault();
        return;
      }
    }

    if (!isTyping && app.screen === "mission" && app.game && app.missionResult === null && (key === "p" || key === "P")) {
      setMissionPaused(!app.missionPaused);
      event.preventDefault();
      return;
    }

    if ((key === "Enter" || key === "NumpadEnter") && !isTyping) {
      if (triggerHotkeyButton("enter", screenRoot)) {
        event.preventDefault();
        return;
      }
    }

    if (!isTyping && castSkillByHotkey(key)) {
      event.preventDefault();
      return;
    }

    if ((key === "r" || key === "R") && !isTyping) {
      restartCurrentMission();
    }

    if (!DEBUG_TOOLS_ENABLED || isTyping) {
      return;
    }
    if (key === "g" || key === "G") {
      addDebugGlory();
    }
    if (key === "1") {
      forceMissionWin();
    }
    if (key === "2") {
      forceMissionLose();
    }
  });

  render();

  let lastTimeSec = performance.now() / 1000;
  let uiSyncAccumulatorSec = 0;
  const loop = (timeMs: number): void => {
    const nowSec = timeMs / 1000;
    const dtSec = nowSec - lastTimeSec;
    lastTimeSec = nowSec;
    const clampedDtSec = Math.max(0.0001, dtSec);
    app.frameTimeMs = app.frameTimeMs <= 0
      ? clampedDtSec * 1000
      : app.frameTimeMs * 0.9 + clampedDtSec * 1000 * 0.1;
    app.fps = app.fps <= 0
      ? 1 / clampedDtSec
      : app.fps * 0.85 + (1 / clampedDtSec) * 0.15;

    if (app.game && !app.missionPaused && app.missionResult === null) {
      app.game.frame(dtSec * app.missionSpeedMul);
      handleMissionResult();
    }

    uiSyncAccumulatorSec += dtSec;
    if (uiSyncAccumulatorSec >= 0.1) {
      uiSyncAccumulatorSec = 0;
      syncMissionHud(app, debugUiStore.getState(), gameplayHud);
      if (
        debugUiStore.getState().debugOpen
        && (app.debugTab === "run" || app.debugTab === "sim")
        && nowSec >= debugPanelInteractionUntilSec
      ) {
        renderDebugPanel(
          debugPanel,
          app,
          addDebugGlory,
          resetMeta,
          resetCampaign,
          forceMissionWin,
          forceMissionLose,
          debugSpawnEnemy,
          debugStartWave,
          toggleBalanceDiagnostics,
          validateLinksDebug,
          runQuickSimDebug,
          () => {
            void copyDifficultyReportDebug();
          },
          setDifficultyReportMissionIndex,
          setDifficultyReportPreviewWaves,
          setDifficultyReportIncludeSamples,
        );
      }
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function renderCurrentScreen(
  app: AppState,
  screenRoot: HTMLDivElement,
  upgradeCatalog: MetaUpgradeCatalog,
  ascensionCatalog: AscensionCatalog,
  missionTemplates: MissionTemplate[],
  openMetaScreen: () => void,
  openMainMenu: () => void,
  openProfileSnapshot: () => void,
  openRunMap: () => void,
  startCurrentMission: () => Promise<void>,
  restartCurrentMission: () => void,
  abandonRun: () => void,
  purchaseUpgradeById: (upgradeId: string) => void,
  toggleRunAscension: (ascensionId: string, enabled: boolean) => void,
  finalizeRun: (won: boolean) => void,
  closeSummaryToMenu: () => void,
  openStageSelect: () => void,
  openLevelSelect: (stageId: string) => void,
  openMissionSelect: (levelId: string) => void,
  openLevelGenerator: () => void,
  generateDraftLevel: () => void,
  saveDraftLevel: () => Promise<void>,
  startCampaignMissionById: (missionId: string) => Promise<void>,
  gameplayHud: GameplayHUD,
  debugState: DebugUiState,
  setMissionPaused: (paused: boolean) => void,
): void {
  screenRoot.replaceChildren();

  if (app.screen === "title") {
    const wrapper = document.createElement("div");
    wrapper.className = "centered splash-centered";

    const shell = document.createElement("section");
    shell.className = "splash-shell";
    shell.onclick = () => {
      openMainMenu();
    };

    const hero = document.createElement("div");
    hero.className = "splash-hero";

    const emblemWrap = document.createElement("div");
    emblemWrap.className = "splash-emblem-wrap";
    const emblemGlow = document.createElement("div");
    emblemGlow.className = "splash-emblem-glow";
    const emblem = document.createElement("div");
    emblem.className = "splash-emblem";
    const icon = document.createElement("div");
    icon.className = "splash-icon";
    const topBar = document.createElement("div");
    topBar.className = "splash-icon-top";
    const body = document.createElement("div");
    body.className = "splash-icon-body";
    const bodyEye = document.createElement("div");
    bodyEye.className = "splash-icon-eye";
    const bodySlot = document.createElement("div");
    bodySlot.className = "splash-icon-slot";
    body.append(bodyEye, bodySlot);
    const bottomBar = document.createElement("div");
    bottomBar.className = "splash-icon-bottom";
    icon.append(topBar, body, bottomBar);
    emblem.appendChild(icon);
    emblemWrap.append(emblemGlow, emblem);

    const titleWrap = document.createElement("div");
    titleWrap.className = "splash-title-wrap";
    const title = document.createElement("h1");
    title.className = "splash-title";
    title.innerHTML = "<span>Grid</span>Defense";
    const subtitle = document.createElement("p");
    subtitle.className = "splash-subtitle";
    subtitle.textContent = "Strategic Tactical Response";
    const summary = document.createElement("p");
    summary.className = "splash-summary";
    summary.textContent = "Command linked towers. Hold lanes. Break the siege.";
    titleWrap.append(title, subtitle, summary);

    hero.append(emblemWrap, titleWrap);

    const footer = document.createElement("div");
    footer.className = "splash-footer";

    const cta = document.createElement("div");
    cta.className = "splash-cta";
    const ctaText = document.createElement("p");
    ctaText.className = "splash-cta-text";
    ctaText.textContent = "Tap screen to begin";
    const ctaDot = document.createElement("div");
    ctaDot.className = "splash-cta-dot";
    cta.append(ctaText, ctaDot);

    const startBtn = createButton("Press Enter", openMainMenu, { variant: "ghost", hotkey: "Enter" });
    startBtn.classList.add("splash-start-btn");
    startBtn.onclick = (event) => {
      event.stopPropagation();
      openMainMenu();
    };

    const homeIndicator = document.createElement("div");
    homeIndicator.className = "splash-home-indicator";

    footer.append(cta, startBtn, homeIndicator);
    shell.append(hero, footer);
    wrapper.appendChild(shell);
    screenRoot.appendChild(wrapper);
    return;
  }

  if (app.screen === "main-menu") {
    const panel = document.createElement("div");
    panel.className = "panel ui-panel menu-panel campaign-main-menu";

    const topBar = document.createElement("div");
    topBar.className = "campaign-topbar";
    const badge = document.createElement("div");
    badge.className = "campaign-topbar-badge";
    badge.textContent = "TB";
    const title = document.createElement("p");
    title.className = "campaign-topbar-title";
    title.textContent = "Command Interface";
    topBar.append(badge, title);
    panel.appendChild(topBar);

    const hero = document.createElement("div");
    hero.className = "campaign-main-hero";
    const overline = document.createElement("p");
    overline.className = "campaign-overline";
    overline.textContent = "Main Menu";
    const heading = document.createElement("h2");
    heading.className = "campaign-main-heading";
    heading.innerHTML = `GRID <span>DEFENDER</span>`;
    const subtitle = document.createElement("p");
    subtitle.className = "campaign-main-subtitle";
    subtitle.textContent =
      "Launch campaign operations, review profile progress, or generate new battlefields.";
    hero.append(overline, heading, subtitle);
    panel.appendChild(hero);

    const actionCard = document.createElement("div");
    actionCard.className = "campaign-main-actions";
    const campaignBtn = createButton("Play Campaign", openStageSelect, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    campaignBtn.classList.add("campaign-main-action");
    actionCard.appendChild(campaignBtn);

    const profileBtn = createButton("Profile Snapshot", openProfileSnapshot, { variant: "secondary" });
    profileBtn.classList.add("campaign-main-action");
    actionCard.appendChild(profileBtn);

    const generatorBtn = createButton("Level Generator", openLevelGenerator, { variant: "secondary" });
    generatorBtn.classList.add("campaign-main-action");
    actionCard.appendChild(generatorBtn);

    const metaBtn = createButton("Meta Progression", openMetaScreen, { variant: "secondary" });
    metaBtn.classList.add("campaign-main-action");
    actionCard.appendChild(metaBtn);
    panel.appendChild(actionCard);

    const quickStats = document.createElement("div");
    quickStats.className = "campaign-main-stats";
    quickStats.append(
      createInfoPill("Gold", `${app.metaProfile.glory}`),
      createInfoPill("Meta Lv", `${computeMetaAccountLevel(app.metaProfile)}`),
      createInfoPill("Stages", `${app.campaignStages.length}`),
    );
    panel.appendChild(quickStats);

    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "profile-snapshot") {
    const panel = document.createElement("div");
    panel.className = "panel ui-panel menu-panel campaign-shell campaign-profile-shell";
    panel.appendChild(createCampaignScreenHeader("Profile Snapshot", "Commander Record"));

    const unlockedStages = app.campaignStages.filter((stage) => app.campaignUnlocks.stage[stage.stageId]?.unlocked).length;
    const completedStages = app.campaignStages.filter((stage) => app.campaignUnlocks.stage[stage.stageId]?.completed).length;
    const totalMissions = app.campaignStages.reduce(
      (sum, stage) => sum + stage.levels.reduce((levelSum, entry) => levelSum + entry.level.missions.length, 0),
      0,
    );
    const completedMissions = app.campaignProgress.completedMissionKeys.length;
    const missionPercent = totalMissions > 0 ? Math.round((completedMissions / totalMissions) * 100) : 0;
    panel.appendChild(
      createCampaignProgressCard({
        title: "Campaign Progress",
        subtitle: "Track your account and mission completion at a glance.",
        value: `${completedMissions}/${totalMissions}`,
        label: "Missions Cleared",
        percent: missionPercent,
      }),
    );

    const accountCard = document.createElement("section");
    accountCard.className = "campaign-profile-card";
    accountCard.append(
      createInfoPill("Current Gold", `${app.metaProfile.glory}`),
      createInfoPill("Meta Level", `${computeMetaAccountLevel(app.metaProfile)}`),
      createInfoPill("Runs Completed", `${app.metaProfile.metaProgress.runsCompleted}`),
      createInfoPill("Runs Won", `${app.metaProfile.metaProgress.runsWon}`),
      createInfoPill("Gold Spent", `${Math.round(app.metaProfile.metaProgress.glorySpentTotal)}`),
      createInfoPill("Stages Unlocked", `${unlockedStages}/${app.campaignStages.length}`),
      createInfoPill("Stages Completed", `${completedStages}/${app.campaignStages.length}`),
      createInfoPill("Templates Loaded", `${missionTemplates.length}`),
    );
    panel.appendChild(accountCard);

    const campaignNote = document.createElement("section");
    campaignNote.className = "campaign-progress-card";
    const noteTitle = document.createElement("p");
    noteTitle.className = "campaign-progress-title";
    noteTitle.textContent = "Current Operation";
    const noteText = document.createElement("p");
    noteText.className = "campaign-progress-subtitle";
    if (app.runState) {
      noteText.textContent = `Run in progress: Mission ${app.runState.currentMissionIndex + 1}/${app.runState.missions.length}.`;
    } else {
      noteText.textContent = "No active run. Start from campaign screens when ready.";
    }
    campaignNote.append(noteTitle, noteText);
    panel.appendChild(campaignNote);

    const footer = document.createElement("div");
    footer.className = "menu-footer campaign-footer";
    const backBtn = createButton("Back to Main Menu", openMainMenu, {
      variant: "ghost",
      escapeAction: true,
      hotkey: "Esc",
    });
    backBtn.classList.add("campaign-footer-btn");
    footer.appendChild(backBtn);
    panel.appendChild(footer);
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "stage-select") {
    const panel = renderStageSelectScreen({
      stages: app.campaignStages,
      unlocks: app.campaignUnlocks,
      onSelectStage: openLevelSelect,
      onBack: openMainMenu,
      onOpenGenerator: openLevelGenerator,
    });
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "level-select") {
    if (!app.selectedStageId) {
      openStageSelect();
      return;
    }
    const stage = findStageById(app.campaignStages, app.selectedStageId);
    if (!stage) {
      openStageSelect();
      return;
    }
    const panel = renderLevelSelectScreen({
      stage,
      unlocks: app.campaignUnlocks,
      onSelectLevel: openMissionSelect,
      onBack: openStageSelect,
    });
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "mission-select") {
    if (!app.selectedStageId || !app.selectedLevelId) {
      openStageSelect();
      return;
    }
    const levelEntry = findLevelById(app.campaignStages, app.selectedStageId, app.selectedLevelId);
    if (!levelEntry) {
      openLevelSelect(app.selectedStageId);
      return;
    }
    const panel = renderMissionSelectScreen({
      stageId: app.selectedStageId,
      levelEntry,
      unlocks: app.campaignUnlocks,
      onStartMission: (missionId) => {
        void startCampaignMissionById(missionId);
      },
      onBack: () => openLevelSelect(app.selectedStageId!),
    });
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "level-generator") {
    if (!app.levelGeneratorDraft) {
      app.levelGeneratorDraft = generateLevel({
        sizePreset: app.levelGeneratorSizePreset,
        seed: app.levelGeneratorSeed,
      });
    }
    const panel = renderLevelGeneratorScreen({
      level: app.levelGeneratorDraft,
      seed: app.levelGeneratorSeed,
      sizePreset: app.levelGeneratorSizePreset,
      onSizePresetChange: (size) => {
        app.levelGeneratorSizePreset = size;
        generateDraftLevel();
      },
      onGenerate: generateDraftLevel,
      onSave: () => {
        void saveDraftLevel();
      },
      onBack: openMainMenu,
    });
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "meta") {
    const panel = document.createElement("div");
    panel.className = "panel ui-panel menu-panel menu-panel-wide campaign-shell campaign-meta-shell";
    panel.appendChild(createCampaignScreenHeader("Meta Progression", "Persistent Upgrades"));

    const glorySpent = Math.round(app.metaProfile.metaProgress.glorySpentTotal);
    const totalTrackedGlory = Math.max(1, glorySpent + app.metaProfile.glory);
    const investmentPercent = Math.round((glorySpent / totalTrackedGlory) * 100);
    panel.appendChild(
      createCampaignProgressCard({
        title: "Account Overview",
        subtitle: `Gold available: ${app.metaProfile.glory} • Runs won: ${app.metaProfile.metaProgress.runsWon}`,
        value: `Lv ${computeMetaAccountLevel(app.metaProfile)}`,
        label: "Meta Level",
        percent: investmentPercent,
      }),
    );

    const trees = document.createElement("div");
    trees.className = "campaign-meta-tree-row";
    for (const [treeIndex, tree] of upgradeCatalog.trees.entries()) {
      const treeCard = document.createElement("article");
      treeCard.className = "campaign-meta-tree-card";
      const accent = getMetaTreeAccent(treeIndex);
      treeCard.style.setProperty("--meta-accent", accent.primary);
      treeCard.style.setProperty("--meta-accent-soft", accent.soft);
      treeCard.style.setProperty("--meta-accent-halo", accent.halo);

      let earnedRanks = 0;
      let maxRanks = 0;
      let unlockedNodes = 0;
      for (const node of tree.nodes) {
        const rank = getPurchasedRank(app.metaProfile, node.id);
        earnedRanks += rank;
        maxRanks += node.maxRank;
        if (rank > 0) {
          unlockedNodes += 1;
        }
      }
      const treeProgressPercent = maxRanks > 0 ? Math.round((earnedRanks / maxRanks) * 100) : 0;

      const treeHeader = document.createElement("div");
      treeHeader.className = "campaign-meta-tree-header";

      const treeHeaderTop = document.createElement("div");
      treeHeaderTop.className = "campaign-meta-tree-top";
      const treeEmblem = document.createElement("div");
      treeEmblem.className = "campaign-meta-tree-emblem";
      treeEmblem.textContent = tree.name
        .split(" ")
        .map((token) => token.charAt(0))
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const treeHeaderCopy = document.createElement("div");
      const treeTitle = document.createElement("h3");
      treeTitle.className = "campaign-meta-tree-title";
      treeTitle.textContent = tree.name;
      const treeSubtitle = document.createElement("p");
      treeSubtitle.className = "campaign-meta-tree-subtitle";
      treeSubtitle.textContent = `${tree.nodes.length} upgrades • ${unlockedNodes}/${tree.nodes.length} activated`;
      treeHeaderCopy.append(treeTitle, treeSubtitle);
      treeHeaderTop.append(treeEmblem, treeHeaderCopy);

      const treeSummary = document.createElement("div");
      treeSummary.className = "campaign-meta-tree-summary";
      const treeSummaryCopy = document.createElement("span");
      treeSummaryCopy.className = "campaign-meta-tree-summary-copy";
      treeSummaryCopy.textContent = `${earnedRanks}/${maxRanks} ranks`;
      const treeRank = document.createElement("span");
      treeRank.className = "campaign-meta-tree-rank";
      treeRank.textContent = `${treeProgressPercent}%`;
      treeSummary.append(treeSummaryCopy, treeRank);

      const treeProgressTrack = document.createElement("div");
      treeProgressTrack.className = "campaign-meta-tree-progress";
      const treeProgressFill = document.createElement("div");
      treeProgressFill.className = "campaign-meta-tree-progress-fill";
      treeProgressFill.style.width = `${treeProgressPercent}%`;
      treeProgressTrack.appendChild(treeProgressFill);

      treeHeader.append(treeHeaderTop, treeSummary, treeProgressTrack);
      treeCard.appendChild(treeHeader);

      const list = document.createElement("div");
      list.className = "campaign-meta-node-list";
      for (const node of tree.nodes) {
        const rank = getPurchasedRank(app.metaProfile, node.id);
        const cost = getNextUpgradeCost(app.metaProfile, node);
        const row = document.createElement("div");
        row.className = "campaign-meta-node-row";
        if (cost === null) {
          row.classList.add("is-maxed");
        } else if (app.metaProfile.glory >= cost) {
          row.classList.add("is-affordable");
        } else {
          row.classList.add("is-unaffordable");
        }

        const left = document.createElement("div");
        left.className = "campaign-meta-node-copy";
        const nameRow = document.createElement("div");
        nameRow.className = "campaign-meta-node-head";
        const name = document.createElement("p");
        name.className = "campaign-meta-node-name";
        name.textContent = node.name;
        const rankPill = document.createElement("span");
        rankPill.className = "campaign-meta-rank-pill";
        rankPill.textContent = `Lv ${rank}/${node.maxRank}`;
        nameRow.append(name, rankPill);
        const details = document.createElement("div");
        details.className = "campaign-meta-node-details";
        details.textContent = node.desc;
        left.append(nameRow, details);

        if (node.prereqs.length > 0) {
          const prereqWrap = document.createElement("div");
          prereqWrap.className = "campaign-meta-node-prereqs";
          for (const prereq of node.prereqs) {
            const pill = document.createElement("span");
            pill.className = "campaign-meta-prereq-pill";
            pill.textContent = `${formatMetaNodeLabel(prereq.nodeId)} ${prereq.minRank}+`;
            prereqWrap.appendChild(pill);
          }
          left.appendChild(prereqWrap);
        }

        const nodeProgressTrack = document.createElement("div");
        nodeProgressTrack.className = "campaign-meta-node-progress";
        const nodeProgressFill = document.createElement("div");
        nodeProgressFill.className = "campaign-meta-node-progress-fill";
        nodeProgressFill.style.width = `${(rank / Math.max(1, node.maxRank)) * 100}%`;
        nodeProgressTrack.appendChild(nodeProgressFill);
        left.appendChild(nodeProgressTrack);

        const buyBtn = createButton(
          cost === null ? "Maxed" : `Buy (${cost})`,
          () => purchaseUpgradeById(node.id),
          { variant: cost === null ? "ghost" : app.metaProfile.glory >= cost ? "primary" : "secondary" },
        );
        buyBtn.classList.add("campaign-meta-buy-btn");
        buyBtn.disabled = cost === null || app.metaProfile.glory < cost;
        row.append(left, buyBtn);
        list.appendChild(row);
      }
      const treeList = createScrollArea(list, { maxHeight: "min(42vh, 420px)" });
      treeList.classList.add("campaign-meta-node-scroll");
      treeCard.appendChild(treeList);
      trees.appendChild(treeCard);
    }
    panel.appendChild(trees);

    const progressionCard = document.createElement("section");
    progressionCard.className = "campaign-progress-card";
    const noteTitle = document.createElement("p");
    noteTitle.className = "campaign-progress-title";
    noteTitle.textContent = "Progress Notes";
    const noteText = document.createElement("p");
    noteText.className = "campaign-progress-subtitle";
    noteText.textContent =
      "Meta upgrades only affect future runs. Spend Gold before launching new operations for maximum impact.";
    progressionCard.append(noteTitle, noteText);
    panel.appendChild(progressionCard);

    const footer = document.createElement("div");
    footer.className = "menu-footer campaign-footer";
    const backBtn = createButton("Back", openMainMenu, {
      variant: "ghost",
      escapeAction: true,
      hotkey: "Esc",
    });
    backBtn.classList.add("campaign-footer-btn");
    footer.appendChild(backBtn);
    panel.appendChild(footer);
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "run-map") {
    const panel = createPanel("Run Map", "Prepare modifiers before deploying");
    panel.classList.add("menu-panel", "menu-panel-wide");
    if (!app.runState) {
      panel.appendChild(createParagraph("No run in progress."));
      panel.appendChild(createButton("Back to Menu", openMainMenu, { escapeAction: true, hotkey: "Esc" }));
      screenRoot.appendChild(wrapCentered(panel));
      return;
    }

    const body = document.createElement("div");
    body.className = "menu-body";
    const scroll = document.createElement("div");
    scroll.className = "menu-body-scroll";

    const runCard = createCard("Run Data");
    runCard.appendChild(createParagraph("Section 1: Snapshot of this run seed, difficulty, and mission progress."));
    runCard.appendChild(createParagraph(`Run ID: ${app.runState.runId}`));
    runCard.appendChild(createParagraph(`Seed: ${app.runState.seed}`));
    runCard.appendChild(createParagraph(`Difficulty Tier: ${app.runState.runModifiers.tier}`));
    runCard.appendChild(createParagraph(`Current Mission: ${app.runState.currentMissionIndex + 1}/${app.runState.missions.length}`));

    const difficultyRow = document.createElement("div");
    difficultyRow.className = "meta-row";
    const difficultyLabel = document.createElement("div");
    difficultyLabel.textContent = "Run Difficulty";
    const difficultySelect = document.createElement("select");
    for (const tierId of DIFFICULTY_TIER_IDS) {
      const option = document.createElement("option");
      option.value = tierId;
      option.textContent = tierId;
      if (tierId === app.runState.runModifiers.tier) {
        option.selected = true;
      }
      difficultySelect.appendChild(option);
    }
    difficultySelect.onchange = () => {
      if (!app.runState) {
        return;
      }
      app.runState.runModifiers.tier = difficultySelect.value as DifficultyTierId;
      saveRunState(app.runState);
      openRunMap();
    };
    difficultyRow.append(difficultyLabel, difficultySelect);
    runCard.appendChild(difficultyRow);
    scroll.appendChild(runCard);

    const ascensionInfo = createParagraph(
      `Ascensions: ${app.runState.runAscensionIds.length}/${ascensionCatalog.maxSelected}`,
    );
    const ascensionCard = createCard("Section 2: Ascensions");
    ascensionCard.appendChild(createParagraph("Enable modifiers for higher rewards. Locked after mission 1 starts."));
    ascensionCard.appendChild(ascensionInfo);

    const ascensionList = document.createElement("div");
    ascensionList.className = "list";
    for (const ascension of ascensionCatalog.ascensions) {
      if (!app.runState.runUnlockSnapshot.ascensionIds.includes(ascension.id)) {
        continue;
      }
      const row = document.createElement("div");
      row.className = "meta-row";
      const left = document.createElement("div");
      left.textContent = ascension.name;
      const details = document.createElement("div");
      details.style.fontSize = "12px";
      details.style.opacity = "0.8";
      details.textContent = `${ascension.desc} • Meta Gold x${ascension.reward.gloryMul.toFixed(2)} • Run Gold x${ascension.reward.goldMul.toFixed(2)}`;
      left.appendChild(details);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = app.runState.runAscensionIds.includes(ascension.id);
      checkbox.onchange = () => {
        toggleRunAscension(ascension.id, checkbox.checked);
      };
      if (app.runState.currentMissionIndex > 0) {
        checkbox.disabled = true;
      }
      if (
        !checkbox.checked &&
        app.runState.runAscensionIds.length >= ascensionCatalog.maxSelected
      ) {
        checkbox.disabled = true;
      }

      row.append(left, checkbox);
      ascensionList.appendChild(row);
    }
    ascensionCard.appendChild(createScrollArea(ascensionList, { maxHeight: "min(26vh, 260px)" }));
    scroll.appendChild(ascensionCard);

    const rewardMul = getAscensionRewardMultipliers(app.runState.runAscensionIds, ascensionCatalog);
    scroll.appendChild(
      createParagraph(
        `Expected Ascension Rewards: Meta Gold x${rewardMul.gloryMul.toFixed(2)} | Run Gold x${rewardMul.goldMul.toFixed(2)}`,
      ),
    );

    const missionCard = createCard("Section 3: Mission Route");
    missionCard.appendChild(createParagraph("Mission order for this run. Complete current mission to unlock the next."));
    const missionsList = document.createElement("div");
    missionsList.className = "list";
    app.runState.missions.forEach((mission, index) => {
      const row = document.createElement("div");
      row.className = "meta-row";
      const status =
        index < app.runState!.currentMissionIndex
          ? "Completed"
          : index === app.runState!.currentMissionIndex
            ? "Current"
            : "Locked";
      const label = document.createElement("div");
      label.textContent = `${index + 1}. ${mission.name}`;
      const badge = createBadge(`${status} • x${mission.difficulty.toFixed(2)} • ${app.runState!.runModifiers.tier}`);
      label.appendChild(badge);
      row.appendChild(label);
      missionsList.appendChild(row);
    });
    missionCard.appendChild(createScrollArea(missionsList, { maxHeight: "min(22vh, 240px)" }));
    scroll.appendChild(missionCard);

    body.appendChild(scroll);
    panel.appendChild(body);

    const deployBtn = createButton("Deploy Mission", () => {
      void startCurrentMission();
    }, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    const runFinished = app.runState.currentMissionIndex >= app.runState.missions.length;
    deployBtn.disabled = runFinished;
    panel.appendChild(createDivider());
    const footer = document.createElement("div");
    footer.className = "menu-footer";
    footer.appendChild(deployBtn);
    footer.appendChild(createButton("Meta Progression", openMetaScreen, { variant: "secondary" }));
    footer.appendChild(createButton("Abandon Run", abandonRun, { variant: "danger" }));
    footer.appendChild(createButton("Main Menu", openMainMenu, { variant: "ghost", escapeAction: true, hotkey: "Esc" }));
    panel.appendChild(footer);
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "mission") {
    if (debugState.showMissionHud && app.missionResult === null) {
      screenRoot.appendChild(gameplayHud.getElement());
    }

    if (app.missionPaused && app.missionResult === null) {
      const pausePanel = document.createElement("div");
      pausePanel.className = "panel ui-panel menu-panel pause-panel campaign-shell mission-overlay-panel mission-pause-shell";
      pausePanel.appendChild(createCampaignScreenHeader("Mission Paused", "Tactical Freeze"));

      const hero = document.createElement("section");
      hero.className = "mission-pause-hero";
      const emblem = document.createElement("div");
      emblem.className = "mission-pause-emblem";
      emblem.textContent = "II";
      const heroCopy = document.createElement("div");
      const heroTitle = document.createElement("h3");
      heroTitle.className = "mission-pause-title";
      heroTitle.textContent = "Command Standby";
      const heroSubtitle = document.createElement("p");
      heroSubtitle.className = "mission-pause-subtitle";
      heroSubtitle.textContent = "Simulation halted. Review your options before redeploying.";
      heroCopy.append(heroTitle, heroSubtitle);
      hero.append(emblem, heroCopy);
      pausePanel.appendChild(hero);

      const summary = document.createElement("section");
      summary.className = "mission-pause-summary";
      summary.appendChild(createMissionHudLabel("Control Summary"));
      summary.appendChild(createParagraph("Continue: resume simulation and restore controls."));
      summary.appendChild(createParagraph("Restart Mission: reset this mission from the start."));
      summary.appendChild(createParagraph("Main Menu: leave mission and return to command menu."));
      pausePanel.appendChild(summary);

      const actions = document.createElement("div");
      actions.className = "mission-pause-actions";
      const continueBtn = createButton("Continue", () => {
        setMissionPaused(false);
      }, { variant: "primary", primaryAction: true, hotkey: "Enter" });
      continueBtn.classList.add("mission-pause-action", "is-primary");
      actions.appendChild(continueBtn);

      const restartBtn = createButton("Restart Mission", () => {
        setMissionPaused(false);
        restartCurrentMission();
      }, { variant: "secondary" });
      restartBtn.classList.add("mission-pause-action");
      actions.appendChild(restartBtn);

      const menuBtn = createButton("Main Menu", () => {
        setMissionPaused(false);
        openMainMenu();
      }, { variant: "ghost", escapeAction: true, hotkey: "Esc" });
      menuBtn.classList.add("mission-pause-action");
      actions.appendChild(menuBtn);
      pausePanel.appendChild(actions);
      screenRoot.appendChild(wrapCenteredModal(pausePanel));
    }

    if (app.missionResult) {
      const isVictory = app.missionResult === "win";
      const rewardValue = app.missionReward ? app.missionReward.total : 0;
      const telemetry = app.game?.getWaveTelemetry() ?? null;
      const completedWaves = telemetry
        ? Math.max(0, telemetry.currentWaveIndex - (telemetry.activeWaveInProgress ? 1 : 0))
        : 0;
      const totalWaves = telemetry?.totalWaveCount ?? 0;

      const resultPanel = document.createElement("div");
      resultPanel.className = `panel ui-panel menu-panel mission-overlay-panel campaign-shell mission-result-shell ${isVictory ? "is-victory" : "is-defeat"}`;
      resultPanel.appendChild(
        createCampaignScreenHeader(
          isVictory ? "Mission Victory" : "Mission Defeat",
          isVictory ? "Operation Success" : "Operation Failed",
        ),
      );

      const hero = document.createElement("section");
      hero.className = "mission-result-hero";
      const emblem = document.createElement("div");
      emblem.className = "mission-result-emblem";
      emblem.textContent = isVictory ? "V" : "X";
      const heroCopy = document.createElement("div");
      const heroTitle = document.createElement("h3");
      heroTitle.className = "mission-result-title";
      heroTitle.textContent = isVictory ? "Control Secured" : "Control Breached";
      const heroSubtitle = document.createElement("p");
      heroSubtitle.className = "mission-result-subtitle";
      heroSubtitle.textContent = app.activeMissionContext?.mode === "campaign"
        ? "Campaign mission report complete."
        : "Run mission report complete.";
      heroCopy.append(heroTitle, heroSubtitle);
      hero.append(emblem, heroCopy);
      resultPanel.appendChild(hero);

      const stats = document.createElement("div");
      stats.className = "mission-result-stats";
      stats.append(
        createMissionResultStat("Mode", app.activeMissionContext?.mode === "campaign" ? "Campaign" : "Run"),
        createMissionResultStat("Outcome", isVictory ? "Victory" : "Defeat"),
        createMissionResultStat("Wave Progress", totalWaves > 0 ? `${completedWaves}/${totalWaves}` : "--"),
        createMissionResultStat(
          "Gold Reward",
          app.activeMissionContext?.mode === "campaign" ? "Progress Unlocks" : `${rewardValue}`,
        ),
      );
      resultPanel.appendChild(stats);

      const notes = document.createElement("section");
      notes.className = "mission-result-notes";
      notes.appendChild(createMissionHudLabel("Mission Notes"));
      const noteLine = document.createElement("p");
      noteLine.className = "mission-result-note-line";
      noteLine.textContent = isVictory
        ? "Commander update: objective complete. Reposition for the next operation."
        : "Commander update: regroup, tune links, and redeploy.";
      notes.appendChild(noteLine);
      resultPanel.appendChild(notes);

      const actionRow = document.createElement("div");
      actionRow.className = "menu-footer campaign-footer mission-result-actions";

      if (app.activeMissionContext?.mode === "campaign") {
        const backToMissions = createButton("Back To Missions", () => {
          if (app.activeMissionContext?.mode !== "campaign") {
            openStageSelect();
            return;
          }
          app.selectedStageId = app.activeMissionContext.stageId;
          openMissionSelect(app.activeMissionContext.levelId);
        }, { variant: "primary", primaryAction: true, hotkey: "Enter" });
        backToMissions.classList.add("campaign-footer-btn");
        actionRow.appendChild(backToMissions);

        const retryBtn = createButton("Retry Mission", restartCurrentMission, { variant: "secondary" });
        retryBtn.classList.add("campaign-footer-btn");
        actionRow.appendChild(retryBtn);

        const stageBtn = createButton("Stage Select", openStageSelect, { variant: "ghost", escapeAction: true, hotkey: "Esc" });
        stageBtn.classList.add("campaign-footer-btn");
        actionRow.appendChild(stageBtn);
      } else {
        if (isVictory && app.runState && app.runState.currentMissionIndex < app.runState.missions.length) {
          const continueBtn = createButton("Continue To Run Map", openRunMap, {
            variant: "primary",
            primaryAction: true,
            hotkey: "Enter",
          });
          continueBtn.classList.add("campaign-footer-btn");
          actionRow.appendChild(continueBtn);
        } else {
          const summaryBtn = createButton("Open Run Summary", () => {
            if (isVictory) {
              finalizeRun(true);
            } else {
              finalizeRun(false);
            }
          }, { variant: "primary", primaryAction: true, hotkey: "Enter" });
          summaryBtn.classList.add("campaign-footer-btn");
          actionRow.appendChild(summaryBtn);
        }
        const canRestartMission = !(isVictory && app.runState && app.runState.currentMissionIndex < app.runState.missions.length);
        if (canRestartMission) {
          const restartBtn = createButton("Restart Mission", restartCurrentMission, { variant: "secondary" });
          restartBtn.classList.add("campaign-footer-btn");
          actionRow.appendChild(restartBtn);
        }
        const mainMenuBtn = createButton("Main Menu", openMainMenu, { variant: "ghost", escapeAction: true, hotkey: "Esc" });
        mainMenuBtn.classList.add("campaign-footer-btn");
        actionRow.appendChild(mainMenuBtn);
      }
      resultPanel.appendChild(actionRow);
      screenRoot.appendChild(wrapCentered(resultPanel));
    }
    return;
  }

  if (app.screen === "run-summary") {
    const panel = createPanel("End of Run Summary", "Mission report and meta rewards");
    panel.classList.add("menu-panel");
    if (!app.runSummary) {
      panel.appendChild(createParagraph("No summary data."));
      panel.appendChild(createButton("Back to Menu", closeSummaryToMenu, { variant: "ghost", escapeAction: true, hotkey: "Esc" }));
      screenRoot.appendChild(wrapCentered(panel));
      return;
    }

    const report = document.createElement("div");
    report.className = "list";
    report.appendChild(createParagraph(app.runSummary.won ? "Run Result: Victory" : "Run Result: Defeat"));
    report.appendChild(createParagraph(`Missions completed: ${app.runSummary.missionsCompleted}`));
    report.appendChild(createParagraph(`Mission Gold: ${app.runSummary.missionGlory}`));
    report.appendChild(createParagraph(`Run Bonus Gold: ${app.runSummary.runBonusGlory}`));
    report.appendChild(createParagraph(`Total Gold Earned: ${app.runSummary.totalGloryEarned}`));
    report.appendChild(createParagraph(`Difficulty Tier: ${app.runSummary.difficultyTier}`));
    report.appendChild(
      createParagraph(
        `Ascensions: ${app.runSummary.ascensionIds.length > 0 ? app.runSummary.ascensionIds.join(", ") : "none"}`,
      ),
    );
    report.appendChild(
      createParagraph(
        `Ascension Rewards: Meta Gold x${app.runSummary.rewardMultipliers.gloryMul.toFixed(2)} | Run Gold x${app.runSummary.rewardMultipliers.goldMul.toFixed(2)}`,
      ),
    );
    report.appendChild(
      createParagraph(
        `Applied Multipliers: enemy HP x${app.runSummary.appliedDifficultyMultipliers.enemyHpMul.toFixed(2)}, enemy DMG x${app.runSummary.appliedDifficultyMultipliers.enemyDmgMul.toFixed(2)}, economy Meta Gold x${app.runSummary.appliedDifficultyMultipliers.economyGloryMul.toFixed(2)}`,
      ),
    );
    if (app.runSummary.unlockNotifications.length > 0) {
      report.appendChild(createDivider());
      report.appendChild(createParagraph("New unlocks:"));
      const unlockList = document.createElement("div");
      unlockList.className = "list";
      for (const unlock of app.runSummary.unlockNotifications) {
        unlockList.appendChild(createParagraph(`• ${unlock}`));
      }
      report.appendChild(createScrollArea(unlockList, { maxHeight: "min(24vh, 220px)" }));
    }
    panel.appendChild(createScrollArea(report, { maxHeight: "min(60vh, 620px)" }));

    panel.appendChild(createButton("Back to Main Menu", closeSummaryToMenu, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
      escapeAction: true,
    }));
    screenRoot.appendChild(wrapCentered(panel));
  }
}

function syncMissionHud(app: AppState, debugState: DebugUiState, gameplayHud: GameplayHUD): void {
  if (app.screen !== "mission" || !app.game || app.missionResult || !debugState.showMissionHud) {
    gameplayHud.clearOverlays();
    return;
  }

  const telemetry = app.game.getWaveTelemetry();
  const world = app.game.getWorld();
  const vm = buildHudViewModel({
    game: app.game,
    missionTitle: getMissionHudTitle(app),
    objectiveText: getMissionHudObjective(app),
    selectedTowerId: app.inputController?.getSelectedTowerId() ?? null,
    missionPaused: app.missionPaused,
    missionSpeedMul: app.missionSpeedMul,
    overlayRegenEnabled: debugState.showOverlayRegenNumbers,
    overlayCaptureEnabled: debugState.showOverlayCaptureRings,
    overlayClusterEnabled: debugState.showOverlayClusterHighlight,
  });

  const linkFeedback = app.inputController?.drainLinkFeedback() ?? [];
  for (const message of linkFeedback) {
    gameplayHud.pushToast({
      type: "warning",
      title: "Link Rejected",
      body: message,
      ttl: 1600,
    });
  }

  updateMissionEventFeed(app, telemetry, world, (toast) => {
    gameplayHud.pushToast(toast);
  }, vm.overlays.towers);
  runTutorialHintFeed(app, telemetry, world, (toast) => {
    gameplayHud.pushToast(toast);
  });

  gameplayHud.update(vm);
}

function runTutorialHintFeed(
  app: AppState,
  telemetry: MissionWaveTelemetry | null,
  world: World,
  notifyToast: (toast: HudToastInput) => void,
): void {
  if (!app.tutorialHintRunner || !app.tutorialHintRunner.hasHints()) {
    return;
  }
  const hints = app.tutorialHintRunner.update({ telemetry, world });
  for (const hint of hints) {
    notifyToast({
      type: "info",
      title: "Hint",
      body: hint,
      ttl: 3200,
    });
  }
}

function renderDebugPanel(
  debugPanel: HTMLDivElement,
  app: AppState,
  addDebugGlory: () => void,
  resetMeta: () => void,
  resetCampaign: () => void,
  forceMissionWin: () => void,
  forceMissionLose: () => void,
  debugSpawnEnemy: (enemyId: string, elite: boolean) => void,
  debugStartWave: (waveIndex: number) => void,
  toggleBalanceDiagnostics: () => void,
  validateLinksDebug: () => void,
  runQuickSimDebug: () => void,
  copyDifficultyReportDebug: () => void,
  setDifficultyReportMissionIndex: (value: number | null) => void,
  setDifficultyReportPreviewWaves: (value: number) => void,
  setDifficultyReportIncludeSamples: (enabled: boolean) => void,
): void {
  debugPanel.replaceChildren();
  debugPanel.classList.toggle("open", DEBUG_TOOLS_ENABLED && debugUiStore.getState().debugOpen);
  if (!DEBUG_TOOLS_ENABLED) {
    return;
  }

  const debugState = debugUiStore.getState();
  const shell = createPanel("Debug Menu", "Press D to toggle");
  shell.classList.add("debug-shell");

  const header = shell.querySelector(".ui-panel-header");
  if (header instanceof HTMLDivElement) {
    const closeBtn = createIconButton("×", "Close", () => {
      debugUiStore.setState({ debugOpen: false });
    }, { variant: "ghost", tooltip: "Close debug menu (D)" });
    header.appendChild(closeBtn);
  }

  const telemetry = app.game?.getWaveTelemetry() ?? null;
  const world = app.game?.getWorld() ?? null;
  const tabs = createTabs(
    [
      {
        id: "run",
        label: "Run",
        render: () => {
          const panel = document.createElement("div");
          panel.className = "list";

          panel.appendChild(createDebugRow("Seed", app.runState ? String(app.runState.seed) : "--"));
          panel.appendChild(createDebugRow("Wave", telemetry ? `${telemetry.currentWaveIndex}/${telemetry.totalWaveCount}` : "--"));
          panel.appendChild(createDebugRow("Tier", app.runState?.runModifiers.tier ?? "--"));
          panel.appendChild(createDebugRow("Frame", `${app.frameTimeMs.toFixed(2)} ms`));
          panel.appendChild(createDebugRow("FPS", `${app.fps.toFixed(1)}`));

          const modifiersCard = createCard("Current Modifiers");
          const modifiersList = document.createElement("div");
          modifiersList.className = "list";
          for (const modifier of telemetry?.activeModifierNames ?? []) {
            modifiersList.appendChild(createParagraph(`• ${modifier}`));
          }
          if ((telemetry?.activeModifierNames.length ?? 0) === 0) {
            modifiersList.appendChild(createParagraph("None active."));
          }
          modifiersCard.appendChild(createScrollArea(modifiersList, { maxHeight: "min(20vh, 160px)" }));
          panel.appendChild(modifiersCard);

          return panel;
        },
      },
      {
        id: "sim",
        label: "Sim",
        render: () => {
          const panel = document.createElement("div");
          panel.className = "list";
          panel.appendChild(createDebugRow("Tick Rate", "60 Hz fixed-step"));
          panel.appendChild(createDebugRow("Determinism", "ON"));
          panel.appendChild(createDebugRow("Frame Time", `${app.frameTimeMs.toFixed(2)} ms`));
          panel.appendChild(createDebugRow("Input Drag", app.inputController?.isDragging() ? "active" : "idle"));
          panel.appendChild(createDebugRow("Entity Towers", world ? String(world.towers.length) : "--"));
          panel.appendChild(createDebugRow("Entity Links", world ? String(world.links.length) : "--"));
          panel.appendChild(createDebugRow("Entity Packets", world ? String(world.packets.length) : "--"));

          const diagnostics = createCard("Diagnostics");
          const diagnosticsList = document.createElement("div");
          diagnosticsList.className = "list";
          diagnosticsList.appendChild(createParagraph(`Balance HUD: ${app.balanceDiagnosticsEnabled ? "ON" : "OFF"}`));
          diagnosticsList.appendChild(createParagraph(`Wave pressure: ${telemetry ? telemetry.wavePressureScore.toFixed(1) : "--"}`));
          diagnosticsList.appendChild(createParagraph(`Packets/s: ${telemetry ? telemetry.packetsSentPerSec.toFixed(2) : "--"}`));
          diagnosticsList.appendChild(
            createParagraph(
              `TTZ towers: ${telemetry && telemetry.timeToZeroTowersEstimateSec !== null ? telemetry.timeToZeroTowersEstimateSec.toFixed(1) : "∞"}`,
            ),
          );
          diagnostics.appendChild(createScrollArea(diagnosticsList, { maxHeight: "min(20vh, 160px)" }));
          panel.appendChild(diagnostics);

          const internalState = createCard("Internal State");
          const internalList = document.createElement("div");
          internalList.className = "list";
          for (const eventEntry of app.missionEvents.slice(0, 10)) {
            internalList.appendChild(createParagraph(`• ${eventEntry.message}`));
          }
          if (app.missionEvents.length === 0) {
            internalList.appendChild(createParagraph("No mission events logged."));
          }
          internalState.appendChild(createScrollArea(internalList, { maxHeight: "min(20vh, 180px)" }));
          panel.appendChild(internalState);

          return panel;
        },
      },
      {
        id: "ui",
        label: "UI",
        render: () => {
          const panel = document.createElement("div");
          panel.className = "list";
          panel.appendChild(createDebugToggle("Show Tower Tooltips", debugState.showTowerTooltips, () => {
            debugUiStore.toggle("showTowerTooltips");
          }));
          panel.appendChild(createDebugToggle("Show Enemy Tooltips", debugState.showEnemyTooltips, () => {
            debugUiStore.toggle("showEnemyTooltips");
          }));
          panel.appendChild(createDebugToggle("Show Mission HUD", debugState.showMissionHud, () => {
            debugUiStore.toggle("showMissionHud");
          }));
          panel.appendChild(createDebugToggle("Show Skills HUD", debugState.showSkillHud, () => {
            debugUiStore.toggle("showSkillHud");
          }));
          panel.appendChild(createDebugToggle("Show Wave Preview", debugState.showWavePreview, () => {
            debugUiStore.toggle("showWavePreview");
          }));
          panel.appendChild(createDebugToggle("Overlay Regen Numbers", debugState.showOverlayRegenNumbers, () => {
            debugUiStore.toggle("showOverlayRegenNumbers");
          }));
          panel.appendChild(createDebugToggle("Overlay Capture Rings", debugState.showOverlayCaptureRings, () => {
            debugUiStore.toggle("showOverlayCaptureRings");
          }));
          panel.appendChild(createDebugToggle("Overlay Cluster Glow", debugState.showOverlayClusterHighlight, () => {
            debugUiStore.toggle("showOverlayClusterHighlight");
          }));
          panel.appendChild(createDebugToggle("Show Hitboxes", debugState.showHitboxes, () => {
            debugUiStore.toggle("showHitboxes");
          }, "Reserved hook; no runtime hitbox renderer is currently active."));
          panel.appendChild(createDebugToggle("Show Grid Lines", debugState.showGridLines, () => {
            debugUiStore.toggle("showGridLines");
          }));
          return panel;
        },
      },
      {
        id: "dev",
        label: "Dev",
        render: () => {
          const panel = document.createElement("div");
          panel.className = "list";

          const danger = document.createElement("details");
          danger.className = "debug-danger";
          danger.open = app.debugDangerZoneOpen;
          danger.ontoggle = () => {
            app.debugDangerZoneOpen = danger.open;
          };

          const summary = document.createElement("summary");
          summary.textContent = "Danger Zone";
          danger.appendChild(summary);

          const dangerContent = document.createElement("div");
          dangerContent.className = "list";
          dangerContent.appendChild(createButton("Debug: +250 Gold", addDebugGlory, { variant: "secondary" }));
          dangerContent.appendChild(createButton("Debug: Reset Meta", resetMeta, { variant: "danger" }));
          dangerContent.appendChild(createButton("Debug: Reset Campaign Progress", resetCampaign, { variant: "danger" }));

          const canForceEnd = app.screen === "mission" && app.game !== null && app.missionResult === null;
          const forceWinBtn = createButton("Debug: Mission Win", forceMissionWin, { variant: "secondary" });
          forceWinBtn.disabled = !canForceEnd;
          dangerContent.appendChild(forceWinBtn);

          const forceLoseBtn = createButton("Debug: Mission Lose", forceMissionLose, { variant: "secondary" });
          forceLoseBtn.disabled = !canForceEnd;
          dangerContent.appendChild(forceLoseBtn);

          const balanceBtn = createButton(
            app.balanceDiagnosticsEnabled ? "Debug: Balance HUD ON" : "Debug: Balance HUD OFF",
            toggleBalanceDiagnostics,
            { variant: "ghost" },
          );
          dangerContent.appendChild(balanceBtn);

          const validateLinksBtn = createButton("Debug: Validate Links", validateLinksDebug, {
            variant: "secondary",
          });
          validateLinksBtn.disabled = app.game === null;
          dangerContent.appendChild(validateLinksBtn);

          const quickSimBtn = createButton("Debug: Quick Sim x24", runQuickSimDebug, { variant: "secondary" });
          quickSimBtn.disabled = app.runState === null;
          dangerContent.appendChild(quickSimBtn);

          const reportCard = createCard("Difficulty Report");
          const reportControls = document.createElement("div");
          reportControls.className = "list";

          if (app.runState && app.runState.missions.length > 0) {
            const missionSelect = document.createElement("select");
            for (let i = app.runState.currentMissionIndex; i < app.runState.missions.length; i += 1) {
              const mission = app.runState.missions[i];
              const option = document.createElement("option");
              option.value = String(i);
              option.textContent = `M${i + 1}: ${mission.name}`;
              if ((app.difficultyReportMissionIndex ?? app.runState.currentMissionIndex) === i) {
                option.selected = true;
              }
              missionSelect.appendChild(option);
            }
            missionSelect.onchange = () => {
              setDifficultyReportMissionIndex(Number.parseInt(missionSelect.value, 10));
            };
            reportControls.appendChild(missionSelect);
          }

          const wavesInput = document.createElement("input");
          wavesInput.type = "number";
          wavesInput.min = "1";
          wavesInput.max = "24";
          wavesInput.step = "1";
          wavesInput.value = String(app.difficultyReportPreviewWaves);
          wavesInput.onchange = () => {
            const parsed = Number.parseInt(wavesInput.value, 10);
            if (Number.isFinite(parsed)) {
              setDifficultyReportPreviewWaves(parsed);
            }
          };
          reportControls.appendChild(createDebugLabeledControl("Preview Waves", wavesInput));

          reportControls.appendChild(
            createDebugToggle("Include Unit Samples", app.difficultyReportIncludeSamples, () => {
              setDifficultyReportIncludeSamples(!app.difficultyReportIncludeSamples);
            }),
          );

          const copyReportBtn = createButton("Copy Difficulty Report", copyDifficultyReportDebug, { variant: "secondary" });
          copyReportBtn.disabled = app.game === null && app.runState === null;
          reportControls.appendChild(copyReportBtn);

          const reportOutput = document.createElement("textarea");
          reportOutput.readOnly = true;
          reportOutput.rows = 10;
          reportOutput.style.width = "100%";
          reportOutput.value = app.difficultyReportOutput;
          reportControls.appendChild(reportOutput);
          reportCard.appendChild(createScrollArea(reportControls, { maxHeight: "min(36vh, 320px)" }));
          dangerContent.appendChild(reportCard);

          if (app.game && app.screen === "mission" && app.missionResult === null) {
            const enemyIds = app.game.getDebugEnemyIds();
            if (enemyIds.length > 0) {
              const spawnCard = createCard("Spawn Enemy");
              const select = document.createElement("select");
              for (const enemyId of enemyIds) {
                const option = document.createElement("option");
                option.value = enemyId;
                option.textContent = enemyId;
                select.appendChild(option);
              }
              const eliteToggle = createDebugToggle("Elite", false, () => {
                // checkbox state is read when spawning
              });
              const eliteCheckbox = eliteToggle.querySelector("input");
              const spawnBtn = createButton("Spawn", () => {
                debugSpawnEnemy(select.value, eliteCheckbox instanceof HTMLInputElement ? eliteCheckbox.checked : false);
              }, { variant: "secondary" });
              spawnCard.append(select, eliteToggle, spawnBtn);
              dangerContent.appendChild(spawnCard);
            }

            const maxWaveIndex = app.game.getDebugMaxWaveIndex();
            if (maxWaveIndex > 0) {
              const waveCard = createCard("Start Wave");
              const waveSelect = document.createElement("select");
              for (let i = 1; i <= maxWaveIndex; i += 1) {
                const option = document.createElement("option");
                option.value = String(i);
                option.textContent = `Wave ${i}`;
                waveSelect.appendChild(option);
              }
              const waveBtn = createButton("Start", () => {
                debugStartWave(Number.parseInt(waveSelect.value, 10));
              }, { variant: "secondary" });
              waveCard.append(waveSelect, waveBtn);
              dangerContent.appendChild(waveCard);
            }
          }

          danger.appendChild(dangerContent);
          panel.appendChild(danger);
          return panel;
        },
      },
    ],
    app.debugTab,
    (tabId) => {
      app.debugTab = tabId as DebugTab;
    },
  );

  shell.appendChild(createScrollArea(tabs.root, { maxHeight: "calc(100vh - 130px)" }));
  debugPanel.appendChild(shell);
}

function createDebugRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "meta-row";

  const left = document.createElement("div");
  left.textContent = label;

  const right = document.createElement("div");
  right.textContent = value;
  right.style.opacity = "0.85";

  row.append(left, right);
  return row;
}

function createDebugToggle(
  label: string,
  checked: boolean,
  onChange: () => void,
  description?: string,
): HTMLLabelElement {
  const row = document.createElement("label");
  row.className = "debug-toggle-row";

  const left = document.createElement("div");
  left.className = "debug-toggle-label";
  left.textContent = label;

  if (description) {
    const note = document.createElement("div");
    note.className = "debug-toggle-description";
    note.textContent = description;
    left.appendChild(note);
  }

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = onChange;

  row.append(left, input);
  return row;
}

function createDebugLabeledControl(label: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "meta-row";

  const left = document.createElement("div");
  left.textContent = label;
  const right = document.createElement("div");
  right.appendChild(control);

  row.append(left, right);
  return row;
}

async function getLevelByPath(path: string, cache: Map<string, LoadedLevel>): Promise<LoadedLevel> {
  const cached = cache.get(path);
  if (cached) {
    return cloneLoadedLevel(cached);
  }

  const loaded = await loadLevel(path);
  cache.set(path, cloneLoadedLevel(loaded));
  return cloneLoadedLevel(loaded);
}

function cloneLoadedLevel(level: LoadedLevel): LoadedLevel {
  return {
    towers: level.towers.map((tower) => ({ ...tower })),
    initialLinks: level.initialLinks.map((link) => ({
      ...link,
      points: link.points.map((point) => ({ ...point })),
    })),
    rules: {
      ...level.rules,
      defaultUnit: { ...level.rules.defaultUnit },
      packetStatCaps: { ...level.rules.packetStatCaps },
      fightModel: { ...level.rules.fightModel },
    },
    ai: { ...level.ai },
    graphEdges: level.graphEdges?.map((edge) => ({ ...edge })),
    mapRenderData: level.mapRenderData
      ? {
          ...level.mapRenderData,
          bounds: { ...level.mapRenderData.bounds },
          nodes: level.mapRenderData.nodes.map((node) => ({ ...node })),
          edges: level.mapRenderData.edges.map((edge) => ({ ...edge })),
        }
      : undefined,
  };
}

function createMissionLevel(
  baseLevel: LoadedLevel,
  difficultyContext: DifficultyContext,
  towerArchetypes: TowerArchetypeCatalog,
  baselines: BalanceBaselinesConfig,
  unlockedTowerTypes: string[],
): LoadedLevel {
  const bonuses = difficultyContext.appliedMetaModifiers;
  const difficultyTier = difficultyContext.tierConfig;
  const level = cloneLoadedLevel(baseLevel);
  applyBalanceBaselinesToLevelRules(level, baselines, bonuses);

  const regenCaps = baselines.troopRegen.globalRegenCaps;
  const defenseCaps = baselines.towerTroops.defenseMultipliersCaps;
  const troopCapMax = baselines.towerTroops.baseMaxTroops * 2;
  const unlockedTowerTypeSet = new Set(unlockedTowerTypes);

  for (const tower of level.towers) {
    if (unlockedTowerTypeSet.size > 0 && !unlockedTowerTypeSet.has(tower.archetype)) {
      tower.archetype = TowerArchetype.STRONGHOLD;
    }
    applyTowerArchetypeModifiers(tower, towerArchetypes);
    const archetypeRegenMul = baselines.troopRegen.archetypeMultipliers[tower.archetype] ?? 1;
    tower.regenRate = clamp(
      tower.regenRate * baselines.troopRegen.baseRegenPerSec * archetypeRegenMul,
      regenCaps.min,
      regenCaps.max,
    );
    tower.maxTroops = clamp(tower.maxTroops, 10, troopCapMax);
    tower.baseMaxTroops = tower.maxTroops;
    tower.defenseMultiplier = clamp(tower.defenseMultiplier, defenseCaps.min, defenseCaps.max);
    tower.troops = Math.min(tower.maxTroops, tower.troops);
  }
  const playerTowers = level.towers.filter((tower) => tower.owner === "player");
  const enemyTowers = level.towers.filter((tower) => tower.owner === "enemy");

  for (const tower of playerTowers) {
    tower.maxHp *= bonuses.towerHpMultiplier;
    tower.hp = Math.min(tower.maxHp, tower.hp * bonuses.towerHpMultiplier);
    tower.regenRate = clamp(tower.regenRate * bonuses.towerRegenMul, regenCaps.min, regenCaps.max);
    tower.maxTroops = clamp(tower.maxTroops * bonuses.towerMaxTroopsMul, 10, troopCapMax);
    tower.packetDamageMultiplier *= bonuses.packetDamageMul;
    tower.extraOutgoingLinks += bonuses.extraOutgoingLinksAdd;
  }

  const troopBonus = bonuses.startingGold / BALANCE_CONFIG.conversion.startingGoldToTroopsRatio;
  if (troopBonus > 0 && playerTowers.length > 0) {
    const perTowerBonus = troopBonus / playerTowers.length;
    for (const tower of playerTowers) {
      tower.troops = Math.min(tower.maxTroops, tower.troops + perTowerBonus);
    }
  }

  for (const tower of playerTowers) {
    tower.troops = Math.min(tower.maxTroops, tower.troops * bonuses.startingTroopsMul);
  }

  grantAdditionalStartingTowers(level, difficultyTier.player.startingTowersAdd, baselines);

  if (bonuses.strongholdStartLevel >= 2 && playerTowers.length > 0) {
    const stronghold = playerTowers[0];
    stronghold.maxHp *= 1.15;
    stronghold.hp = Math.min(stronghold.maxHp, stronghold.hp + stronghold.maxHp * 0.1);
    stronghold.troops = Math.min(stronghold.maxTroops, stronghold.troops + 8);
    stronghold.regenRate += 0.5;
  }

  const mapDifficultyScalar = Math.max(0.05, difficultyContext.mapDifficultyScalar);
  for (const tower of enemyTowers) {
    tower.maxHp *= mapDifficultyScalar;
    tower.hp = Math.min(tower.maxHp, tower.hp * mapDifficultyScalar);
    tower.maxTroops *= mapDifficultyScalar;
    tower.troops = Math.min(tower.maxTroops, tower.troops * mapDifficultyScalar);
    tower.regenRate *= 1 + (mapDifficultyScalar - 1) * 0.4;
  }

  for (const tower of level.towers) {
    tower.baseRegen = tower.regenRate;
    tower.baseRegenRate = tower.regenRate;
    if (!Number.isFinite(tower.baseVision) || tower.baseVision <= 0) {
      tower.baseVision = 170;
    }
    tower.effectiveRegen = tower.baseRegen;
    tower.effectiveVision = tower.baseVision;
    tower.territoryClusterSize = 0;
    tower.territoryRegenBonusPct = 0;
    tower.territoryArmorBonusPct = 0;
    tower.territoryVisionBonusPct = 0;
  }

  level.rules.sendRatePerSec = difficultyContext.simulation.sendRatePerSec;
  level.rules.captureRateMultiplier = difficultyContext.simulation.captureRateMultiplier;
  level.rules.playerCaptureEfficiencyMul = difficultyContext.simulation.playerCaptureEfficiencyMul;
  level.rules.playerRegenMultiplier = difficultyContext.simulation.playerRegenMultiplier;
  level.rules.playerPacketArmorAdd = bonuses.packetArmorAdd;
  level.rules.playerPacketArmorMul = bonuses.packetArmorMul;
  level.rules.enemyRegenMultiplier = difficultyContext.simulation.enemyRegenMultiplier;
  level.rules.linkDecayPerSec = difficultyContext.simulation.linkDecayPerSec;
  level.rules.linkDecayCanBreak = difficultyContext.simulation.linkDecayCanBreak;

  level.ai.aiMinTroopsToAttack = Math.max(5, level.ai.aiMinTroopsToAttack / mapDifficultyScalar);
  return level;
}

function applyBalanceBaselinesToLevelRules(
  level: LoadedLevel,
  baselines: BalanceBaselinesConfig,
  bonuses: MetaModifiers,
): void {
  level.rules.captureSeedTroops = baselines.towerTroops.captureSeedTroops;
  level.rules.captureRateMultiplier = baselines.towerTroops.captureRateMultiplier;
  level.rules.playerCaptureEfficiencyMul = 1;
  level.rules.regenMinPerSec = baselines.troopRegen.globalRegenCaps.min;
  level.rules.regenMaxPerSec = baselines.troopRegen.globalRegenCaps.max;
  level.rules.playerRegenMultiplier = 1;
  level.rules.enemyRegenMultiplier = 1;
  level.rules.defaultPacketArmor = baselines.packets.baseArmor;
  level.rules.playerPacketArmorAdd = 0;
  level.rules.playerPacketArmorMul = 1;
  level.rules.linkDecayPerSec = 0;
  level.rules.linkDecayCanBreak = false;
  level.rules.packetStatCaps = { ...baselines.packets.globalCaps };
  level.rules.fightModel = {
    shieldArmorUptimeMultiplier: baselines.packets.fightResolutionModelParams.shieldArmorUptimeMultiplier,
    combatHoldFactor: baselines.packets.fightResolutionModelParams.combatHoldFactor,
    rangedHoldFactor: baselines.packets.fightResolutionModelParams.rangedHoldFactor,
    linkCutterHoldFactor: baselines.packets.fightResolutionModelParams.linkCutterHoldFactor,
  };
  level.rules.defaultUnit.speedPxPerSec = baselines.packets.baseSpeed * bonuses.packetSpeedMul;
  level.rules.defaultUnit.dpsPerUnit = baselines.packets.baseDamage;
  level.rules.defaultUnit.hpPerUnit = Math.max(level.rules.defaultUnit.hpPerUnit, 1);
}

function grantAdditionalStartingTowers(
  level: LoadedLevel,
  additionalTowers: number,
  baselines: BalanceBaselinesConfig,
): void {
  const count = Math.max(0, Math.floor(additionalTowers));
  if (count <= 0) {
    return;
  }

  const neutral = level.towers
    .filter((tower) => tower.owner === "neutral")
    .sort((a, b) => a.id.localeCompare(b.id));
  const captureTroops = baselines.towerTroops.captureSeedTroops;

  for (let i = 0; i < count && i < neutral.length; i += 1) {
    const tower = neutral[i];
    tower.owner = "player";
    tower.hp = tower.maxHp;
    tower.troops = Math.min(tower.maxTroops, Math.max(captureTroops, tower.troops));
  }
}

function getDifficultyGloryMultiplier(
  baselines: BalanceBaselinesConfig,
  difficultyTier: DifficultyTierConfig,
  tierId: DifficultyTierId,
): number {
  const baselineMul = baselines.economy.gloryMultiplierByDifficulty[tierId];
  return baselineMul * difficultyTier.economy.gloryMul;
}

function maxDifficultyTier(left: DifficultyTierId, right: DifficultyTierId): DifficultyTierId {
  return difficultyTierRank(left) >= difficultyTierRank(right) ? left : right;
}

function difficultyTierRank(value: DifficultyTierId): number {
  if (value === "ASCENDED") {
    return 3;
  }
  if (value === "HARD") {
    return 2;
  }
  return 1;
}

function deriveStageIdFromLevelPath(path: string): string {
  const match = path.match(/stage\d+/i);
  if (!match) {
    return "stage01";
  }
  const numeric = Number.parseInt(match[0].replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "stage01";
  }
  return `stage${numeric.toString().padStart(2, "0")}`;
}

function deriveStageIndexFromValue(stageValue?: string): number {
  if (!stageValue) {
    return 1;
  }
  const match = stageValue.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function countPlayerTowers(world: World): number {
  let count = 0;
  for (const tower of world.towers) {
    if (tower.owner === "player") {
      count += 1;
    }
  }
  return count;
}

function countEnemyTowers(world: World): number {
  let count = 0;
  for (const tower of world.towers) {
    if (tower.owner === "enemy") {
      count += 1;
    }
  }
  return count;
}

function evaluateQuickSimResult(world: World, waveDirector: WaveDirector): MatchResult {
  const playerTowers = countPlayerTowers(world);
  if (playerTowers === 0) {
    return "lose";
  }
  if (countEnemyTowers(world) === 0) {
    return "win";
  }
  if (waveDirector.isFinished()) {
    return "win";
  }
  return null;
}

function runQuickSimAiDecision(world: World, minTroopsToAttack: number): void {
  const candidateSources = world.towers.filter(
    (tower) => tower.owner === "enemy" && tower.troops >= minTroopsToAttack,
  );
  if (candidateSources.length === 0) {
    return;
  }

  let bestSourceId = "";
  let bestTargetId = "";
  let bestScore = Number.POSITIVE_INFINITY;
  let bestKey = "";

  for (const source of candidateSources) {
    for (const neighborId of getNeighbors(world, source.id)) {
      const target = world.getTowerById(neighborId);
      if (!target) {
        continue;
      }
      if (target.owner === source.owner) {
        continue;
      }

      const validation = canCreateLink(world, source.id, target.id, source.owner);
      if (!validation.ok) {
        continue;
      }

      const score =
        Math.hypot(target.x - source.x, target.y - source.y) + 2 * (target.troops + target.hp);
      const key = `${source.id}->${target.id}`;
      if (score < bestScore || (score === bestScore && (bestKey === "" || key < bestKey))) {
        bestScore = score;
        bestSourceId = source.id;
        bestTargetId = target.id;
        bestKey = key;
      }
    }
  }

  if (bestSourceId && bestTargetId) {
    world.setOutgoingLink(bestSourceId, bestTargetId);
  }
}

function getCurrentMission(runState: RunState): RunMissionNode | null {
  if (runState.currentMissionIndex < 0 || runState.currentMissionIndex >= runState.missions.length) {
    return null;
  }
  return runState.missions[runState.currentMissionIndex];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "6px 0";
  return paragraph;
}

function createInfoPill(label: string, value: string): HTMLDivElement {
  const pill = document.createElement("div");
  pill.className = "campaign-info-pill";

  const heading = document.createElement("span");
  heading.className = "campaign-info-pill-label";
  heading.textContent = label;

  const amount = document.createElement("strong");
  amount.className = "campaign-info-pill-value";
  amount.textContent = value;

  pill.append(heading, amount);
  return pill;
}

function createCampaignScreenHeader(title: string, subtitle: string): HTMLElement {
  const header = document.createElement("header");
  header.className = "campaign-screen-header";

  const overline = document.createElement("p");
  overline.className = "campaign-overline";
  overline.textContent = subtitle;

  const heading = document.createElement("h2");
  heading.className = "campaign-screen-title";
  heading.textContent = title;

  header.append(overline, heading);
  return header;
}

function createCampaignProgressCard(input: {
  title: string;
  subtitle: string;
  value: string;
  label: string;
  percent: number;
}): HTMLElement {
  const card = document.createElement("section");
  card.className = "campaign-progress-card";

  const top = document.createElement("div");
  top.className = "campaign-progress-top";

  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.textContent = input.title;
  const subtitle = document.createElement("p");
  subtitle.className = "campaign-progress-subtitle";
  subtitle.textContent = input.subtitle;
  text.append(title, subtitle);

  const valueWrap = document.createElement("div");
  valueWrap.className = "campaign-progress-value";
  valueWrap.textContent = input.value;
  const label = document.createElement("span");
  label.className = "campaign-progress-value-label";
  label.textContent = input.label;
  valueWrap.appendChild(label);

  top.append(text, valueWrap);
  card.appendChild(top);

  const track = document.createElement("div");
  track.className = "campaign-progress-track";
  const fill = document.createElement("div");
  fill.className = "campaign-progress-fill";
  fill.style.width = `${Math.max(0, Math.min(100, input.percent))}%`;
  track.appendChild(fill);
  card.appendChild(track);
  return card;
}

function getMetaTreeAccent(index: number): { primary: string; soft: string; halo: string } {
  const palette = [
    { primary: "#6ea8ff", soft: "rgba(110, 168, 255, 0.24)", halo: "rgba(110, 168, 255, 0.35)" },
    { primary: "#34d399", soft: "rgba(52, 211, 153, 0.24)", halo: "rgba(52, 211, 153, 0.35)" },
    { primary: "#f59e0b", soft: "rgba(245, 158, 11, 0.24)", halo: "rgba(245, 158, 11, 0.35)" },
    { primary: "#c084fc", soft: "rgba(192, 132, 252, 0.24)", halo: "rgba(192, 132, 252, 0.35)" },
  ] as const;
  return palette[index % palette.length];
}

function formatMetaNodeLabel(nodeId: string): string {
  return nodeId
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function createDefaultMissionHudSignals(): MissionHudSignals {
  return {
    waveIndex: 0,
    waveActive: false,
    nextWaveBucket: null,
    objectiveMilestonePct: 0,
    playerTowers: -1,
    enemyTowers: -1,
    clusterBonusActive: false,
    towerCapturePhaseById: {},
    towerOwnerById: {},
  };
}

function resetMissionHudUiState(app: AppState): void {
  app.missionEvents = [];
  app.missionEventSeq = 0;
  app.missionHudSignals = createDefaultMissionHudSignals();
}

function pushMissionEvent(
  app: AppState,
  message: string,
  tone: MissionEventEntry["tone"],
  notifyToast?: (toast: HudToastInput) => void,
): void {
  const entry: MissionEventEntry = {
    id: app.missionEventSeq + 1,
    tone,
    message,
  };
  app.missionEventSeq += 1;
  app.missionEvents = [
    entry,
    ...app.missionEvents,
  ].slice(0, 16);

  if (notifyToast) {
    notifyToast(toMissionToast(entry));
  }
}

function createMissionHudLabel(text: string): HTMLParagraphElement {
  const label = document.createElement("p");
  label.className = "mission-block-label";
  label.textContent = text;
  return label;
}

function createMissionResultStat(label: string, value: string): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "mission-result-stat";

  const title = document.createElement("p");
  title.className = "mission-result-stat-label";
  title.textContent = label;

  const body = document.createElement("p");
  body.className = "mission-result-stat-value";
  body.textContent = value;

  card.append(title, body);
  return card;
}

function getMissionHudTitle(app: AppState): string {
  if (app.activeMissionContext?.mode === "campaign") {
    return app.activeMissionContext.missionName;
  }
  if (app.runState) {
    return `${getCurrentMission(app.runState)?.name ?? "Mission"} (${app.runState.currentMissionIndex + 1}/${app.runState.missions.length})`;
  }
  return "Mission";
}

function getMissionHudObjective(app: AppState): string {
  if (app.activeMissionContext?.mode === "campaign") {
    return app.activeMissionContext.objectiveText;
  }
  return "Survive all scheduled waves and keep at least one tower.";
}

function updateMissionEventFeed(
  app: AppState,
  telemetry: MissionWaveTelemetry | null,
  world: World,
  notifyToast: (toast: HudToastInput) => void,
  towerOverlays: readonly TowerOverlayVM[],
): void {
  if (!telemetry) {
    return;
  }

  const signals = app.missionHudSignals;
  const currentWave = telemetry.currentWaveIndex;
  const waveActive = telemetry.activeWaveInProgress;

  if (signals.waveIndex === 0 && currentWave > 0) {
    pushMissionEvent(app, `Wave ${currentWave} assault detected.`, "warning", notifyToast);
  } else if (currentWave > signals.waveIndex) {
    pushMissionEvent(app, `Wave ${currentWave} assault started.`, "warning", notifyToast);
  } else if (signals.waveActive && !waveActive && currentWave > 0) {
    pushMissionEvent(app, `Wave ${currentWave} cleared.`, "success", notifyToast);
  }

  const nextWaveBucket = getWaveCountdownBucket(telemetry.nextWaveStartsInSec);
  if (nextWaveBucket !== null && nextWaveBucket !== signals.nextWaveBucket) {
    const incomingWave = Math.min(telemetry.totalWaveCount, telemetry.currentWaveIndex + 1);
    pushMissionEvent(
      app,
      `Incoming wave ${incomingWave} in ${Math.ceil(telemetry.nextWaveStartsInSec ?? 0)}s.`,
      "warning",
      notifyToast,
    );
  }

  const completedWaves = telemetry.currentWaveIndex - (telemetry.activeWaveInProgress ? 1 : 0);
  const progressPct = Math.max(0, Math.round((completedWaves / Math.max(1, telemetry.totalWaveCount)) * 100));
  const milestone = progressPct >= 100 ? 100 : progressPct >= 75 ? 75 : progressPct >= 50 ? 50 : progressPct >= 25 ? 25 : 0;
  if (milestone > signals.objectiveMilestonePct) {
    pushMissionEvent(
      app,
      milestone >= 100
        ? "Mission objective complete. All wave goals secured."
        : `Objective progress: ${milestone}% complete.`,
      "success",
      notifyToast,
    );
  }

  let playerTowers = 0;
  let enemyTowers = 0;
  for (const tower of world.towers) {
    if (tower.owner === "player") {
      playerTowers += 1;
    } else if (tower.owner === "enemy") {
      enemyTowers += 1;
    }
  }
  if (signals.playerTowers >= 0 && playerTowers !== signals.playerTowers) {
    const delta = playerTowers - signals.playerTowers;
    pushMissionEvent(
      app,
      delta > 0 ? `Territory gained: +${delta} tower${delta > 1 ? "s" : ""}.` : `Territory lost: ${Math.abs(delta)} tower.`,
      delta > 0 ? "success" : "warning",
      notifyToast,
    );
  }
  if (signals.enemyTowers > 0 && enemyTowers === 0) {
    pushMissionEvent(app, "Enemy tower network collapsed.", "success", notifyToast);
  }

  let clusterBonusActive = false;
  for (const tower of world.towers) {
    if (tower.owner !== "player") {
      continue;
    }
    if ((tower.territoryClusterSize ?? 0) >= 3) {
      clusterBonusActive = true;
      break;
    }
  }
  if (clusterBonusActive && !signals.clusterBonusActive) {
    pushMissionEvent(app, "Cluster bonus online: regen boost activated.", "success", notifyToast);
  }

  emitTowerCaptureTransitionEvents(app, towerOverlays, notifyToast);

  signals.waveIndex = currentWave;
  signals.waveActive = waveActive;
  signals.nextWaveBucket = nextWaveBucket;
  signals.objectiveMilestonePct = Math.max(signals.objectiveMilestonePct, milestone);
  signals.playerTowers = playerTowers;
  signals.enemyTowers = enemyTowers;
  signals.clusterBonusActive = clusterBonusActive;
}

function emitTowerCaptureTransitionEvents(
  app: AppState,
  towerOverlays: readonly TowerOverlayVM[],
  notifyToast: (toast: HudToastInput) => void,
): void {
  const signals = app.missionHudSignals;
  const nextPhaseByTower: Record<string, TowerCapturePhase> = {};
  const nextOwnerByTower: Record<string, Owner> = {};

  for (const tower of towerOverlays) {
    const towerId = tower.towerId;
    const previousPhase = signals.towerCapturePhaseById[towerId];
    const previousOwner = signals.towerOwnerById[towerId];
    const currentPhase = tower.capture.phase;
    const currentOwner = tower.owner;

    if (previousPhase && previousPhase !== "breaching" && currentPhase === "breaching") {
      pushMissionEvent(
        app,
        `Defenders broken at ${towerId}. ${tower.capture.attacker === "player" ? "Finalize takeover." : "Hostile breach underway."}`,
        tower.capture.attacker === "player" ? "success" : "warning",
        notifyToast,
      );
    }

    if (previousOwner && previousOwner !== currentOwner) {
      if (currentOwner === "player") {
        pushMissionEvent(app, `${towerId} captured.`, "success", notifyToast);
      } else if (previousOwner === "player") {
        pushMissionEvent(app, `${towerId} lost to ${describeOwner(currentOwner)}.`, "warning", notifyToast);
      } else {
        pushMissionEvent(app, `${towerId} switched to ${describeOwner(currentOwner)}.`, "neutral", notifyToast);
      }
    }

    nextPhaseByTower[towerId] = currentPhase;
    nextOwnerByTower[towerId] = currentOwner;
  }

  signals.towerCapturePhaseById = nextPhaseByTower;
  signals.towerOwnerById = nextOwnerByTower;
}

function describeOwner(owner: Owner): string {
  if (owner === "player") {
    return "your command";
  }
  if (owner === "enemy") {
    return "enemy command";
  }
  return "neutral control";
}

function toMissionToast(entry: MissionEventEntry): HudToastInput {
  const typeByTone: Record<MissionEventEntry["tone"], HudToastInput["type"]> = {
    neutral: "info",
    warning: "warning",
    success: "success",
  };
  return {
    type: typeByTone[entry.tone],
    title: entry.tone === "warning" ? "Threat Alert" : entry.tone === "success" ? "Tactical Update" : "Command",
    body: entry.message,
    ttl: entry.tone === "warning" ? 2400 : 2200,
  };
}

function getWaveCountdownBucket(nextWaveStartsInSec: number | null): number | null {
  if (nextWaveStartsInSec === null) {
    return null;
  }
  if (nextWaveStartsInSec <= 1.5) {
    return 1;
  }
  if (nextWaveStartsInSec <= 3.5) {
    return 3;
  }
  if (nextWaveStartsInSec <= 5.5) {
    return 5;
  }
  if (nextWaveStartsInSec <= 10.5) {
    return 10;
  }
  return null;
}

function showToast(screenRoot: HTMLDivElement, message: string): void {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.bottom = "24px";
  toast.style.transform = "translateX(-50%)";
  toast.style.padding = "10px 14px";
  toast.style.borderRadius = "10px";
  toast.style.background = "rgba(11, 18, 29, 0.92)";
  toast.style.border = "1px solid rgba(171, 196, 238, 0.35)";
  toast.style.color = "#f8fbff";
  toast.style.fontSize = "13px";
  toast.style.zIndex = "60";
  toast.style.pointerEvents = "none";
  screenRoot.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 1800);
}

function wrapCentered(node: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "centered";
  wrapper.appendChild(node);
  return wrapper;
}

function wrapCenteredModal(node: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "centered centered-modal";
  wrapper.appendChild(node);
  return wrapper;
}

function triggerHotkeyButton(kind: "enter" | "escape", root: HTMLElement): boolean {
  const selector = kind === "enter" ? "[data-hotkey-enter='true']" : "[data-hotkey-escape='true']";
  const candidate = root.querySelector(selector);
  if (!(candidate instanceof HTMLButtonElement) || candidate.disabled) {
    return false;
  }
  candidate.click();
  return true;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target.isContentEditable;
}

function syncDebugIndicator(
  indicator: HTMLDivElement,
  _enabled: boolean,
  debugState: DebugUiState,
): void {
  indicator.style.display = "none";
  indicator.classList.toggle("open", debugState.debugOpen);
  indicator.textContent = debugState.debugOpen ? "DEBUG • OPEN" : "DEBUG";
}

function getCanvas(): HTMLCanvasElement {
  const element = document.getElementById("gameCanvas");
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error('Canvas "#gameCanvas" was not found');
  }
  return element;
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D rendering context is unavailable");
  }
  return ctx;
}

function getScreenRoot(): HTMLDivElement {
  const element = document.getElementById("screenRoot");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error('Container "#screenRoot" was not found');
  }
  return element;
}

function getDebugPanel(): HTMLDivElement {
  const element = document.getElementById("debugPanel");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error('Container "#debugPanel" was not found');
  }
  return element;
}

function getDebugIndicator(): HTMLDivElement {
  const element = document.getElementById("debugIndicator");
  if (!(element instanceof HTMLDivElement)) {
    throw new Error('Container "#debugIndicator" was not found');
  }
  return element;
}

function resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

if (import.meta.env.DEV) {
  if (createDefaultMetaProfile().schemaVersion <= 0) {
    throw new Error("Invalid default meta profile schema");
  }
}
