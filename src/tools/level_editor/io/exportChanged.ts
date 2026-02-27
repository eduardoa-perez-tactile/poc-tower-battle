import { normalizeJsonText } from "../model/json";
import type { LevelEditorDocument, LevelEditorWorkspace } from "../model/types";

export interface ChangedLevelEditorFile {
  path: string;
  label: string;
  content: string;
}

export function listChangedFiles(workspace: LevelEditorWorkspace): ChangedLevelEditorFile[] {
  const changed: ChangedLevelEditorFile[] = [];
  for (const docId of workspace.order) {
    const doc = workspace.docs[docId];
    if (!doc) {
      continue;
    }
    if (!isDocumentChanged(doc)) {
      continue;
    }
    changed.push({
      path: doc.path,
      label: doc.label,
      content: doc.currentRaw,
    });
  }
  return changed;
}

export function exportChangedFiles(workspace: LevelEditorWorkspace): ChangedLevelEditorFile[] {
  const changed = listChangedFiles(workspace);
  for (const file of changed) {
    downloadFile(file.path, file.content);
  }
  return changed;
}

export async function copyJsonToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function isDocumentChanged(doc: LevelEditorDocument): boolean {
  if (doc.isSynthetic) {
    return normalizeJsonText(doc.currentRaw).length > 0;
  }
  return normalizeJsonText(doc.originalRaw) !== normalizeJsonText(doc.currentRaw);
}

function downloadFile(path: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = toDownloadName(path);
  anchor.click();
  URL.revokeObjectURL(url);
}

function toDownloadName(path: string): string {
  const normalized = path.replace(/^\//, "");
  return normalized.replace(/\//g, "__");
}
