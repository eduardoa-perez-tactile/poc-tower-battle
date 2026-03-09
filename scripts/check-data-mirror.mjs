import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const dataDir = path.join(projectRoot, "data");
const publicDataDir = path.join(projectRoot, "public", "data");

const dataFiles = listFiles(dataDir);
const publicFiles = listFiles(publicDataDir);
const allRelativePaths = new Set([...dataFiles.keys(), ...publicFiles.keys()]);

const missingInPublic = [];
const missingInData = [];
const mismatched = [];

for (const relativePath of [...allRelativePaths].sort()) {
  const dataPath = dataFiles.get(relativePath) ?? null;
  const publicPath = publicFiles.get(relativePath) ?? null;

  if (dataPath && !publicPath) {
    missingInPublic.push(relativePath);
    continue;
  }
  if (!dataPath && publicPath) {
    missingInData.push(relativePath);
    continue;
  }
  if (!dataPath || !publicPath) {
    continue;
  }

  const dataHash = hashFile(dataPath);
  const publicHash = hashFile(publicPath);
  if (dataHash !== publicHash) {
    mismatched.push(relativePath);
  }
}

if (missingInPublic.length > 0 || mismatched.length > 0) {
  const lines = [
    "[check-data-mirror] Build blocked: data source mismatch detected.",
    "Reason: runtime and deploy read from public/data, so data/ must mirror it exactly.",
    "",
  ];

  if (missingInPublic.length > 0) {
    lines.push("Files present in data/ but missing in public/data/:");
    for (const relativePath of missingInPublic) {
      lines.push(`  - data/${relativePath}`);
    }
    lines.push("");
  }

  if (mismatched.length > 0) {
    lines.push("Files with different content between data/ and public/data/:");
    for (const relativePath of mismatched) {
      lines.push(`  - ${relativePath}`);
    }
    lines.push("");
  }

  lines.push("Fix:");
  lines.push("  1) Move or copy your edits to public/data/...");
  lines.push("  2) Keep data/ in sync with the same content.");
  lines.push("  3) Re-run npm run build.");

  console.error(lines.join("\n"));
  process.exit(1);
}

if (missingInData.length > 0) {
  console.warn(
    [
      "[check-data-mirror] Warning: files exist only in public/data/ (this is allowed):",
      ...missingInData.map((relativePath) => `  - public/data/${relativePath}`),
    ].join("\n"),
  );
}

console.log("[check-data-mirror] OK");

function listFiles(rootDir) {
  const byRelativePath = new Map();
  if (!fs.existsSync(rootDir)) {
    return byRelativePath;
  }

  walk(rootDir, rootDir, byRelativePath);
  return byRelativePath;
}

function walk(currentDir, rootDir, byRelativePath) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, rootDir, byRelativePath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).replaceAll(path.sep, "/");
    byRelativePath.set(relativePath, fullPath);
  }
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
