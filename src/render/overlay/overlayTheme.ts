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
      ring: "rgba(118, 176, 255, 0.96)",
      glow: "rgba(118, 176, 255, 0.35)",
      badgeFill: "rgba(15, 24, 48, 0.88)",
      badgeText: "#e2edff",
      link: "rgba(147, 197, 253, 0.92)",
      linkOutline: "rgba(7, 14, 29, 0.85)",
      flow: "rgba(219, 236, 255, 0.95)",
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
    red: {
      ring: "rgba(255, 112, 120, 0.96)",
      glow: "rgba(255, 112, 120, 0.33)",
      badgeFill: "rgba(51, 12, 16, 0.88)",
      badgeText: "#ffd8db",
      link: "rgba(255, 126, 136, 0.9)",
      linkOutline: "rgba(26, 7, 8, 0.85)",
      flow: "rgba(255, 221, 224, 0.95)",
    },
    green: {
      ring: "rgba(118, 255, 163, 0.96)",
      glow: "rgba(118, 255, 163, 0.33)",
      badgeFill: "rgba(10, 44, 22, 0.88)",
      badgeText: "#dcffe9",
      link: "rgba(134, 239, 172, 0.92)",
      linkOutline: "rgba(6, 22, 12, 0.85)",
      flow: "rgba(224, 255, 236, 0.95)",
    },
    yellow: {
      ring: "rgba(255, 223, 99, 0.98)",
      glow: "rgba(255, 223, 99, 0.35)",
      badgeFill: "rgba(55, 41, 7, 0.88)",
      badgeText: "#fff3c4",
      link: "rgba(253, 230, 138, 0.95)",
      linkOutline: "rgba(33, 25, 7, 0.85)",
      flow: "rgba(255, 247, 212, 0.95)",
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
