import { normalizeJsonText } from "../model/json";
import type { LevelEditorDocument, LevelEditorWorkspace } from "../model/types";

export interface ChangedLevelEditorFile {
  path: string;
  label: string;
  content: string;
}

export interface ProjectWriteTargetCandidates {
  primaryPath: string;
  mirrorPath: string | null;
}

export interface WriteChangedFilesResult {
  changedFileCount: number;
  writtenFilePaths: string[];
}

type DirectoryPickerWindow = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  };

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

export function supportsProjectDirectoryWrite(): boolean {
  return typeof window !== "undefined" && typeof getDirectoryPickerWindow().showDirectoryPicker === "function";
}

export function getProjectWriteTargetCandidates(path: string): ProjectWriteTargetCandidates {
  const normalized = normalizeWorkspacePath(path);
  if (normalized.startsWith("data/")) {
    return {
      primaryPath: `public/${normalized}`,
      mirrorPath: normalized,
    };
  }

  if (normalized.startsWith("levels/")) {
    return {
      primaryPath: normalized,
      mirrorPath: `public/${normalized}`,
    };
  }

  return {
    primaryPath: normalized,
    mirrorPath: null,
  };
}

export async function writeChangedFilesToProjectDirectory(
  workspace: LevelEditorWorkspace,
): Promise<WriteChangedFilesResult> {
  const changed = listChangedFiles(workspace);
  if (changed.length === 0) {
    return {
      changedFileCount: 0,
      writtenFilePaths: [],
    };
  }
  if (!supportsProjectDirectoryWrite()) {
    throw new Error("This browser cannot write project files. Use download export instead.");
  }

  const picker = getDirectoryPickerWindow().showDirectoryPicker;
  if (!picker) {
    throw new Error("This browser cannot write project files. Use download export instead.");
  }

  const rootHandle = await picker({ mode: "readwrite" });
  await assertProjectRoot(rootHandle);

  const writtenFilePaths: string[] = [];
  for (const file of changed) {
    const candidates = getProjectWriteTargetCandidates(file.path);
    const targetPaths = [candidates.primaryPath];
    if (candidates.mirrorPath && (await fileExists(rootHandle, candidates.mirrorPath))) {
      targetPaths.push(candidates.mirrorPath);
    }

    for (const targetPath of dedupePaths(targetPaths)) {
      await writeFile(rootHandle, targetPath, file.content);
      writtenFilePaths.push(targetPath);
    }
  }

  return {
    changedFileCount: changed.length,
    writtenFilePaths,
  };
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

function normalizeWorkspacePath(path: string): string {
  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error("Cannot write an empty file path.");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Cannot write unsafe path: ${path}`);
  }
  return segments.join("/");
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

async function assertProjectRoot(rootHandle: FileSystemDirectoryHandle): Promise<void> {
  const hasPackageJson = await fileExists(rootHandle, "package.json");
  const hasSrcDirectory = await directoryExists(rootHandle, "src");
  if (hasPackageJson && hasSrcDirectory) {
    return;
  }
  throw new Error("Choose the project root folder that contains package.json and src.");
}

async function writeFile(
  rootHandle: FileSystemDirectoryHandle,
  relativePath: string,
  content: string,
): Promise<void> {
  const segments = normalizeWorkspacePath(relativePath).split("/");
  let directory = rootHandle;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }

  const fileName = segments[segments.length - 1];
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

async function fileExists(
  rootHandle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  const segments = normalizeWorkspacePath(relativePath).split("/");
  let directory = rootHandle;
  for (const segment of segments.slice(0, -1)) {
    try {
      directory = await directory.getDirectoryHandle(segment);
    } catch {
      return false;
    }
  }

  try {
    await directory.getFileHandle(segments[segments.length - 1]);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(
  rootHandle: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  const segments = normalizeWorkspacePath(relativePath).split("/");
  let directory = rootHandle;
  for (const segment of segments) {
    try {
      directory = await directory.getDirectoryHandle(segment);
    } catch {
      return false;
    }
  }
  return true;
}

function dedupePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function getDirectoryPickerWindow(): DirectoryPickerWindow {
  return window as DirectoryPickerWindow;
}
