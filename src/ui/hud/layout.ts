export const EDGE_PAD = 16;
export const PANEL_GAP = 12;
export const RIGHT_COL_WIDTH = 320;
export const MAX_ALERTS_VISIBLE = 3;
export const MAX_ALERT_STACK_HEIGHT_VH = 18;
export const MAP_SAFE_MARGIN_RIGHT = RIGHT_COL_WIDTH + EDGE_PAD;

const RIGHT_COL_MIN = 280;
const RIGHT_COL_MAX = 360;
const TOP_BAR_OFFSET = 58;

export interface HudLayoutRuntime {
  viewportW: number;
  viewportH: number;
  edgePad: number;
  panelGap: number;
  rightWidth: number;
  maxAlertsVisible: number;
  maxAlertStackHeightVh: number;
  mapSafeMarginRight: number;
  runIntelCompact: boolean;
  runIntelAutoCollapseSections: boolean;
  towerCenterMode: boolean;
  towerForceCompact: boolean;
  topZoneTopPx: number;
  runIntelTopPx: number;
  towerBottomPx: number;
}

export function computeHudLayout(viewportW: number, viewportH: number): HudLayoutRuntime {
  // Central HUD layout policy: keep gameplay center clear while right-side panels remain compact.
  const safeW = Math.max(320, Math.floor(viewportW));
  const safeH = Math.max(320, Math.floor(viewportH));
  const isNarrow = safeW < 1100;
  const isVeryNarrow = safeW < 900;
  const edgePad = safeW < 960 ? 10 : EDGE_PAD;
  const rightWidth = clamp(safeW * (isNarrow ? 0.2 : 0.22), RIGHT_COL_MIN, RIGHT_COL_MAX);
  const maxAlertsVisible = isNarrow ? 2 : MAX_ALERTS_VISIBLE;
  const towerCenterMode = isVeryNarrow;
  const towerForceCompact = safeH < 760 || isVeryNarrow;

  return {
    viewportW: safeW,
    viewportH: safeH,
    edgePad,
    panelGap: PANEL_GAP,
    rightWidth,
    maxAlertsVisible,
    maxAlertStackHeightVh: MAX_ALERT_STACK_HEIGHT_VH,
    mapSafeMarginRight: rightWidth + edgePad,
    runIntelCompact: isNarrow,
    runIntelAutoCollapseSections: isNarrow,
    towerCenterMode,
    towerForceCompact,
    topZoneTopPx: edgePad,
    runIntelTopPx: edgePad + TOP_BAR_OFFSET,
    towerBottomPx: towerCenterMode ? edgePad + 112 : edgePad,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
