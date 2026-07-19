import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EvidenceBundleManifest,
  ExplorationReview,
  GoldenBaseline,
  GoldenCapture,
  GoldenComparison,
  RegressionCheck,
  RegressionReview,
  ReviewEvidence,
  StructuralInvariant,
  StructuredCritiqueFinding,
  VersionedReview,
  WebRenderAudit,
  WebVisualCheckReport
} from "@/domain/quality";
import { loadArtifactVersion } from "./artifacts";
import { ensureProject } from "./store";
import { safeProjectPath } from "./paths";

const hashBytes = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
const timestamp = (clock?: () => Date) => (clock?.() ?? new Date()).toISOString();

function assertPortableName(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) throw new Error(`${label} must be a portable filename.`);
}

function assertVersionBinding(input: { artifactVersionId: string; brandSystemVersionId: string }) {
  if (!input.artifactVersionId.trim() || !input.brandSystemVersionId.trim()) throw new Error("Reviews must bind to artifact and BrandSystem versions.");
}

function validateCritique(
  binding: { artifactVersionId: string; brandSystemVersionId: string },
  evidence: ReviewEvidence[],
  findings: StructuredCritiqueFinding[]
) {
  assertVersionBinding(binding);
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    if (!item.id.trim() || evidenceIds.has(item.id)) throw new Error("Review evidence ids must be unique and non-empty.");
    if (item.artifactVersionId !== binding.artifactVersionId || item.brandSystemVersionId !== binding.brandSystemVersionId) throw new Error("Review evidence must bind to the reviewed artifact and BrandSystem versions.");
    if (!item.locator.trim() || !item.description.trim()) throw new Error("Review evidence requires a locator and description.");
    evidenceIds.add(item.id);
  }
  const findingIds = new Set<string>();
  for (const finding of findings) {
    if (!finding.id.trim() || findingIds.has(finding.id) || !finding.claim.trim()) throw new Error("Critique findings require unique ids and concrete claims.");
    if (!finding.evidenceIds.length || finding.evidenceIds.some((id) => !evidenceIds.has(id))) throw new Error(`Finding ${finding.id} must cite review evidence.`);
    findingIds.add(finding.id);
  }
}

export function createExplorationReview(input: Omit<ExplorationReview, "schemaVersion" | "kind" | "id" | "createdAt"> & { id?: string; clock?: () => Date }): ExplorationReview {
  validateCritique(input, input.evidence, input.findings);
  if (!input.directionId.trim()) throw new Error("Exploration reviews require a creative direction id.");
  return {
    schemaVersion: 1,
    kind: "exploration",
    id: input.id ?? `xrv_${randomUUID()}`,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    brandSystemVersionId: input.brandSystemVersionId,
    directionId: input.directionId,
    intendedDeviations: structuredClone(input.intendedDeviations),
    recommendation: input.recommendation,
    evidence: structuredClone(input.evidence),
    findings: structuredClone(input.findings),
    createdAt: timestamp(input.clock)
  };
}

export function compareGoldenBaseline(
  baseline: GoldenBaseline,
  current: { artifactVersionId: string; structuralInvariants: StructuralInvariant[]; pixelDifferences: Record<string, number | null> },
  options: { pixelThreshold?: number; declaredIntentionalChanges?: string[] } = {}
): GoldenComparison {
  if (current.artifactVersionId === baseline.artifactVersionId) throw new Error("Regression comparison requires a version newer than the golden baseline.");
  const currentStructure = new Map(current.structuralInvariants.map((invariant) => [invariant.key, invariant.value]));
  const structural = baseline.structuralInvariants.map((expected) => {
    const actual = currentStructure.get(expected.key);
    const matches = actual === expected.value;
    return { key: expected.key, expected: expected.value, actual, status: matches ? "pass" as const : expected.required ? "error" as const : "warning" as const };
  });
  const threshold = options.pixelThreshold ?? 0.01;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Pixel threshold must be a ratio between zero and one.");
  const intentional = Boolean(options.declaredIntentionalChanges?.length);
  const pixels = baseline.captures.map((capture) => {
    const differenceRatio = current.pixelDifferences[capture.id] ?? null;
    const status = differenceRatio === null ? "warning" as const : differenceRatio <= threshold ? "pass" as const : intentional ? "warning" as const : "error" as const;
    return { captureId: capture.id, differenceRatio, threshold, status };
  });
  return { baselineId: baseline.id, baselineVersionId: baseline.artifactVersionId, artifactVersionId: current.artifactVersionId, structural, pixels };
}

export function createRegressionReview(input: {
  id?: string;
  artifactId: string;
  brandSystemVersionId: string;
  comparison: GoldenComparison;
  declaredIntentionalChanges?: string[];
  evidence: ReviewEvidence[];
  findings?: StructuredCritiqueFinding[];
  clock?: () => Date;
}): RegressionReview {
  const artifactVersionId = input.comparison.artifactVersionId;
  const findings = input.findings ?? [];
  validateCritique({ artifactVersionId, brandSystemVersionId: input.brandSystemVersionId }, input.evidence, findings);
  const evidenceIds = input.evidence.map((item) => item.id);
  const checks: RegressionCheck[] = [
    ...input.comparison.structural.map((result) => ({
      id: `structure:${result.key}`,
      invariantKey: result.key,
      status: result.status,
      message: result.status === "pass" ? `${result.key} matches the approved structure.` : `${result.key} changed from ${JSON.stringify(result.expected)} to ${JSON.stringify(result.actual)}.`,
      evidenceIds
    })),
    ...input.comparison.pixels.map((result) => ({
      id: `pixels:${result.captureId}`,
      status: result.status,
      message: result.differenceRatio === null
        ? `No pixel evidence is available for ${result.captureId}.`
        : `${result.captureId} differs by ${(result.differenceRatio * 100).toFixed(2)}% (threshold ${(result.threshold * 100).toFixed(2)}%).`,
      evidenceIds
    }))
  ];
  const status = checks.some((check) => check.status === "error") ? "fail" : checks.some((check) => check.status === "warning") ? "warning" : "pass";
  return {
    schemaVersion: 1,
    kind: "regression",
    id: input.id ?? `rrv_${randomUUID()}`,
    artifactId: input.artifactId,
    artifactVersionId,
    brandSystemVersionId: input.brandSystemVersionId,
    baselineId: input.comparison.baselineId,
    baselineVersionId: input.comparison.baselineVersionId,
    declaredIntentionalChanges: structuredClone(input.declaredIntentionalChanges ?? []),
    evidence: structuredClone(input.evidence),
    findings: structuredClone(findings),
    checks,
    status,
    createdAt: timestamp(input.clock)
  };
}

async function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export async function persistVersionedReview(projectId: string, review: VersionedReview) {
  const version = await loadArtifactVersion(projectId, review.artifactVersionId);
  if (version.metadata.artifactId !== review.artifactId || version.metadata.brandSystemVersionId !== review.brandSystemVersionId) throw new Error("Review version bindings do not match the stored artifact version.");
  validateCritique(review, review.evidence, review.findings);
  assertPortableName(`${review.id}.json`, "Review id");
  const directory = await safeProjectPath(projectId, "reviews", "quality");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${review.id}.json`);
  await atomicJson(file, review);
  return file;
}

export async function createApprovedGoldenBaseline(projectId: string, versionId: string, input: {
  captures: GoldenCapture[];
  structuralInvariants: StructuralInvariant[];
  approvedBy?: "user" | "codex" | "system";
  clock?: () => Date;
}) {
  const version = await loadArtifactVersion(projectId, versionId);
  if (version.metadata.approval.status !== "approved" || !version.metadata.approval.approvedAt) throw new Error("Golden baselines can only be created from an approved artifact version.");
  if (version.metadata.validations.some((validation) => validation.status === "error")) throw new Error("Golden baselines cannot capture a version with validation errors.");
  if (!input.captures.length || !input.structuralInvariants.length) throw new Error("Golden baselines require visual captures and structural invariants.");
  const captureIds = new Set<string>();
  for (const capture of input.captures) {
    if (!capture.id.trim() || captureIds.has(capture.id) || !capture.contentHash.trim() || capture.width <= 0 || capture.height <= 0) throw new Error("Golden captures require unique ids, hashes and positive dimensions.");
    if (path.isAbsolute(capture.source) || capture.source.split(/[\\/]/).includes("..") || !/^[a-z0-9._/-]+$/i.test(capture.source)) throw new Error("Golden capture sources must be portable relative paths.");
    captureIds.add(capture.id);
  }
  const invariantKeys = new Set(input.structuralInvariants.map((invariant) => invariant.key));
  if (invariantKeys.size !== input.structuralInvariants.length || input.structuralInvariants.some((invariant) => !invariant.key.trim())) throw new Error("Golden structural invariant keys must be unique and non-empty.");
  const createdAt = timestamp(input.clock);
  const baseline: GoldenBaseline = {
    schemaVersion: 1,
    id: `gold_${randomUUID()}`,
    artifactId: version.metadata.artifactId,
    artifactVersionId: version.metadata.versionId,
    brandSystemVersionId: version.metadata.brandSystemVersionId,
    approval: {
      status: "approved",
      approvedAt: version.metadata.approval.approvedAt,
      approvedBy: input.approvedBy ?? version.metadata.approval.approvedBy ?? "user"
    },
    captures: structuredClone(input.captures),
    structuralInvariants: structuredClone(input.structuralInvariants),
    createdAt
  };
  await ensureProject(projectId);
  const directory = await safeProjectPath(projectId, "reviews", "goldens");
  await mkdir(directory, { recursive: true });
  await atomicJson(path.join(directory, `${baseline.id}.json`), baseline);
  return baseline;
}

export interface EvidenceBundleEntry {
  name: string;
  role: EvidenceBundleManifest["files"][number]["role"];
  content: string | Buffer;
}

export async function writeEvidenceBundle(projectId: string, input: {
  artifactId: string;
  artifactVersionId: string;
  brandSystemVersionId: string;
  exactCommands: string[];
  entries: EvidenceBundleEntry[];
  clock?: () => Date;
}) {
  assertVersionBinding(input);
  const version = await loadArtifactVersion(projectId, input.artifactVersionId);
  if (version.metadata.artifactId !== input.artifactId || version.metadata.brandSystemVersionId !== input.brandSystemVersionId) throw new Error("Evidence bundle version bindings do not match the stored artifact version.");
  if (!input.exactCommands.length || input.exactCommands.some((command) => !command.trim())) throw new Error("Evidence bundles must record exact validation commands.");
  const id = `evidence_${randomUUID()}`;
  const directory = await safeProjectPath(projectId, "reviews", "evidence", id);
  await mkdir(directory, { recursive: true });
  const seen = new Set<string>();
  const files: EvidenceBundleManifest["files"] = [];
  for (const entry of input.entries) {
    assertPortableName(entry.name, "Evidence entry name");
    if (seen.has(entry.name)) throw new Error("Evidence entry names must be unique.");
    seen.add(entry.name);
    const content = typeof entry.content === "string" ? Buffer.from(entry.content) : entry.content;
    await writeFile(path.join(directory, entry.name), content, { flag: "wx" });
    files.push({ path: entry.name, contentHash: hashBytes(content), byteLength: content.byteLength, role: entry.role });
  }
  const manifest: EvidenceBundleManifest = {
    schemaVersion: 1,
    id,
    projectId,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    brandSystemVersionId: input.brandSystemVersionId,
    createdAt: timestamp(input.clock),
    exactCommands: structuredClone(input.exactCommands),
    files
  };
  await atomicJson(path.join(directory, "manifest.json"), manifest);
  return { manifest, directory };
}

export function assessWebMutation(input: { beforeSource: string; afterSource: string; beforeReport?: WebVisualCheckReport; report: WebVisualCheckReport; claimedChanged: boolean }) {
  const sourceChanged = hashBytes(input.beforeSource) !== hashBytes(input.afterSource);
  const renderDifferences = Object.values(input.report.renders).map((render) => render.pixelDifference).filter((value): value is number => typeof value === "number");
  const renderedChanged = renderDifferences.some((difference) => difference > 0);
  const contrastMetrics = (render: WebRenderAudit) => {
    const failures = render.contrast.filter((item) => item.conclusive && typeof item.ratio === "number" && item.ratio < item.required);
    return {
      failures: failures.length,
      deficit: Number(failures.reduce((total, item) => total + Math.max(0, item.required - (item.ratio ?? item.required)), 0).toFixed(2)),
      worstRatio: failures.length ? Math.min(...failures.map((item) => item.ratio!)) : null,
      inconclusive: render.contrast.filter((item) => !item.conclusive).length
    };
  };
  const integrityMetrics = (render: WebRenderAudit) => ({
    overflow: Number(render.horizontalOverflow),
    clipping: render.clippedElements.length,
    assets: render.brokenAssets.length,
    landmarks: Number(render.landmarks.main !== 1) + Number(render.landmarks.h1 !== 1),
    focusWarnings: render.focusOrder.positiveTabIndexes.length + render.focusOrder.duplicateLandmarks.length,
    unlabeledNavigation: render.landmarks.unlabeledNavigation
  });
  const deterministicErrors: WebRenderAudit["findings"] = [];
  const reviewWarnings: WebRenderAudit["findings"] = [];
  const comparisons: Record<string, {
    before: ReturnType<typeof contrastMetrics> & ReturnType<typeof integrityMetrics>;
    after: ReturnType<typeof contrastMetrics> & ReturnType<typeof integrityMetrics>;
    regressions: string[];
    warnings: string[];
  }> = {};
  for (const [viewport, after] of Object.entries(input.report.renders)) {
    const before = input.beforeReport?.renders[viewport];
    if (!before) {
      deterministicErrors.push(...after.findings.filter((finding) => finding.status === "error"));
      reviewWarnings.push(...after.findings.filter((finding) => finding.status === "warning"));
      continue;
    }
    const beforeContrast = contrastMetrics(before);
    const afterContrast = contrastMetrics(after);
    const beforeIntegrity = integrityMetrics(before);
    const afterIntegrity = integrityMetrics(after);
    const regressions: string[] = [];
    const warnings: string[] = [];
    if (afterContrast.failures > beforeContrast.failures || (afterContrast.failures === beforeContrast.failures && afterContrast.deficit > beforeContrast.deficit + 0.05)) regressions.push("contrast");
    for (const key of ["overflow", "clipping", "assets", "landmarks"] as const) {
      if (afterIntegrity[key] > beforeIntegrity[key]) regressions.push(key);
    }
    if (afterContrast.inconclusive > beforeContrast.inconclusive) warnings.push("contrast measurement");
    if (afterIntegrity.focusWarnings > beforeIntegrity.focusWarnings) warnings.push("focus order");
    if (afterIntegrity.unlabeledNavigation > beforeIntegrity.unlabeledNavigation) warnings.push("navigation labels");
    const known = new Set(["contrast", "overflow", "clipping", "assets", "landmarks"]);
    for (const finding of after.findings.filter((item) => item.status === "error")) {
      const category = finding.id.split(":").at(-1) ?? finding.id;
      const prior = before.findings.find((item) => item.id === finding.id);
      if ((known.has(category) && regressions.includes(category)) || (!known.has(category) && prior?.status !== "error")) deterministicErrors.push(finding);
    }
    for (const finding of after.findings.filter((item) => item.status === "warning")) {
      const category = finding.id.split(":").at(-1) ?? finding.id;
      const prior = before.findings.find((item) => item.id === finding.id);
      const knownWarning = category === "contrast" ? warnings.includes("contrast measurement") : category === "focus-order" ? warnings.includes("focus order") : category === "landmarks" ? warnings.includes("navigation labels") : false;
      if (knownWarning || (!["contrast", "focus-order", "landmarks"].includes(category) && prior?.status !== "warning")) reviewWarnings.push(finding);
    }
    comparisons[viewport] = { before: { ...beforeContrast, ...beforeIntegrity }, after: { ...afterContrast, ...afterIntegrity }, regressions, warnings };
  }
  const reasons: string[] = [];
  if (input.claimedChanged && !sourceChanged) reasons.push("The agent claimed a change but the source hash is unchanged.");
  if (input.claimedChanged && !renderedChanged) reasons.push("The source changed but no rendered pixel change was measured.");
  if (deterministicErrors.length) reasons.push(`${deterministicErrors.length} deterministic rendered regression(s) require review.`);
  const hasMetricWarnings = Object.values(comparisons).some((comparison) => comparison.warnings.length > 0);
  return { accepted: reasons.length === 0, requiresUserDecision: deterministicErrors.length > 0 || reviewWarnings.length > 0 || hasMetricWarnings, sourceChanged, renderedChanged, deterministicErrors, reviewWarnings, comparisons, reasons };
}

/** Runs a single-file artifact mutation and restores the exact prior bytes on rejection or error. */
export async function runFileRollbackTransaction<T>(filePath: string, operation: () => Promise<T>, accept: (result: T) => boolean) {
  const before = await readFile(filePath);
  try {
    const result = await operation();
    if (!accept(result)) {
      await writeFile(filePath, before);
      return { committed: false as const, result };
    }
    return { committed: true as const, result };
  } catch (error) {
    await writeFile(filePath, before);
    throw error;
  }
}
