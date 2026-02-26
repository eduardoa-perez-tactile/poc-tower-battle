import type { Owner, World } from "./World";

export interface LinkValidationResult {
  ok: boolean;
  reason?: string;
}

export interface LinkAdjacencyValidationResult {
  ok: boolean;
  invalidLinkIds: string[];
}

export function getNeighbors(world: Pick<World, "getNeighbors">, towerId: string): string[] {
  return world.getNeighbors(towerId);
}

export function areNeighbors(
  world: Pick<World, "areNeighbors">,
  fromTowerId: string,
  toTowerId: string,
): boolean {
  return world.areNeighbors(fromTowerId, toTowerId);
}

export function canCreateLink(
  world: Pick<World, "getTowerById" | "getOutgoingLinks" | "getMaxOutgoingLinksForTower" | "areNeighbors">,
  fromTowerId: string,
  toTowerId: string,
  owner: Owner,
): LinkValidationResult {
  if (fromTowerId === toTowerId) {
    return {
      ok: false,
      reason: "Cannot link a tower to itself.",
    };
  }

  const fromTower = world.getTowerById(fromTowerId);
  const toTower = world.getTowerById(toTowerId);
  if (!fromTower || !toTower) {
    return {
      ok: false,
      reason: "Tower not found.",
    };
  }

  if (fromTower.owner !== owner) {
    return {
      ok: false,
      reason: owner === "player" ? "Source tower must be owned by you." : "Source tower ownership mismatch.",
    };
  }

  if (!world.areNeighbors(fromTowerId, toTowerId)) {
    return {
      ok: false,
      reason: "Too far — adjacent towers only.",
    };
  }

  const maxOutgoing = world.getMaxOutgoingLinksForTower(fromTowerId);
  if (maxOutgoing < 1) {
    return {
      ok: false,
      reason: "This tower cannot create links.",
    };
  }

  const outgoingLinks = world.getOutgoingLinks(fromTowerId);
  if (outgoingLinks.some((link) => link.toTowerId === toTowerId)) {
    return {
      ok: false,
      reason: "Link already exists.",
    };
  }

  if (outgoingLinks.length >= maxOutgoing) {
    return {
      ok: false,
      reason: `Link capacity reached (${outgoingLinks.length}/${maxOutgoing}).`,
    };
  }

  return {
    ok: true,
  };
}

export function validateNonScriptedLinksAdjacency(
  world: Pick<World, "links" | "areNeighbors">,
): LinkAdjacencyValidationResult {
  const invalidLinkIds: string[] = [];
  for (const link of world.links) {
    if (link.isScripted) {
      continue;
    }
    if (!world.areNeighbors(link.fromTowerId, link.toTowerId)) {
      invalidLinkIds.push(link.id);
    }
  }

  return {
    ok: invalidLinkIds.length === 0,
    invalidLinkIds,
  };
}
