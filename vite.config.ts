import { defineConfig } from "vite";

function normalizeBasePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function resolveBasePath(): string {
  const explicit = process.env.BASE_PATH ?? process.env.VITE_PUBLIC_BASE_PATH;
  if (explicit) {
    return normalizeBasePath(explicit);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const repoName = repository?.split("/")[1];
  if (!repoName || repoName.endsWith(".github.io")) {
    return "/";
  }

  return normalizeBasePath(repoName);
}

export default defineConfig({
  base: resolveBasePath(),
});
