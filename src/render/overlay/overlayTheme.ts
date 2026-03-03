import type { Owner } from "../../sim/World";

interface OwnerColorSet {
  ring: string;
  glow: string;
  badgeFill: string;
  badgeText: string;
  link: string;
  linkOutline: string;
  flow: string;
}

export interface OverlayTheme {
  fontFamily: string;
  ownerColors: Record<Owner, OwnerColorSet>;
  ring: {
    baseRadiusPx: number;
    baseWidthPx: number;
    hoverExtraWidthPx: number;
    selectedExtraWidthPx: number;
    contestedDash: readonly [number, number];
    neutralDash: readonly [number, number];
    glowWidthPx: number;
    selectionWedgeSizePx: number;
  };
  badge: {
    fontSizePx: number;
    fontWeight: string;
    paddingXPx: number;
    paddingYPx: number;
    cornerRadiusPx: number;
    outlineColor: string;
    outlineWidthPx: number;
    anchorOffsetXPx: number;
    anchorOffsetYPx: number;
    jitterRadiusPx: number;
    regenTextColor: string;
  };
  link: {
    widthPx: number;
    outlineWidthPx: number;
    arrowSizePx: number;
    levelFontSizePx: number;
    flowMarkerSpacingPx: number;
    flowMarkerSizePx: number;
    flowSpeed: number;
  };
  affordance: {
    validRingColor: string;
    invalidRingColor: string;
    invalidCrossColor: string;
    suggestedLineColor: string;
    suggestedLineWidthPx: number;
  };
  legend: {
    bgColor: string;
    borderColor: string;
    textColor: string;
    titleColor: string;
    fontSizePx: number;
  };
  animation: {
    pulseHz: number;
    contestedDashSpeed: number;
  };
}

// Readability tuning lives here; adjust colors/sizes without touching draw logic.
export const OVERLAY_THEME: OverlayTheme = {
  fontFamily: "Arial, sans-serif",
  ownerColors: {
    player: {
      ring: "rgba(96, 235, 210, 0.95)",
      glow: "rgba(96, 235, 210, 0.35)",
      badgeFill: "rgba(14, 36, 33, 0.86)",
      badgeText: "#d5fff6",
      link: "rgba(124, 241, 222, 0.92)",
      linkOutline: "rgba(6, 17, 16, 0.85)",
      flow: "rgba(208, 255, 246, 0.95)",
    },
    enemy: {
      ring: "rgba(255, 112, 120, 0.96)",
      glow: "rgba(255, 112, 120, 0.33)",
      badgeFill: "rgba(51, 12, 16, 0.88)",
      badgeText: "#ffd8db",
      link: "rgba(255, 126, 136, 0.9)",
      linkOutline: "rgba(26, 7, 8, 0.85)",
      flow: "rgba(255, 221, 224, 0.95)",
    },
    neutral: {
      ring: "rgba(220, 226, 232, 0.9)",
      glow: "rgba(220, 226, 232, 0.28)",
      badgeFill: "rgba(20, 23, 26, 0.8)",
      badgeText: "#eef1f4",
      link: "rgba(173, 181, 189, 0.88)",
      linkOutline: "rgba(8, 10, 12, 0.76)",
      flow: "rgba(242, 247, 250, 0.9)",
    },
  },
  ring: {
    baseRadiusPx: 34,
    baseWidthPx: 2.6,
    hoverExtraWidthPx: 1.5,
    selectedExtraWidthPx: 2.8,
    contestedDash: [8, 6],
    neutralDash: [5, 4],
    glowWidthPx: 8,
    selectionWedgeSizePx: 8,
  },
  badge: {
    fontSizePx: 12,
    fontWeight: "700",
    paddingXPx: 6,
    paddingYPx: 4,
    cornerRadiusPx: 7,
    outlineColor: "rgba(0, 0, 0, 0.8)",
    outlineWidthPx: 1.4,
    anchorOffsetXPx: -18,
    anchorOffsetYPx: -34,
    jitterRadiusPx: 8,
    regenTextColor: "#ffe8a1",
  },
  link: {
    widthPx: 4,
    outlineWidthPx: 6.6,
    arrowSizePx: 9,
    levelFontSizePx: 10,
    flowMarkerSpacingPx: 74,
    flowMarkerSizePx: 6,
    flowSpeed: 0.26,
  },
  affordance: {
    validRingColor: "rgba(111, 255, 201, 0.96)",
    invalidRingColor: "rgba(255, 188, 140, 0.92)",
    invalidCrossColor: "rgba(255, 132, 132, 0.92)",
    suggestedLineColor: "rgba(255, 244, 204, 0.9)",
    suggestedLineWidthPx: 2.4,
  },
  legend: {
    bgColor: "rgba(5, 9, 14, 0.84)",
    borderColor: "rgba(213, 220, 230, 0.36)",
    textColor: "#edf2f7",
    titleColor: "#ffffff",
    fontSizePx: 12,
  },
  animation: {
    pulseHz: 1.7,
    contestedDashSpeed: 2.4,
  },
};
