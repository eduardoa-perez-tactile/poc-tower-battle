import { Game, type MatchResult } from "./game/Game";
import {
  DIFFICULTY_TIER_IDS,
  DEFAULT_DIFFICULTY_TIER,
  type DifficultyTierId,
} from "./config/Difficulty";
import { loadLevel, type LoadedLevel } from "./game/LevelLoader";
import { InputController } from "./input/InputController";
import { BALANCE_CONFIG } from "./meta/BalanceConfig";
import {
  computeMetaModifiers,
  getNextUpgradeCost,
  getUpgradeLevel,
  loadMetaUpgradeCatalog,
  purchaseUpgrade,
  refreshUnlocks,
  type MetaUpgradeDefinition,
} from "./meta/MetaProgression";
import { calculateMissionGloryReward, calculateRunBonusGlory, type MissionGloryReward } from "./meta/Rewards";
import { Renderer2D } from "./render/Renderer2D";
import { loadMissionCatalog, createRunState, type MissionTemplate } from "./run/RunGeneration";
import {
  createDefaultMetaProfile,
  type MetaProfile,
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
import { updateWorld as updateQuickSimWorld } from "./sim/Simulation";
import { World } from "./sim/World";
import type { TowerArchetypeCatalog } from "./sim/DepthTypes";
import type { BalanceBaselinesConfig, DifficultyTierConfig } from "./waves/Definitions";
import { loadWaveContent } from "./waves/Definitions";
import { WaveDirector } from "./waves/WaveDirector";

type Screen = "main-menu" | "meta" | "run-map" | "mission" | "run-summary";

interface AppState {
  screen: Screen;
  metaProfile: MetaProfile;
  runState: RunState | null;
  runSummary: RunSummary | null;
  game: Game | null;
  inputController: InputController | null;
  missionResult: MatchResult;
  missionReward: MissionGloryReward | null;
  balanceDiagnosticsEnabled: boolean;
}

const DEBUG_TOOLS_ENABLED = true;
void bootstrap();

async function bootstrap(): Promise<void> {
  const canvas = getCanvas();
  const ctx = getContext(canvas);
  const renderer = new Renderer2D(canvas, ctx);
  const restartBtn = getRestartButton();
  const screenRoot = getScreenRoot();
  const debugPanel = getDebugPanel();
  const levelCache = new Map<string, LoadedLevel>();

  const resize = () => resizeCanvas(canvas, ctx);
  window.addEventListener("resize", resize);
  resize();

  const [missionTemplates, upgradeCatalog, waveContent, depthContent] = await Promise.all([
    loadMissionCatalog(),
    loadMetaUpgradeCatalog(),
    loadWaveContent(),
    loadDepthContent(),
  ]);

  const app: AppState = {
    screen: "main-menu",
    metaProfile: loadMetaProfile(),
    runState: loadRunState(),
    runSummary: null,
    game: null,
    inputController: null,
    missionResult: null,
    missionReward: null,
    balanceDiagnosticsEnabled: DEBUG_TOOLS_ENABLED,
  };

  if (app.runState && !DIFFICULTY_TIER_IDS.includes(app.runState.runModifiers.tier)) {
    app.runState.runModifiers.tier = DEFAULT_DIFFICULTY_TIER;
    saveRunState(app.runState);
  }

  const render = (): void => {
    renderCurrentScreen(
      app,
      screenRoot,
      upgradeCatalog,
      missionTemplates,
      startNewRun,
      continueRun,
      openMetaScreen,
      openMainMenu,
      openRunMap,
      startCurrentMission,
      restartCurrentMission,
      abandonRun,
      purchaseUpgradeById,
      finalizeRun,
      closeSummaryToMenu,
    );
    renderDebugPanel(
      debugPanel,
      app,
      addDebugGlory,
      resetMeta,
      forceMissionWin,
      forceMissionLose,
      debugSpawnEnemy,
      debugStartWave,
      toggleBalanceDiagnostics,
      runQuickSimDebug,
    );
    syncRestartButton(restartBtn, app, restartCurrentMission);
  };

  const openMainMenu = (): void => {
    stopMission();
    app.screen = "main-menu";
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

  const continueRun = (): void => {
    if (!app.runState) {
      return;
    }
    openRunMap();
  };

  const startNewRun = (): void => {
    stopMission();
    const seed = Math.floor(Date.now() % 2147483647);
    const bonuses = computeMetaModifiers(app.metaProfile, upgradeCatalog);
    const runState = createRunState(seed, missionTemplates, bonuses);
    app.metaProfile.stats.runsPlayed += 1;
    app.runState = runState;
    app.runSummary = null;
    saveMetaProfile(app.metaProfile);
    saveRunState(runState);
    app.screen = "run-map";
    render();
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
    const baseLevel = await getLevelByPath(mission.levelPath, levelCache);
    const tunedLevel = createMissionLevel(
      baseLevel,
      mission,
      app.runState.startingBonuses,
      depthContent.towerArchetypes,
      waveContent.balanceBaselines,
      waveContent.difficultyTiers.difficultyTiers[app.runState.runModifiers.tier],
    );
    const missionDifficultyScalar = mission.difficulty * app.runState.runModifiers.difficulty;
    const world = new World(
      tunedLevel.towers,
      tunedLevel.rules.maxOutgoingLinksPerTower,
      depthContent.linkLevels,
      tunedLevel.initialLinks,
    );
    const waveDirector = new WaveDirector(world, waveContent, {
      runSeed: app.runState.seed + app.runState.currentMissionIndex * 911,
      missionDifficultyScalar,
      difficultyTier: app.runState.runModifiers.tier,
      balanceDiagnosticsEnabled: app.balanceDiagnosticsEnabled,
    });

    const inputController = new InputController(canvas, world);
    app.inputController = inputController;
    app.game = new Game(world, renderer, inputController, tunedLevel.rules, tunedLevel.ai, waveDirector);
    app.missionResult = null;
    app.missionReward = null;
    app.screen = "mission";
    saveRunState(app.runState);
    render();
  };

  const handleMissionResult = (): void => {
    if (!app.game || !app.runState || app.missionResult) {
      return;
    }

    const result = app.game.getMatchResult();
    if (!result) {
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
      app.runState.startingBonuses.goldEarnedMultiplier,
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
      runState.startingBonuses.goldEarnedMultiplier,
      getDifficultyGloryMultiplier(waveContent.balanceBaselines, tierConfig, tier),
    );
    app.metaProfile.glory += runBonusGlory;
    app.metaProfile.stats.bestMissionIndex = Math.max(
      app.metaProfile.stats.bestMissionIndex,
      missionsCompleted,
    );
    app.metaProfile.stats.bestWave = Math.max(app.metaProfile.stats.bestWave, missionsCompleted * 10);
    if (won) {
      app.metaProfile.stats.wins += 1;
    } else {
      app.metaProfile.stats.losses += 1;
    }
    const unlockNotifications = refreshUnlocks(app.metaProfile);
    saveMetaProfile(app.metaProfile);

    app.runSummary = {
      runId: runState.runId,
      won,
      missionsCompleted,
      missionGlory: runState.runGloryEarned,
      runBonusGlory,
      totalGloryEarned: runState.runGloryEarned + runBonusGlory,
      difficultyTier: tier,
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
    if (app.screen !== "mission" || !app.runState) {
      return;
    }
    void startCurrentMission();
  };

  const purchaseUpgradeById = (upgradeId: string): void => {
    const result = purchaseUpgrade(app.metaProfile, upgradeCatalog, upgradeId);
    if (!result.ok) {
      render();
      return;
    }

    refreshUnlocks(app.metaProfile);
    saveMetaProfile(app.metaProfile);
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

  const runQuickSimDebug = (): void => {
    void runQuickSim(24);
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
    const missionDifficultyScalar = mission.difficulty * app.runState.runModifiers.difficulty;
    const fixedSeedBase = 13371337;
    const maxWaves = waveContent.balance.totalWaveCount;
    const towersOwnedCurveTotals = new Array<number>(maxWaves).fill(0);
    const gloryCurveTotals = new Array<number>(maxWaves).fill(0);

    let wins = 0;
    let totalWaveDurationSec = 0;
    let completedRuns = 0;

    const baseLevel = await getLevelByPath(mission.levelPath, levelCache);
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const level = createMissionLevel(
        baseLevel,
        mission,
        app.runState.startingBonuses,
        depthContent.towerArchetypes,
        waveContent.balanceBaselines,
        tierConfig,
      );
      const world = new World(
        level.towers,
        level.rules.maxOutgoingLinksPerTower,
        depthContent.linkLevels,
        level.initialLinks,
      );
      const waveDirector = new WaveDirector(world, waveContent, {
        runSeed: fixedSeedBase + runIndex * 101,
        missionDifficultyScalar,
        difficultyTier: tierId,
        balanceDiagnosticsEnabled: false,
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
    app.missionResult = null;
    app.missionReward = null;
  };

  window.addEventListener("keydown", (event) => {
    if (event.key === "r" || event.key === "R") {
      restartCurrentMission();
    }
    if (!DEBUG_TOOLS_ENABLED) {
      return;
    }
    if (event.key === "g" || event.key === "G") {
      addDebugGlory();
    }
    if (event.key === "1") {
      forceMissionWin();
    }
    if (event.key === "2") {
      forceMissionLose();
    }
  });

  render();

  let lastTimeSec = performance.now() / 1000;
  const loop = (timeMs: number): void => {
    const nowSec = timeMs / 1000;
    const dtSec = nowSec - lastTimeSec;
    lastTimeSec = nowSec;

    if (app.game) {
      app.game.frame(dtSec);
      handleMissionResult();
      syncMissionHud(app);
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function renderCurrentScreen(
  app: AppState,
  screenRoot: HTMLDivElement,
  upgradeCatalog: MetaUpgradeDefinition[],
  missionTemplates: MissionTemplate[],
  startNewRun: () => void,
  continueRun: () => void,
  openMetaScreen: () => void,
  openMainMenu: () => void,
  openRunMap: () => void,
  startCurrentMission: () => Promise<void>,
  restartCurrentMission: () => void,
  abandonRun: () => void,
  purchaseUpgradeById: (upgradeId: string) => void,
  finalizeRun: (won: boolean) => void,
  closeSummaryToMenu: () => void,
): void {
  screenRoot.replaceChildren();

  if (app.screen === "main-menu") {
    const panel = createPanel("Tower Battle: Connect Towers");
    panel.classList.add("centered");
    panel.appendChild(createParagraph(`Glory: ${app.metaProfile.glory}`));
    panel.appendChild(createParagraph(`Mission Templates: ${missionTemplates.length}`));
    panel.appendChild(createButton("Start New Run", startNewRun));
    const continueBtn = createButton("Continue Run", continueRun);
    continueBtn.disabled = !app.runState;
    panel.appendChild(continueBtn);
    panel.appendChild(createButton("Meta Progression", openMetaScreen));
    if (app.runState) {
      panel.appendChild(createParagraph(`In progress run: ${app.runState.runId}`));
    }
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "meta") {
    const panel = createPanel("Meta Progression");
    panel.classList.add("centered");
    panel.appendChild(createParagraph(`Glory: ${app.metaProfile.glory}`));
    panel.appendChild(
      createParagraph(
        `Runs: ${app.metaProfile.stats.runsPlayed} | Wins: ${app.metaProfile.stats.wins} | Best Mission: ${app.metaProfile.stats.bestMissionIndex}`,
      ),
    );

    const list = document.createElement("div");
    list.className = "list";
    for (const upgrade of upgradeCatalog) {
      const level = getUpgradeLevel(app.metaProfile, upgrade.id);
      const cost = getNextUpgradeCost(app.metaProfile, upgrade);
      const row = document.createElement("div");
      row.className = "meta-row";

      const left = document.createElement("div");
      left.textContent = `${upgrade.name} Lv ${level}/${upgrade.maxLevel}`;
      const details = document.createElement("div");
      details.style.fontSize = "12px";
      details.style.opacity = "0.8";
      details.textContent = upgrade.description;
      left.appendChild(details);

      const buyBtn = createButton(
        cost === null ? "Maxed" : `Buy (${cost})`,
        () => purchaseUpgradeById(upgrade.id),
      );
      buyBtn.disabled = cost === null || app.metaProfile.glory < cost;
      row.append(left, buyBtn);
      list.appendChild(row);
    }
    panel.appendChild(list);

    panel.appendChild(createButton("Back", app.runState ? openRunMap : openMainMenu));
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "run-map") {
    const panel = createPanel("Run Map");
    panel.classList.add("centered");
    if (!app.runState) {
      panel.appendChild(createParagraph("No run in progress."));
      panel.appendChild(createButton("Back to Menu", openMainMenu));
      screenRoot.appendChild(wrapCentered(panel));
      return;
    }

    panel.appendChild(createParagraph(`Run ID: ${app.runState.runId}`));
    panel.appendChild(createParagraph(`Seed: ${app.runState.seed}`));
    panel.appendChild(createParagraph(`Difficulty Tier: ${app.runState.runModifiers.tier}`));
    panel.appendChild(createParagraph(`Current Mission: ${app.runState.currentMissionIndex + 1}/${app.runState.missions.length}`));

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
    panel.appendChild(difficultyRow);

    const list = document.createElement("div");
    list.className = "list";
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
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${status} • x${mission.difficulty.toFixed(2)} • ${app.runState!.runModifiers.tier}`;
      label.appendChild(badge);
      row.appendChild(label);
      list.appendChild(row);
    });
    panel.appendChild(list);

    const deployBtn = createButton("Deploy Mission", () => {
      void startCurrentMission();
    });
    const runFinished = app.runState.currentMissionIndex >= app.runState.missions.length;
    deployBtn.disabled = runFinished;
    panel.appendChild(deployBtn);
    panel.appendChild(createButton("Meta Progression", openMetaScreen));
    panel.appendChild(createButton("Abandon Run", abandonRun));
    panel.appendChild(createButton("Main Menu", openMainMenu));
    screenRoot.appendChild(wrapCentered(panel));
    return;
  }

  if (app.screen === "mission") {
    const hud = createPanel("Mission");
    hud.style.position = "absolute";
    hud.style.right = "12px";
    hud.style.bottom = "12px";
    hud.style.maxWidth = "390px";

    if (app.runState) {
      const mission = getCurrentMission(app.runState);
      if (mission) {
        hud.appendChild(
          createParagraph(
            `${mission.name} (${app.runState.currentMissionIndex + 1}/${app.runState.missions.length}) • Difficulty x${mission.difficulty.toFixed(2)} • ${app.runState.runModifiers.tier}`,
          ),
        );
      }
    }
    hud.appendChild(createParagraph("Drag from player towers to direct links."));
    hud.appendChild(createParagraph("Wave telemetry updates in real time."));

    const waveStatus = createParagraph("Wave: --");
    waveStatus.id = "missionWaveStatus";
    hud.appendChild(waveStatus);

    const modifiers = createParagraph("Modifiers: --");
    modifiers.id = "missionWaveModifiers";
    hud.appendChild(modifiers);

    const gold = createParagraph("Gold: 0");
    gold.id = "missionWaveGold";
    hud.appendChild(gold);

    const buff = createParagraph("Buff: none");
    buff.id = "missionWaveBuff";
    hud.appendChild(buff);

    if (DEBUG_TOOLS_ENABLED) {
      const balanceDebug = createParagraph("Balance: diagnostics off");
      balanceDebug.id = "missionBalanceDebug";
      balanceDebug.style.fontSize = "12px";
      balanceDebug.style.opacity = "0.9";
      hud.appendChild(balanceDebug);
    }

    const previewLabel = createParagraph("Upcoming:");
    previewLabel.style.marginBottom = "4px";
    hud.appendChild(previewLabel);
    const preview = document.createElement("div");
    preview.id = "missionWavePreview";
    preview.className = "list";
    preview.style.gap = "4px";
    hud.appendChild(preview);

    if (app.missionResult) {
      const resultPanel = createPanel(app.missionResult === "win" ? "Mission Victory" : "Mission Defeat");
      resultPanel.classList.add("centered");
      const rewardValue = app.missionReward ? app.missionReward.total : 0;
      resultPanel.appendChild(createParagraph(`Glory earned this mission: ${rewardValue}`));

      if (app.missionResult === "win" && app.runState && app.runState.currentMissionIndex < app.runState.missions.length) {
        resultPanel.appendChild(createButton("Continue To Run Map", openRunMap));
      } else {
        resultPanel.appendChild(
          createButton("Open Run Summary", () => {
            if (app.missionResult === "win") {
              finalizeRun(true);
            } else {
              finalizeRun(false);
            }
          }),
        );
      }
      const canRestartMission =
        !(app.missionResult === "win" && app.runState && app.runState.currentMissionIndex < app.runState.missions.length);
      if (canRestartMission) {
        resultPanel.appendChild(createButton("Restart Mission", restartCurrentMission));
      }
      screenRoot.appendChild(wrapCentered(resultPanel));
    }

    screenRoot.appendChild(hud);
    return;
  }

  if (app.screen === "run-summary") {
    const panel = createPanel("End of Run Summary");
    panel.classList.add("centered");
    if (!app.runSummary) {
      panel.appendChild(createParagraph("No summary data."));
      panel.appendChild(createButton("Back to Menu", closeSummaryToMenu));
      screenRoot.appendChild(wrapCentered(panel));
      return;
    }

    panel.appendChild(createParagraph(app.runSummary.won ? "Run Result: Victory" : "Run Result: Defeat"));
    panel.appendChild(createParagraph(`Missions completed: ${app.runSummary.missionsCompleted}`));
    panel.appendChild(createParagraph(`Mission Glory: ${app.runSummary.missionGlory}`));
    panel.appendChild(createParagraph(`Run Bonus Glory: ${app.runSummary.runBonusGlory}`));
    panel.appendChild(createParagraph(`Total Glory Earned: ${app.runSummary.totalGloryEarned}`));
    panel.appendChild(createParagraph(`Difficulty Tier: ${app.runSummary.difficultyTier}`));
    panel.appendChild(
      createParagraph(
        `Applied Multipliers: enemy HP x${app.runSummary.appliedDifficultyMultipliers.enemyHpMul.toFixed(2)}, enemy DMG x${app.runSummary.appliedDifficultyMultipliers.enemyDmgMul.toFixed(2)}, economy Glory x${app.runSummary.appliedDifficultyMultipliers.economyGloryMul.toFixed(2)}`,
      ),
    );

    if (app.runSummary.unlockNotifications.length > 0) {
      panel.appendChild(createParagraph("New unlocks:"));
      const unlockList = document.createElement("div");
      unlockList.className = "list";
      for (const unlock of app.runSummary.unlockNotifications) {
        unlockList.appendChild(createParagraph(`• ${unlock}`));
      }
      panel.appendChild(unlockList);
    }

    panel.appendChild(createButton("Back to Main Menu", closeSummaryToMenu));
    screenRoot.appendChild(wrapCentered(panel));
  }
}

function syncMissionHud(app: AppState): void {
  if (app.screen !== "mission" || !app.game || app.missionResult) {
    return;
  }

  const telemetry = app.game.getWaveTelemetry();
  if (!telemetry) {
    return;
  }

  const waveStatus = document.getElementById("missionWaveStatus");
  if (waveStatus instanceof HTMLParagraphElement) {
    waveStatus.textContent = `Wave: ${telemetry.currentWaveIndex}/${telemetry.totalWaveCount}`;
  }

  const modifiers = document.getElementById("missionWaveModifiers");
  if (modifiers instanceof HTMLParagraphElement) {
    modifiers.textContent =
      telemetry.activeModifierNames.length > 0
        ? `Modifiers: ${telemetry.activeModifierNames.join(", ")}`
        : "Modifiers: none";
  }

  const gold = document.getElementById("missionWaveGold");
  if (gold instanceof HTMLParagraphElement) {
    gold.textContent = `Gold: ${telemetry.missionGold}`;
  }

  const buff = document.getElementById("missionWaveBuff");
  if (buff instanceof HTMLParagraphElement) {
    buff.textContent = telemetry.activeBuffId
      ? `Buff: ${telemetry.activeBuffId} (${telemetry.activeBuffRemainingSec.toFixed(1)}s)`
      : "Buff: none";
  }

  const balanceDebug = document.getElementById("missionBalanceDebug");
  if (balanceDebug instanceof HTMLParagraphElement) {
    if (!app.balanceDiagnosticsEnabled) {
      balanceDebug.textContent = "Balance: diagnostics off";
    } else {
      const timeToZero =
        telemetry.timeToZeroTowersEstimateSec === null
          ? "∞"
          : `${telemetry.timeToZeroTowersEstimateSec.toFixed(1)}s`;
      balanceDebug.textContent =
        `Balance: ${telemetry.difficultyTier} | pressure ${telemetry.wavePressureScore.toFixed(1)} | ` +
        `towers ${telemetry.playerTowersOwned} | avg troops ${telemetry.avgTroopsPerOwnedTower.toFixed(1)} | ` +
        `pkt/s ${telemetry.packetsSentPerSec.toFixed(2)} | ttz ${timeToZero}`;
    }
  }

  const preview = document.getElementById("missionWavePreview");
  if (preview instanceof HTMLDivElement) {
    const signature = telemetry.nextWavePreview
      .map((item) => `${item.enemyId}:${item.count}`)
      .join("|");
    if (preview.dataset.signature !== signature) {
      preview.dataset.signature = signature;
      preview.replaceChildren();

      if (telemetry.nextWavePreview.length === 0) {
        const empty = createParagraph("No upcoming spawns.");
        empty.style.opacity = "0.8";
        preview.appendChild(empty);
        return;
      }

      for (const item of telemetry.nextWavePreview) {
        const row = createParagraph(`${item.icon} ${item.enemyId} x${item.count}`);
        row.style.margin = "2px 0";
        preview.appendChild(row);
      }
    }
  }
}

function renderDebugPanel(
  debugPanel: HTMLDivElement,
  app: AppState,
  addDebugGlory: () => void,
  resetMeta: () => void,
  forceMissionWin: () => void,
  forceMissionLose: () => void,
  debugSpawnEnemy: (enemyId: string, elite: boolean) => void,
  debugStartWave: (waveIndex: number) => void,
  toggleBalanceDiagnostics: () => void,
  runQuickSimDebug: () => void,
): void {
  debugPanel.replaceChildren();
  if (!DEBUG_TOOLS_ENABLED) {
    return;
  }

  debugPanel.appendChild(createButton("Debug: +250 Glory", addDebugGlory));
  debugPanel.appendChild(createButton("Debug: Reset Meta", resetMeta));
  const canForceEnd = app.screen === "mission" && app.game !== null && app.missionResult === null;
  const forceWinBtn = createButton("Debug: Mission Win", forceMissionWin);
  forceWinBtn.disabled = !canForceEnd;
  debugPanel.appendChild(forceWinBtn);
  const forceLoseBtn = createButton("Debug: Mission Lose", forceMissionLose);
  forceLoseBtn.disabled = !canForceEnd;
  debugPanel.appendChild(forceLoseBtn);
  const balanceBtn = createButton(
    app.balanceDiagnosticsEnabled ? "Debug: Balance HUD ON" : "Debug: Balance HUD OFF",
    toggleBalanceDiagnostics,
  );
  debugPanel.appendChild(balanceBtn);
  const quickSimBtn = createButton("Debug: Quick Sim x24", runQuickSimDebug);
  quickSimBtn.disabled = app.runState === null;
  debugPanel.appendChild(quickSimBtn);

  if (!app.game || app.screen !== "mission" || app.missionResult !== null) {
    return;
  }

  const enemyIds = app.game.getDebugEnemyIds();
  if (enemyIds.length > 0) {
    const spawnContainer = document.createElement("div");
    spawnContainer.className = "panel";
    spawnContainer.style.padding = "8px";
    spawnContainer.style.display = "grid";
    spawnContainer.style.gap = "6px";

    const select = document.createElement("select");
    for (const enemyId of enemyIds) {
      const option = document.createElement("option");
      option.value = enemyId;
      option.textContent = enemyId;
      select.appendChild(option);
    }

    const eliteLabel = document.createElement("label");
    eliteLabel.style.display = "flex";
    eliteLabel.style.gap = "6px";
    eliteLabel.style.alignItems = "center";
    const eliteCheckbox = document.createElement("input");
    eliteCheckbox.type = "checkbox";
    eliteLabel.append(eliteCheckbox, document.createTextNode("Elite"));

    const spawnBtn = createButton("Debug: Spawn Enemy", () => {
      debugSpawnEnemy(select.value, eliteCheckbox.checked);
    });

    spawnContainer.append(select, eliteLabel, spawnBtn);
    debugPanel.appendChild(spawnContainer);
  }

  const maxWaveIndex = app.game.getDebugMaxWaveIndex();
  if (maxWaveIndex > 0) {
    const waveContainer = document.createElement("div");
    waveContainer.className = "panel";
    waveContainer.style.padding = "8px";
    waveContainer.style.display = "grid";
    waveContainer.style.gap = "6px";

    const waveSelect = document.createElement("select");
    for (let i = 1; i <= maxWaveIndex; i += 1) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = `Wave ${i}`;
      waveSelect.appendChild(option);
    }

    const waveBtn = createButton("Debug: Start Wave", () => {
      debugStartWave(Number.parseInt(waveSelect.value, 10));
    });

    waveContainer.append(waveSelect, waveBtn);
    debugPanel.appendChild(waveContainer);
  }
}

function syncRestartButton(
  restartBtn: HTMLButtonElement,
  app: AppState,
  restartCurrentMission: () => void,
): void {
  const missionActive = app.screen === "mission" && app.runState !== null;
  restartBtn.style.display = missionActive ? "inline-block" : "none";
  restartBtn.onclick = missionActive ? () => restartCurrentMission() : null;
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
  };
}

function createMissionLevel(
  baseLevel: LoadedLevel,
  mission: RunMissionNode,
  bonuses: RunState["startingBonuses"],
  towerArchetypes: TowerArchetypeCatalog,
  baselines: BalanceBaselinesConfig,
  difficultyTier: DifficultyTierConfig,
): LoadedLevel {
  const level = cloneLoadedLevel(baseLevel);
  applyBalanceBaselinesToLevelRules(level, baselines, difficultyTier);

  const regenCaps = baselines.troopRegen.globalRegenCaps;
  const defenseCaps = baselines.towerTroops.defenseMultipliersCaps;
  const troopCapMax = baselines.towerTroops.baseMaxTroops * 2;

  for (const tower of level.towers) {
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
    tower.regenRate = clamp(tower.regenRate * difficultyTier.player.regenMul, regenCaps.min, regenCaps.max);
  }

  const troopBonus = bonuses.startingGold / BALANCE_CONFIG.conversion.startingGoldToTroopsRatio;
  if (troopBonus > 0 && playerTowers.length > 0) {
    const perTowerBonus = troopBonus / playerTowers.length;
    for (const tower of playerTowers) {
      tower.troops = Math.min(tower.maxTroops, tower.troops + perTowerBonus);
    }
  }

  for (const tower of playerTowers) {
    tower.troops = Math.min(tower.maxTroops, tower.troops * difficultyTier.player.startingTroopsMul);
  }

  grantAdditionalStartingTowers(level, difficultyTier.player.startingTowersAdd, baselines);

  if (bonuses.strongholdStartLevel >= 2 && playerTowers.length > 0) {
    const stronghold = playerTowers[0];
    stronghold.maxHp *= 1.15;
    stronghold.hp = Math.min(stronghold.maxHp, stronghold.hp + stronghold.maxHp * 0.1);
    stronghold.troops = Math.min(stronghold.maxTroops, stronghold.troops + 8);
    stronghold.regenRate += 0.5;
  }

  for (const tower of enemyTowers) {
    tower.maxHp *= mission.difficulty;
    tower.hp = Math.min(tower.maxHp, tower.hp * mission.difficulty);
    tower.maxTroops *= mission.difficulty;
    tower.troops = Math.min(tower.maxTroops, tower.troops * mission.difficulty);
    tower.regenRate *= 1 + (mission.difficulty - 1) * 0.4;
  }

  level.ai.aiMinTroopsToAttack = Math.max(5, level.ai.aiMinTroopsToAttack / mission.difficulty);
  return level;
}

function applyBalanceBaselinesToLevelRules(
  level: LoadedLevel,
  baselines: BalanceBaselinesConfig,
  difficultyTier: DifficultyTierConfig,
): void {
  level.rules.captureSeedTroops = baselines.towerTroops.captureSeedTroops;
  level.rules.captureRateMultiplier = baselines.towerTroops.captureRateMultiplier;
  level.rules.regenMinPerSec = baselines.troopRegen.globalRegenCaps.min;
  level.rules.regenMaxPerSec = baselines.troopRegen.globalRegenCaps.max;
  level.rules.defaultPacketArmor = baselines.packets.baseArmor;
  level.rules.packetStatCaps = { ...baselines.packets.globalCaps };
  level.rules.fightModel = {
    shieldArmorUptimeMultiplier: baselines.packets.fightResolutionModelParams.shieldArmorUptimeMultiplier,
    combatHoldFactor: baselines.packets.fightResolutionModelParams.combatHoldFactor,
    rangedHoldFactor: baselines.packets.fightResolutionModelParams.rangedHoldFactor,
    linkCutterHoldFactor: baselines.packets.fightResolutionModelParams.linkCutterHoldFactor,
  };
  level.rules.defaultUnit.speedPxPerSec = baselines.packets.baseSpeed * difficultyTier.player.packetSpeedMul;
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

function countPlayerTowers(world: World): number {
  let count = 0;
  for (const tower of world.towers) {
    if (tower.owner === "player") {
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
  if (waveDirector.isFinished()) {
    return "win";
  }
  return null;
}

function runQuickSimAiDecision(world: World, minTroopsToAttack: number): void {
  const playerTowers = world.towers.filter((tower) => tower.owner === "player");
  if (playerTowers.length === 0) {
    return;
  }

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
    for (const target of playerTowers) {
      if (target.id === source.id) {
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

function createPanel(title: string): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel";
  const heading = document.createElement("h2");
  heading.textContent = title;
  heading.style.marginTop = "0";
  panel.appendChild(heading);
  return panel;
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "6px 0";
  return paragraph;
}

function wrapCentered(node: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "centered";
  wrapper.appendChild(node);
  return wrapper;
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

function getRestartButton(): HTMLButtonElement {
  const element = document.getElementById("restartBtn");
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error('Button "#restartBtn" was not found');
  }
  return element;
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
