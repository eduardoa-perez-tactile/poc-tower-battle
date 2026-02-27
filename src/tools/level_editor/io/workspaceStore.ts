import { ensureTrailingNewline, parseJsonSafe } from "../model/json";
import {
  LEVEL_EDITOR_WORKSPACE_STORAGE_KEY,
  LEVEL_EDITOR_WORKSPACE_VERSION,
  type LevelEditorDocument,
  type LevelEditorPersistedSnapshot,
  type LevelEditorWorkspace,
} from "../model/types";

export function loadWorkspaceSnapshot(): LevelEditorPersistedSnapshot | null {
  const raw = localStorage.getItem(LEVEL_EDITOR_WORKSPACE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedSnapshot(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(workspace: LevelEditorWorkspace): void {
  const docs = workspace.order
    .map((docId) => workspace.docs[docId])
    .filter((doc): doc is LevelEditorDocument => Boolean(doc))
    .map((doc) => ({
      path: doc.path,
      currentRaw: doc.currentRaw,
      kind: doc.kind,
      label: doc.label,
      group: doc.group,
      isSynthetic: doc.isSynthetic,
    }));

  const snapshot: LevelEditorPersistedSnapshot = {
    version: LEVEL_EDITOR_WORKSPACE_VERSION,
    updatedAt: Date.now(),
    docs,
  };

  localStorage.setItem(LEVEL_EDITOR_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
}

export function applyWorkspaceSnapshot(
  workspace: LevelEditorWorkspace,
  snapshot: LevelEditorPersistedSnapshot | null,
): LevelEditorWorkspace {
  if (!snapshot || snapshot.version !== LEVEL_EDITOR_WORKSPACE_VERSION) {
    return workspace;
  }

  const nextDocs: Record<string, LevelEditorDocument> = { ...workspace.docs };
  const knownOrder = [...workspace.order];

  for (const entry of snapshot.docs) {
    const existing = nextDocs[entry.path];
    if (existing) {
      const parsed = parseJsonSafe(entry.currentRaw);
      nextDocs[entry.path] = {
        ...existing,
        currentRaw: ensureTrailingNewline(entry.currentRaw),
        currentData: parsed.error ? null : (parsed.data as LevelEditorDocument["currentData"]),
        parseError: parsed.error,
      };
      continue;
    }

    if (!entry.isSynthetic) {
      continue;
    }

    const parsed = parseJsonSafe(entry.currentRaw);
    nextDocs[entry.path] = {
      id: entry.path,
      path: entry.path,
      label: entry.label,
      kind: entry.kind,
      group: entry.group,
      originalRaw: "",
      currentRaw: ensureTrailingNewline(entry.currentRaw),
      originalData: null,
      currentData: parsed.error ? null : (parsed.data as LevelEditorDocument["currentData"]),
      parseError: parsed.error,
      loadError: null,
      isSynthetic: true,
    };
    knownOrder.push(entry.path);
  }

  return {
    ...workspace,
    updatedAt: Date.now(),
    order: dedupeOrder(knownOrder),
    docs: nextDocs,
  };
}

function dedupeOrder(order: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of order) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isPersistedSnapshot(value: unknown): value is LevelEditorPersistedSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "number" &&
    Array.isArray(record.docs) &&
    record.docs.every((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const doc = entry as Record<string, unknown>;
      return (
        typeof doc.path === "string" &&
        typeof doc.currentRaw === "string" &&
        typeof doc.kind === "string" &&
        typeof doc.label === "string" &&
        typeof doc.group === "string" &&
        typeof doc.isSynthetic === "boolean"
      );
    })
  );
}
