/*
 * Patch Notes (2026-02-24):
 * - Added tutorial hint trigger models for campaign v2.
 */

import type { CampaignHintDefinition } from "../campaign/CampaignTypes";

export interface ResolvedTutorialHint extends CampaignHintDefinition {
  id: string;
}

export function normalizeTutorialHints(hints: CampaignHintDefinition[]): ResolvedTutorialHint[] {
  return hints
    .slice(0, 3)
    .map((hint, index) => ({
      ...hint,
      id: `${hint.trigger}:${hint.wave ?? 0}:${index}`,
      text: hint.text.trim(),
    }))
    .filter((hint) => hint.text.length > 0);
}
