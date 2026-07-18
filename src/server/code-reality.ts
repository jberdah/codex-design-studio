import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CODE_REALITY_MAP_SCHEMA,
  type CodeRealityMap,
  type ComponentFact,
  type DesignTokenFact,
  type FileFact,
  type FontFact,
  type FrameworkFact,
  type PackageManagerFact,
  type RepositorySnapshot,
  type RouteFact,
  type SourceEvidence,
  type ThemeFact
} from "@/domain/repository";

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", "node_modules", "bower_components",
  "coverage", "dist", "build", "out", "target", "vendor", ".cache", ".turbo"
]);
const TEXT_EXTENSIONS = new Set([
  ".css", ".pcss", ".scss", ".sass", ".less", ".styl", ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".vue", ".svelte", ".astro", ".json", ".json5", ".yaml", ".yml", ".mdx", ".html"
]);
const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp",
  ".mp4", ".webm", ".mov", ".mp3", ".wav", ".ogg", ".pdf"
]);
const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);

interface ScannedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export interface AnalyzeRepositoryOptions {
  maxFiles?: number;
  maxTextBytes?: number;
}

function stableId(kind: string, ...parts: Array<string | number | null>) {
  const hash = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
  return `${kind}:${hash}`;
}

function lineAt(text: string, offset: number) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

function evidence(snapshot: RepositorySnapshot, file: string, startLine = 1, endLine = startLine): SourceEvidence {
  return { path: file, startLine, endLine, commit: snapshot.git?.commit ?? null };
}

function fileFact(snapshot: RepositorySnapshot, kind: string, file: string, name = path.posix.basename(file), line = 1): FileFact {
  return { id: stableId(kind, file, name, line), name, evidence: evidence(snapshot, file, line) };
}

function versionString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function unquoteCssValue(value: string) {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function themeFromSelector(selector: string) {
  const dataTheme = selector.match(/data-theme\s*=\s*["']?([^\]"']+)/i)?.[1];
  if (dataTheme) return dataTheme;
  if (/(?:^|[\s,.])\.dark(?:[\s,:.#]|$)/i.test(selector)) return "dark";
  if (/(?:^|[\s,.])\.light(?:[\s,:.#]|$)/i.test(selector)) return "light";
  if (selector.includes(":root")) return "default";
  return null;
}

function selectorBefore(text: string, offset: number) {
  const open = text.lastIndexOf("{", offset);
  if (open === -1) return "";
  const previousClose = text.lastIndexOf("}", open);
  return text.slice(previousClose + 1, open).trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function scanFiles(root: string, maxFiles: number) {
  const files: ScannedFile[] = [];
  let skippedSymlinkCount = 0;
  let truncated = false;
  const visit = async (directory: string) => {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) { truncated = true; return; }
      if (entry.isSymbolicLink()) { skippedSymlinkCount += 1; continue; }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) { skippedSymlinkCount += 1; continue; }
      if (!metadata.isFile()) continue;
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        size: metadata.size
      });
    }
  };
  await visit(root);
  return { files, skippedSymlinkCount, truncated };
}

async function ancestorWorkspaceMetadata(snapshot: RepositorySnapshot) {
  if (snapshot.analysisRoot === snapshot.repositoryRoot) return [];
  const files: ScannedFile[] = [];
  let directory = path.dirname(snapshot.analysisRoot);
  while (true) {
    const relative = path.relative(snapshot.repositoryRoot, directory);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) break;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || (entry.name !== "package.json" && !packageManagerFromLock(entry.name))) continue;
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile()) continue;
      files.push({
        absolutePath,
        relativePath: path.relative(snapshot.analysisRoot, absolutePath).split(path.sep).join("/"),
        size: metadata.size
      });
    }
    if (directory === snapshot.repositoryRoot) break;
    directory = path.dirname(directory);
  }
  return files;
}

const FRAMEWORK_PACKAGES: Record<string, string> = {
  "next": "Next.js",
  "react": "React",
  "vue": "Vue",
  "nuxt": "Nuxt",
  "svelte": "Svelte",
  "@sveltejs/kit": "SvelteKit",
  "astro": "Astro",
  "@angular/core": "Angular",
  "@remix-run/react": "Remix",
  "@solidjs/start": "SolidStart",
  "solid-js": "SolidJS",
  "vite": "Vite",
  "tailwindcss": "Tailwind CSS"
};

const FRAMEWORK_CONFIGS: Array<[RegExp, string]> = [
  [/(?:^|\/)next\.config\.(?:js|mjs|cjs|ts)$/i, "Next.js"],
  [/(?:^|\/)nuxt\.config\.(?:js|ts)$/i, "Nuxt"],
  [/(?:^|\/)svelte\.config\.(?:js|mjs|cjs)$/i, "SvelteKit"],
  [/(?:^|\/)astro\.config\.(?:js|mjs|cjs|ts)$/i, "Astro"],
  [/(?:^|\/)angular\.json$/i, "Angular"],
  [/(?:^|\/)vite\.config\.(?:js|mjs|cjs|ts)$/i, "Vite"]
];

function packageManagerFromLock(file: string): PackageManagerFact["name"] | null {
  const name = path.posix.basename(file);
  if (name === "package-lock.json" || name === "npm-shrinkwrap.json") return "npm";
  if (name === "pnpm-lock.yaml") return "pnpm";
  if (name === "yarn.lock") return "yarn";
  if (name === "bun.lock" || name === "bun.lockb") return "bun";
  return null;
}

function routePath(parts: string[]) {
  const normalized = parts
    .filter((part) => part && !/^\(.+\)$/.test(part) && !part.startsWith("@"))
    .map((part) => part
      .replace(/^\[\.\.\.([^\]]+)\]$/, "*$1")
      .replace(/^\[\[\.\.\.([^\]]+)\]\]$/, "*$1?")
      .replace(/^\[([^\]]+)\]$/, ":$1"));
  return `/${normalized.join("/")}`.replace(/\/$/, "") || "/";
}

function inferFileRoute(snapshot: RepositorySnapshot, file: string): RouteFact | null {
  const withoutExtension = file.replace(/\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx)$/, "");
  let match = withoutExtension.match(/^(?:src\/)?app\/(.*\/)?(page|layout|route)$/);
  if (match) {
    const kind = match[2] === "route" ? "api" : match[2] === "layout" ? "layout" : "page";
    return { id: stableId("route", file), route: routePath((match[1] ?? "").split("/")), kind, framework: "Next.js", evidence: evidence(snapshot, file) };
  }
  match = withoutExtension.match(/^(?:src\/)?routes\/(.*\/)?\+(page|layout|server)$/);
  if (match) {
    const kind = match[2] === "server" ? "api" : match[2] === "layout" ? "layout" : "page";
    return { id: stableId("route", file), route: routePath((match[1] ?? "").split("/")), kind, framework: "SvelteKit", evidence: evidence(snapshot, file) };
  }
  match = withoutExtension.match(/^(?:src\/)?pages\/(.+)$/);
  if (match) {
    const parts = match[1].split("/");
    const leaf = parts.at(-1);
    if (leaf?.startsWith("_")) return null;
    if (leaf === "index") parts.pop();
    const isApi = parts[0] === "api";
    return {
      id: stableId("route", file),
      route: routePath(parts),
      kind: isApi ? "api" : "page",
      framework: file.endsWith(".vue") ? "Nuxt" : file.endsWith(".astro") ? "Astro" : "Next.js",
      evidence: evidence(snapshot, file)
    };
  }
  match = withoutExtension.match(/^app\/routes\/(.+)$/);
  if (match) {
    const remixParts = match[1].replace(/\/route$/, "").split(/[./]/).filter(Boolean).map((part) => part.startsWith("$") ? `:${part.slice(1)}` : part === "_index" ? "" : part);
    return { id: stableId("route", file), route: routePath(remixParts), kind: "page", framework: "Remix", evidence: evidence(snapshot, file) };
  }
  return null;
}

function structuredTokens(value: unknown, prefix: string[] = []): Array<{ name: string; value: string; theme: string | null }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const result: Array<{ name: string; value: string; theme: string | null }> = [];
  const record = value as Record<string, unknown>;
  const directValue = record.$value;
  if (prefix.length && directValue !== null && ["string", "number", "boolean"].includes(typeof directValue)) {
    result.push({ name: prefix.join("."), value: String(directValue), theme: prefix[0]?.toLowerCase().includes("theme") ? prefix[1] ?? null : null });
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith("$")) continue;
    const next = [...prefix, key];
    if (child !== null && (typeof child === "string" || typeof child === "number" || typeof child === "boolean")) {
      result.push({ name: next.join("."), value: String(child), theme: prefix[0]?.toLowerCase().includes("theme") ? prefix[1] ?? null : null });
    } else {
      result.push(...structuredTokens(child, next));
    }
  }
  return result;
}

export async function buildCodeRealityMap(snapshot: RepositorySnapshot, options: AnalyzeRepositoryOptions = {}): Promise<CodeRealityMap> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTextBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error("maxFiles must be a positive integer");
  if (!Number.isSafeInteger(maxTextBytes) || maxTextBytes < 1) throw new Error("maxTextBytes must be a positive integer");
  const scanned = await scanFiles(snapshot.analysisRoot, maxFiles);
  const workspaceMetadata = await ancestorWorkspaceMetadata(snapshot);
  for (const file of workspaceMetadata) {
    if (scanned.files.length >= maxFiles) { scanned.truncated = true; break; }
    scanned.files.push(file);
  }
  scanned.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const packageManagers: PackageManagerFact[] = [];
  const frameworks: FrameworkFact[] = [];
  const cssVariables: DesignTokenFact[] = [];
  const tokenFiles: FileFact[] = [];
  const tailwindFiles: FileFact[] = [];
  const themes: ThemeFact[] = [];
  const fonts: FontFact[] = [];
  const assets: FileFact[] = [];
  const components: ComponentFact[] = [];
  const stories: FileFact[] = [];
  const routes: RouteFact[] = [];
  let skippedLargeFileCount = 0;

  for (const file of scanned.files) {
    const extension = path.posix.extname(file.relativePath).toLowerCase();
    const basename = path.posix.basename(file.relativePath);
    const manager = packageManagerFromLock(file.relativePath);
    if (manager) packageManagers.push({ id: stableId("package-manager", manager, file.relativePath), name: manager, version: null, evidence: evidence(snapshot, file.relativePath) });
    for (const [pattern, name] of FRAMEWORK_CONFIGS) {
      if (pattern.test(file.relativePath)) frameworks.push({ id: stableId("framework", name, file.relativePath), name, version: null, evidence: evidence(snapshot, file.relativePath) });
    }
    const isTailwind = /(?:^|\/)(?:tailwind\.config\.[^/]+|[^/]*tailwind[^/]*\.(?:css|scss|sass))$/i.test(file.relativePath);
    if (isTailwind) tailwindFiles.push(fileFact(snapshot, "tailwind", file.relativePath));
    const isTokenFile = /(?:^|\/)(?:design[-_.]?tokens?|tokens?|themes?)(?:\.[^/]+|\/[^/]+\.json)$/i.test(file.relativePath);
    if (isTokenFile) tokenFiles.push(fileFact(snapshot, "token-file", file.relativePath));
    if (/\.(?:stories|story)\.(?:[cm]?[jt]sx?|mdx|vue|svelte)$/i.test(file.relativePath)) stories.push(fileFact(snapshot, "story", file.relativePath));
    if (ASSET_EXTENSIONS.has(extension)) assets.push(fileFact(snapshot, "asset", file.relativePath));
    if (FONT_EXTENSIONS.has(extension)) {
      fonts.push({ id: stableId("font", file.relativePath), family: basename.slice(0, -extension.length), source: "asset", evidence: evidence(snapshot, file.relativePath) });
    }
    const inferredRoute = inferFileRoute(snapshot, file.relativePath);
    if (inferredRoute) routes.push(inferredRoute);

    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if (file.size > maxTextBytes) { skippedLargeFileCount += 1; continue; }
    const text = await readFile(file.absolutePath, "utf8");

    if (basename === "package.json") {
      try {
        const manifest = JSON.parse(text) as Record<string, unknown>;
        const declaredManager = typeof manifest.packageManager === "string" ? manifest.packageManager.match(/^(npm|pnpm|yarn|bun)@?(.*)$/) : null;
        if (declaredManager) {
          const offset = text.indexOf('"packageManager"');
          packageManagers.push({
            id: stableId("package-manager", declaredManager[1], file.relativePath, "manifest"),
            name: declaredManager[1] as PackageManagerFact["name"],
            version: declaredManager[2] || null,
            evidence: evidence(snapshot, file.relativePath, lineAt(text, Math.max(0, offset)))
          });
        }
        const dependencies = { ...(manifest.dependencies as object ?? {}), ...(manifest.devDependencies as object ?? {}) } as Record<string, unknown>;
        for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
          if (!(packageName in dependencies)) continue;
          const offset = text.indexOf(`"${packageName}"`);
          frameworks.push({
            id: stableId("framework", frameworkName, file.relativePath),
            name: frameworkName,
            version: versionString(dependencies[packageName]),
            evidence: evidence(snapshot, file.relativePath, lineAt(text, Math.max(0, offset)))
          });
        }
        for (const packageName of Object.keys(dependencies)) {
          const family = packageName.match(/^@fontsource\/(.+)$/)?.[1] ?? packageName.match(/^typeface-(.+)$/)?.[1];
          if (!family) continue;
          const offset = text.indexOf(`"${packageName}"`);
          fonts.push({
            id: stableId("font", file.relativePath, packageName), family: family.replace(/-/g, " "), source: "package",
            evidence: evidence(snapshot, file.relativePath, lineAt(text, Math.max(0, offset)))
          });
        }
      } catch { /* Invalid package manifests are inventory evidence only, not executable input. */ }
    }

    if (isTokenFile && extension === ".json") {
      try {
        for (const token of structuredTokens(JSON.parse(text))) {
          const leaf = token.name.split(".").at(-1) ?? token.name;
          const offset = text.indexOf(`"${leaf}"`);
          const line = lineAt(text, Math.max(0, offset));
          cssVariables.push({
            id: stableId("token", file.relativePath, token.name), name: token.name, value: token.value,
            format: "structured-token", theme: token.theme, evidence: evidence(snapshot, file.relativePath, line)
          });
        }
      } catch { /* A malformed token candidate remains listed as a token file. */ }
    }

    const variablePattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}\r\n]+)/g;
    for (const match of text.matchAll(variablePattern)) {
      const selector = selectorBefore(text, match.index ?? 0);
      const line = lineAt(text, match.index ?? 0);
      cssVariables.push({
        id: stableId("token", file.relativePath, match[1], line), name: match[1], value: match[2].trim(),
        format: "css-variable", theme: themeFromSelector(selector), evidence: evidence(snapshot, file.relativePath, line)
      });
    }

    const themePattern = /([^{}]+)\{/g;
    for (const match of text.matchAll(themePattern)) {
      const selector = match[1].trim().split(/\r?\n/).at(-1)?.trim() ?? "";
      const theme = themeFromSelector(selector);
      if (!theme || theme === "default") continue;
      const line = lineAt(text, match.index ?? 0);
      themes.push({ id: stableId("theme", file.relativePath, theme, line), name: theme, selector, evidence: evidence(snapshot, file.relativePath, line) });
    }

    const fontFacePattern = /font-family\s*:\s*([^;}\r\n]+)/gi;
    for (const match of text.matchAll(fontFacePattern)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 300), match.index);
      if (!/@font-face\s*\{[^}]*$/i.test(before)) continue;
      const line = lineAt(text, match.index ?? 0);
      fonts.push({
        id: stableId("font", file.relativePath, match[1], line), family: unquoteCssValue(match[1]), source: "declaration",
        evidence: evidence(snapshot, file.relativePath, line)
      });
    }
    const nextFontPattern = /from\s+["']next\/font\/(?:google|local)["']/g;
    for (const match of text.matchAll(nextFontPattern)) {
      const line = lineAt(text, match.index ?? 0);
      fonts.push({ id: stableId("font", file.relativePath, line), family: "next/font", source: "package", evidence: evidence(snapshot, file.relativePath, line) });
    }
    const googleFontPattern = /fonts\.googleapis\.com\/css2?\?[^\s"')]*family=([^&\s"')]+)/gi;
    for (const match of text.matchAll(googleFontPattern)) {
      const line = lineAt(text, match.index ?? 0);
      fonts.push({
        id: stableId("font", file.relativePath, match[1], line), family: decodeURIComponent(match[1]).replace(/\+/g, " ").replace(/:.+$/, ""),
        source: "package", evidence: evidence(snapshot, file.relativePath, line)
      });
    }

    if (/\.(?:[cm]?[jt]sx|vue|svelte)$/.test(extension) && (/(?:^|\/)components?\//i.test(file.relativePath) || /^[A-Z][A-Za-z0-9_-]*\./.test(basename))) {
      const exportPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const)\s+([A-Z][A-Za-z0-9_]*)/g;
      const exported = [...text.matchAll(exportPattern)];
      const names = exported.length ? exported.map((match) => ({ name: match[1], offset: match.index ?? 0 })) : [{ name: basename.slice(0, -extension.length), offset: 0 }];
      for (const item of names) {
        const line = lineAt(text, item.offset);
        components.push({
          id: stableId("component", file.relativePath, item.name), name: item.name, exportName: item.name,
          evidence: evidence(snapshot, file.relativePath, line)
        });
      }
    }

    const declaredRoutePattern = /(?:<Route\b[^>]*\bpath\s*=\s*["']|\bpath\s*:\s*["'])(\/[^"']*?)["']/g;
    for (const match of text.matchAll(declaredRoutePattern)) {
      const line = lineAt(text, match.index ?? 0);
      routes.push({
        id: stableId("route-declared", file.relativePath, match[1], line), route: match[1], kind: "declared", framework: null,
        evidence: evidence(snapshot, file.relativePath, line)
      });
    }
  }

  const dedupe = <T extends { id: string }>(facts: T[]) => [...new Map(facts.map((fact) => [fact.id, fact])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  const portableSource = snapshot.source.kind === "remote-git"
    ? snapshot.source
    : { ...snapshot.source, location: "." };
  return {
    schema: CODE_REALITY_MAP_SCHEMA,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    analyzedCommit: snapshot.git?.commit ?? null,
    repositoryFingerprint: snapshot.fingerprint,
    repository: {
      source: portableSource,
      root: ".",
      analysisSubdirectory: snapshot.analysisSubdirectory,
      branch: snapshot.git?.branch ?? null,
      dirty: snapshot.git?.dirty ?? null
    },
    inventory: {
      packageManagers: dedupe(packageManagers), frameworks: dedupe(frameworks), cssVariables: dedupe(cssVariables),
      tokenFiles: dedupe(tokenFiles), tailwindFiles: dedupe(tailwindFiles), themes: dedupe(themes), fonts: dedupe(fonts),
      assets: dedupe(assets), components: dedupe(components), stories: dedupe(stories), routes: dedupe(routes)
    },
    diagnostics: {
      scannedFileCount: scanned.files.length,
      skippedSymlinkCount: scanned.skippedSymlinkCount,
      skippedLargeFileCount,
      truncated: scanned.truncated
    }
  };
}

export async function materializeCodeRealityMap(snapshot: RepositorySnapshot, outputFile: string, options: AnalyzeRepositoryOptions = {}) {
  const map = await buildCodeRealityMap(snapshot, options);
  const destination = path.resolve(outputFile);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
  return map;
}
