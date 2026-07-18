export const CODE_REALITY_MAP_SCHEMA = "code-reality-map/v1" as const;

export type RepositorySource =
  | {
      kind: "directory" | "local-git";
      /** An absolute or process-relative path selected by the user. */
      location: string;
      /** Optional monorepo package path, relative to `location`. */
      subdirectory?: string;
    }
  | {
      kind: "remote-git";
      /** HTTPS, SSH, or local filesystem Git remote. Never persist this unsanitized. */
      location: string;
      ref?: string;
      subdirectory?: string;
    };

/** RepositorySource after credential-bearing URL components have been removed. */
export type SanitizedRepositorySource = RepositorySource;

export interface RepositoryRemote {
  name: string;
  fetchUrls: string[];
  pushUrls: string[];
}

export interface RepositoryWorktree {
  path: string;
  commit: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface GitRepositoryState {
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  changedFileCount: number;
  worktrees: RepositoryWorktree[];
  remotes: RepositoryRemote[];
}

export interface RepositorySnapshot {
  schemaVersion: 1;
  source: SanitizedRepositorySource;
  /** Canonical root of the selected Git worktree, or selected folder for non-Git input. */
  repositoryRoot: string;
  /** Canonical directory whose application code is inventoried. */
  analysisRoot: string;
  /** POSIX-style path from repositoryRoot to analysisRoot. Empty for the whole repository. */
  analysisSubdirectory: string;
  git: GitRepositoryState | null;
  capturedAt: string;
  fingerprint: string;
}

export interface SourceEvidence {
  /** POSIX-style path relative to RepositorySnapshot.analysisRoot. */
  path: string;
  startLine: number;
  endLine: number;
  /** HEAD at analysis time. Null means a plain folder or an unborn Git branch. */
  commit: string | null;
}

export interface EvidenceLinked {
  id: string;
  evidence: SourceEvidence;
}

export interface PackageManagerFact extends EvidenceLinked {
  name: "npm" | "pnpm" | "yarn" | "bun";
  version: string | null;
}

export interface FrameworkFact extends EvidenceLinked {
  name: string;
  version: string | null;
}

export interface DesignTokenFact extends EvidenceLinked {
  name: string;
  value: string;
  format: "css-variable" | "structured-token";
  theme: string | null;
}

export interface ThemeFact extends EvidenceLinked {
  name: string;
  selector: string | null;
}

export interface FontFact extends EvidenceLinked {
  family: string;
  source: "declaration" | "package" | "asset";
}

export interface FileFact extends EvidenceLinked {
  name: string;
}

export interface ComponentFact extends FileFact {
  exportName: string;
}

export interface RouteFact extends EvidenceLinked {
  route: string;
  kind: "page" | "api" | "layout" | "declared";
  framework: string | null;
}

export interface CodeRealityMap {
  schema: typeof CODE_REALITY_MAP_SCHEMA;
  schemaVersion: 1;
  generatedAt: string;
  analyzedCommit: string | null;
  repositoryFingerprint: string;
  repository: {
    /** Portable source reference. Local absolute paths are represented as `.`. */
    source: SanitizedRepositorySource;
    /** Always `.` in a materialized map; runtime absolute paths remain private to RepositorySnapshot. */
    root: string;
    analysisSubdirectory: string;
    branch: string | null;
    dirty: boolean | null;
  };
  inventory: {
    packageManagers: PackageManagerFact[];
    frameworks: FrameworkFact[];
    cssVariables: DesignTokenFact[];
    tokenFiles: FileFact[];
    tailwindFiles: FileFact[];
    themes: ThemeFact[];
    fonts: FontFact[];
    assets: FileFact[];
    components: ComponentFact[];
    stories: FileFact[];
    routes: RouteFact[];
  };
  diagnostics: {
    scannedFileCount: number;
    skippedSymlinkCount: number;
    skippedLargeFileCount: number;
    truncated: boolean;
  };
}

export type TrustedRepositoryOperation = "dependency-install" | "application-execution";

/** A grant must be created only after an explicit user confirmation. */
export interface RepositoryTrustGrant {
  schemaVersion: 1;
  repositoryFingerprint: string;
  scopes: TrustedRepositoryOperation[];
  grantedAt: string;
  grantedBy: string;
}
