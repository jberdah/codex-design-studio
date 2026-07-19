import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultProject } from "@/domain/defaults";
import {
  assertBootstrapTransition,
  createBootstrapQuestions,
  validateStrategicCreativeBrief,
  type BootstrapAnswer,
  type BootstrapField,
  type BootstrapInput,
  type BootstrapReferenceSnapshot,
  type BootstrapSession,
  type BootstrapSourceReference,
  type StrategicCreativeBriefVersion
} from "@/domain/bootstrap";
import type { ProjectData } from "@/domain/types";
import { safeProjectPath, safeProjectRoot, workspaceRoot } from "./paths";
import { loadProject, saveProject } from "./store";
import { renameWithRetry } from "./fs-atomic";

const mutationQueues = new Map<string, Promise<void>>();
const sourceKinds = new Set(["url", "codebase", "logo", "image", "screenshot", "document", "deck", "spreadsheet", "manual"]);
const sourceIntents = new Set(["extract", "inspire", "extract-and-inspire"]);
const sourceRoles = new Set(["constraint", "evidence", "inspiration"]);
const sourceRelationships = new Set(["owned", "authorized", "third-party", "unknown"]);
const colorKeys = new Set(["primary", "secondary", "accent", "background", "surface", "text"]);

function bootstrapRoot() {
  return path.join(workspaceRoot, ".codex-design-studio", "bootstrap");
}

function assertSessionId(sessionId: string) {
  if (!/^bst_[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid bootstrap session id.");
  return sessionId;
}

function sessionPath(sessionId: string) {
  return path.join(bootstrapRoot(), `${assertSessionId(sessionId)}.json`);
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function text(value: unknown, label: string, maximum: number, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is limited to ${maximum} characters.`);
  return normalized || undefined;
}

function sanitizeSourceRefs(value: unknown): BootstrapSourceReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24) throw new Error("Bootstrap accepts at most 24 source references.");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Source reference ${index + 1} is invalid.`);
    const item = raw as Record<string, unknown>;
    const id = text(item.id, "Source reference id", 128, true)!;
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id) || ids.has(id)) throw new Error("Source reference ids must be unique and portable.");
    ids.add(id);
    if (!sourceKinds.has(String(item.kind))) throw new Error(`Source reference ${id} has an unsupported kind.`);
    if (!sourceIntents.has(String(item.intent))) throw new Error(`Source reference ${id} has an unsupported intent.`);
    const locator = text(item.locator, "Source locator", 2_048);
    if (item.kind === "url" && locator && !/^https?:\/\//i.test(locator)) throw new Error("Website references require an HTTP or HTTPS URL.");
    if (item.role !== undefined && !sourceRoles.has(String(item.role))) throw new Error(`Source reference ${id} has an unsupported role.`);
    if (item.relationship !== undefined && !sourceRelationships.has(String(item.relationship))) throw new Error(`Source reference ${id} has an unsupported relationship.`);
    let rights: BootstrapSourceReference["rights"];
    if (item.rights !== undefined) {
      if (!item.rights || typeof item.rights !== "object" || Array.isArray(item.rights) || JSON.stringify(item.rights).length > 10_000) throw new Error(`Source reference ${id} has invalid rights metadata.`);
      const candidate = item.rights as Record<string, unknown>;
      if (typeof candidate.confirmed !== "boolean" || typeof candidate.notes !== "string") throw new Error(`Source reference ${id} rights require confirmed and notes fields.`);
      rights = structuredClone(item.rights) as BootstrapSourceReference["rights"];
    }
    return {
      id,
      kind: item.kind as BootstrapSourceReference["kind"],
      label: text(item.label, "Source label", 200, true)!,
      intent: item.intent as BootstrapSourceReference["intent"],
      sourceId: text(item.sourceId, "Source id", 128),
      runId: text(item.runId, "Extraction run id", 128),
      locator,
      contentHash: text(item.contentHash, "Source content hash", 128),
      role: item.role as BootstrapSourceReference["role"],
      relationship: item.relationship as BootstrapSourceReference["relationship"],
      rights
    };
  });
}

export function sanitizeBootstrapInput(raw: unknown): BootstrapInput {
  if (!raw || typeof raw !== "object") throw new Error("Bootstrap input is required.");
  const input = raw as Record<string, unknown>;
  let colors: BootstrapInput["colors"];
  if (input.colors !== undefined) {
    if (!input.colors || typeof input.colors !== "object" || Array.isArray(input.colors)) throw new Error("Colors must be an object.");
    colors = {};
    for (const [key, value] of Object.entries(input.colors)) {
      if (!colorKeys.has(key) || typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value)) throw new Error(`Color ${key} must be a six-digit hexadecimal token.`);
      (colors as Record<string, string>)[key] = value.toUpperCase();
    }
  }
  let evidenceSnapshot: BootstrapInput["evidenceSnapshot"];
  if (input.evidenceSnapshot !== undefined) {
    if (!input.evidenceSnapshot || typeof input.evidenceSnapshot !== "object") throw new Error("Evidence snapshot link is invalid.");
    const snapshot = input.evidenceSnapshot as Record<string, unknown>;
    if (!Array.isArray(snapshot.evidenceIds) || snapshot.evidenceIds.length > 500 || snapshot.evidenceIds.some((id) => typeof id !== "string" || !id.trim())) throw new Error("Evidence snapshot ids are invalid.");
    evidenceSnapshot = {
      id: text(snapshot.id, "Evidence snapshot id", 128, true)!,
      contentHash: text(snapshot.contentHash, "Evidence snapshot hash", 128, true)!,
      evidenceIds: [...new Set(snapshot.evidenceIds.map((id) => String(id).trim()))],
      sourceGraphUpdatedAt: text(snapshot.sourceGraphUpdatedAt, "Source graph timestamp", 80)
    };
  }
  let deliverables: BootstrapInput["deliverables"];
  if (input.deliverables !== undefined) {
    if (!Array.isArray(input.deliverables) || input.deliverables.some((item) => item !== "web" && item !== "slides")) throw new Error("Deliverables may contain only web and slides.");
    deliverables = [...new Set(input.deliverables)] as BootstrapInput["deliverables"];
  }
  const legacyPromise = text(input.promise, "Promise", 1_000);
  const objective = text(input.objective, "Objective", 1_000) ?? legacyPromise;
  const explicitTarget = input.targetDeliverable;
  if (explicitTarget !== undefined && explicitTarget !== "web" && explicitTarget !== "slides") throw new Error("Target deliverable must be web or slides.");
  const targetDeliverable = explicitTarget as BootstrapInput["targetDeliverable"] ?? deliverables?.[0];
  return {
    projectName: text(input.projectName, "Project name", 100),
    brandName: text(input.brandName, "Brand name", 200),
    industry: text(input.industry, "Industry", 300),
    audience: text(input.audience, "Audience", 500),
    objective,
    targetDeliverable,
    promise: legacyPromise,
    colors,
    deliverables,
    sourceRefs: sanitizeSourceRefs(input.sourceRefs),
    evidenceSnapshot,
    selectedPresetId: text(input.selectedPresetId, "Preset id", 128)
  };
}

async function writeAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await renameWithRetry(temporary, file);
}

async function mutateSession<T>(sessionId: string, operation: (session: BootstrapSession) => Promise<T> | T): Promise<T> {
  const previous = mutationQueues.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  mutationQueues.set(sessionId, queued);
  await previous;
  try {
    const session = await loadBootstrapSession(sessionId);
    const result = await operation(session);
    await writeAtomic(sessionPath(sessionId), session);
    return result;
  } finally {
    release();
    if (mutationQueues.get(sessionId) === queued) mutationQueues.delete(sessionId);
  }
}

function event(session: BootstrapSession, action: BootstrapSession["events"][number]["action"], detail?: Record<string, string | number | boolean>) {
  const at = new Date().toISOString();
  session.updatedAt = at;
  session.events.push({ id: `evt_${randomBytes(8).toString("hex")}`, at, action, detail });
}

export async function createBootstrapSession(raw: unknown): Promise<BootstrapSession> {
  const originalInput = sanitizeBootstrapInput(raw);
  const questions = createBootstrapQuestions(originalInput);
  const at = new Date().toISOString();
  const id = `bst_${randomBytes(12).toString("hex")}`;
  const session: BootstrapSession = {
    schemaVersion: 1,
    id,
    // Advisory questions may accompany a ready session; only unanswered
    // required questions hold the bootstrap in the collecting state.
    status: questions.some((question) => question.required) ? "collecting" : "ready",
    originalInput: structuredClone(originalInput),
    inputHash: hash(originalInput),
    sourceRefs: structuredClone(originalInput.sourceRefs ?? []),
    evidenceSnapshot: structuredClone(originalInput.evidenceSnapshot),
    questions,
    answers: [],
    briefs: [],
    createdAt: at,
    updatedAt: at,
    events: [{ id: `evt_${randomBytes(8).toString("hex")}`, at, action: "created", detail: { questionCount: questions.length } }]
  };
  await writeAtomic(sessionPath(id), session);
  return structuredClone(session);
}

export async function loadBootstrapSession(sessionId: string): Promise<BootstrapSession> {
  try {
    return JSON.parse(await readFile(sessionPath(sessionId), "utf8")) as BootstrapSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Bootstrap session was not found.");
    throw error;
  }
}

export async function listBootstrapSessions(): Promise<BootstrapSession[]> {
  await mkdir(bootstrapRoot(), { recursive: true });
  const files = (await readdir(bootstrapRoot())).filter((name) => /^bst_[a-f0-9]{24}\.json$/.test(name));
  const sessions = await Promise.all(files.map((name) => loadBootstrapSession(name.slice(0, -5))));
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Persists only the bounded, typed reference observations prepared by the extraction pipeline. */
export async function recordBootstrapReferenceSnapshot(sessionId: string, snapshot: BootstrapReferenceSnapshot, expected?: { status: BootstrapSession["status"]; updatedAt: string }): Promise<BootstrapSession> {
  if (snapshot.stagingProjectId !== `bootstrap-${assertSessionId(sessionId).slice(4)}` || snapshot.observations.length > 24) throw new Error("Bootstrap reference snapshot is invalid.");
  if (JSON.stringify(snapshot).length > 150_000) throw new Error("Bootstrap reference snapshot is too large.");
  return mutateSession(sessionId, (session) => {
    if (!["ready", "review", "failed"].includes(session.status)) throw new Error("Bootstrap reference cannot change during synthesis or approval.");
    if (expected && (session.status !== expected.status || session.updatedAt !== expected.updatedAt)) throw new Error("Bootstrap reference preparation is stale; retry synthesis.");
    session.referenceSnapshot = structuredClone(snapshot);
    const linked = session.sourceRefs.find((source) => source.kind === "url" && source.locator);
    if (linked) {
      linked.sourceId = snapshot.sourceId;
      linked.runId = snapshot.runId;
      linked.contentHash = snapshot.sourceContentHash;
    }
    session.updatedAt = snapshot.updatedAt;
    return structuredClone(session);
  });
}

export async function answerBootstrapQuestions(sessionId: string, rawAnswers: unknown): Promise<BootstrapSession> {
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0 || rawAnswers.length > 3) throw new Error("Provide one to three bootstrap answers.");
  const answers = rawAnswers.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Bootstrap answer is invalid.");
    const item = raw as Record<string, unknown>;
    const questionId = text(item.questionId, "Question id", 128, true)!;
    const value = text(item.value, "Answer", 1_000, true)!;
    if (questionId === "question:targetDeliverable" && value !== "web" && value !== "slides") throw new Error("Target deliverable answer must be web or slides.");
    return { questionId, value };
  });
  return mutateSession(sessionId, (session) => {
    if (session.status !== "collecting" && session.status !== "ready") throw new Error("Bootstrap answers cannot be changed after synthesis starts.");
    const known = new Set(session.questions.map((question) => question.id));
    if (answers.some((answer) => !known.has(answer.questionId))) throw new Error("An answer references an unknown bootstrap question.");
    const at = new Date().toISOString();
    const merged = new Map(session.answers.map((answer) => [answer.questionId, answer]));
    for (const answer of answers) merged.set(answer.questionId, { ...answer, answeredAt: at });
    session.answers = session.questions.flatMap((question) => merged.get(question.id) ?? []);
    const complete = session.questions.filter((question) => question.required).every((question) => session.answers.some((answer) => answer.questionId === question.id && answer.value.trim()));
    const next = complete ? "ready" : "collecting";
    assertBootstrapTransition(session.status, next);
    session.status = next;
    event(session, "answered", { answerCount: session.answers.length });
    return structuredClone(session);
  });
}

function answerFor(session: BootstrapSession, field: BootstrapField) {
  return session.originalInput[field]?.trim() || session.answers.find((answer) => session.questions.find((question) => question.id === answer.questionId)?.field === field)?.value.trim();
}

function evidenceFor(session: BootstrapSession, field: BootstrapField) {
  return session.originalInput[field]?.trim() ? `input:${field}` : `answer:question:${field}`;
}

function sentence(value: string) {
  const clean = value.trim().replace(/[.!?]+$/, "");
  return clean ? `${clean}.` : "";
}

function referenceValueText(value: BootstrapReferenceSnapshot["observations"][number]["value"]) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return Object.entries(value).slice(0, 4).map(([key, child]) => `${key}: ${typeof child === "string" ? child : JSON.stringify(child)}`).join("; ");
}

function acceptedReferenceObservations(session: BootstrapSession) {
  return (session.referenceSnapshot?.observations ?? []).filter((item) => item.status === "accepted" && item.directive !== "must-avoid");
}

function applyReferenceDesignSignals(draft: ProjectData, session: BootstrapSession) {
  const accepted = acceptedReferenceObservations(session);
  const colors = accepted.filter((item) => item.kind === "color").flatMap((item) => {
    const value = referenceValueText(item.value);
    return value.match(/#[a-f\d]{6}\b/ig) ?? [];
  }).map((value) => value.toUpperCase());
  const uniqueColors = [...new Set(colors)].slice(0, 6);
  const colorKeys: Array<keyof ProjectData["tokens"]["colors"]> = ["primary", "secondary", "accent", "background", "surface", "text"];
  uniqueColors.forEach((value, index) => { draft.tokens.colors[colorKeys[index]] = value; });
  const fonts = accepted.filter((item) => item.kind === "font").map((item) => referenceValueText(item.value).trim()).filter((value) => value && value.length <= 120);
  if (fonts[0]) draft.tokens.typography.display = fonts[0];
  if (fonts[1]) draft.tokens.typography.body = fonts[1];
  const visual = accepted.find((item) => item.kind === "visual" || item.kind === "rule");
  if (visual) draft.tokens.media.style = referenceValueText(visual.value).slice(0, 240);
}

function projectDraftFromBrief(session: BootstrapSession, brief: StrategicCreativeBriefVersion): ProjectData {
  const draft = structuredClone(defaultProject);
  const now = new Date().toISOString();
  draft.id = `preview-${session.id}`;
  draft.name = session.originalInput.projectName || `${brief.brandSeed.name} Studio`;
  draft.createdAt = now;
  draft.updatedAt = now;
  draft.version = 1;
  draft.brand = structuredClone(brief.brandSeed);
  applyReferenceDesignSignals(draft, session);
  Object.assign(draft.tokens.colors, session.originalInput.colors ?? {});
  draft.tokens.voice.attributes = [...brief.brandSeed.personality, "specific"];
  draft.tokens.voice.forbiddenPatterns = ["game-changing", "revolutionary", "unsupported proof"];
  draft.tokens.media = { style: "purposeful and evidence-led", lighting: "natural or graphic", composition: "direction-specific" };
  draft.landing.eyebrow = brief.brandSeed.industry === "Context to confirm" ? "A clear point of view" : `${brief.brandSeed.industry}, made useful`;
  draft.landing.headline = sentence(brief.brandSeed.promise);
  draft.landing.subhead = `${brief.strategy.positioning} ${brief.strategy.objective}`;
  draft.landing.primaryCta = "Explore the approach";
  draft.landing.secondaryCta = "See the evidence";
  draft.landing.benefits = brief.strategy.contentPriorities.slice(0, 3).map((priority, index) => ({ title: ["Understand", "Decide", "Act"][index] ?? `Priority ${index + 1}`, body: sentence(priority) }));
  const sourceCount = session.sourceRefs.length;
  const factCount = brief.facts.length;
  draft.landing.proof = [
    { value: String(factCount).padStart(2, "0"), label: "supported facts in the brief" },
    { value: String(sourceCount).padStart(2, "0"), label: "reference sources linked" },
    { value: String(brief.unknowns.length).padStart(2, "0"), label: "unknowns kept explicit" }
  ];
  draft.landing.finalHeadline = `Give ${brief.strategy.audience} a clearer next step.`;
  draft.slides = [
    { id: "slide-cover", type: "cover", eyebrow: `${brief.brandSeed.name.toUpperCase()} / CREATIVE BRIEF`, title: sentence(brief.brandSeed.promise), body: brief.summary },
    { id: "slide-value", type: "value", eyebrow: "STRATEGIC PRIORITIES", title: brief.strategy.objective, bullets: brief.strategy.contentPriorities.slice(0, 3) },
    { id: "slide-metrics", type: "metrics", eyebrow: "EVIDENCE STATUS", title: "Create from what is known; label what is not", metrics: structuredClone(draft.landing.proof) }
  ];
  draft.slideDocument = undefined;
  draft.threadId = undefined;
  draft.webCustomized = false;
  draft.lastSummary = "Prepared from an evidence-backed strategic creative brief.";
  return draft;
}

export function deterministicBootstrapSynthesis(session: BootstrapSession): StrategicCreativeBriefVersion {
  const brandName = answerFor(session, "brandName") ?? "Untitled brand";
  const industry = answerFor(session, "industry") ?? "Context to confirm";
  const audience = answerFor(session, "audience") ?? "Audience to confirm";
  const objective = answerFor(session, "objective") ?? answerFor(session, "promise") ?? "Clarify the value and the next action";
  const targetDeliverable = answerFor(session, "targetDeliverable") ?? session.originalInput.deliverables?.[0] ?? "web";
  const fields: Array<[BootstrapField, string | undefined, string]> = [
    ["brandName", answerFor(session, "brandName"), `The user identifies the brand as ${brandName}.`],
    ["industry", answerFor(session, "industry"), `The user places the work in ${industry}.`],
    ["audience", answerFor(session, "audience"), `The intended audience is ${audience}.`],
    ["objective", answerFor(session, "objective") ?? answerFor(session, "promise"), `The user-authored objective is: ${sentence(objective)}`],
    ["targetDeliverable", targetDeliverable, `The first requested deliverable is ${targetDeliverable}.`]
  ];
  const acceptedReference = acceptedReferenceObservations(session).slice(0, 8);
  const referenceFacts = acceptedReference.map((observation) => ({
    id: `fact:reference:${observation.id}`,
    claim: `Reviewed reference evidence identifies a ${observation.kind} signal: ${referenceValueText(observation.value).slice(0, 320)}.`,
    evidenceIds: [observation.id]
  }));
  const facts = [...fields.filter(([, value]) => Boolean(value)).map(([field, , claim]) => ({ id: `fact:${field}`, claim, evidenceIds: [evidenceFor(session, field)] })), ...referenceFacts];
  const unknowns = fields.filter(([, value]) => !value).map(([field]) => `${field} has not been confirmed.`);
  if (session.evidenceSnapshot && session.evidenceSnapshot.evidenceIds.length === 0) unknowns.push("The linked evidence snapshot contains no accepted evidence ids.");
  if (session.referenceSnapshot?.warning) unknowns.push(session.referenceSnapshot.warning.message);
  const sourceNote = session.referenceSnapshot?.observations.length
    ? `${session.referenceSnapshot.observations.length} bounded design observation${session.referenceSnapshot.observations.length === 1 ? " was" : "s were"} extracted from the reference before synthesis.`
    : session.sourceRefs.length ? `${session.sourceRefs.length} source reference${session.sourceRefs.length === 1 ? " is" : "s are"} linked for later evidence review.` : "No external reference source is required for this initial direction.";
  const advisoryReference = session.referenceSnapshot?.observations.find((item) => item.status !== "accepted" && ["visual", "rule", "tone", "font", "color"].includes(item.kind));
  const at = new Date().toISOString();
  const version = session.briefs.length + 1;
  const brief: StrategicCreativeBriefVersion = {
    id: `${session.id}:brief:${version}`,
    version,
    status: "draft",
    createdAt: at,
    createdBy: "system",
    title: `${brandName} strategic creative brief`,
    summary: `${sentence(objective)} The initial ${targetDeliverable} should help ${audience} understand the value quickly and move toward a credible next step. ${sourceNote}`,
    facts,
    inferences: [
      { id: "inference:hierarchy", claim: `A focused hierarchy should make the stated objective legible to ${audience} before introducing supporting detail.`, evidenceIds: [evidenceFor(session, "objective")], confidence: 0.72 },
      ...(advisoryReference ? [{ id: "inference:reference-direction", claim: `The reference suggests exploring this non-binding ${advisoryReference.kind} direction: ${referenceValueText(advisoryReference.value).slice(0, 260)}.`, evidenceIds: [advisoryReference.id], confidence: advisoryReference.confidence }] : [])
    ],
    assumptions: [{ id: "assumption:tone", claim: "A clear, credible and specific tone is an appropriate starting point.", evidenceIds: [], status: "proposed" }],
    unknowns,
    questions: [],
    strategy: {
      audience,
      objective: `Enable ${audience} to understand ${objective.replace(/[.!?]+$/, "").toLowerCase()} and identify a next action.`,
      positioning: `${brandName} should be presented through its stated value, not through unsupported market or performance claims.`,
      voice: "Clear, credible, specific and human.",
      contentPriorities: ["State the audience problem in recognizable language", `Explain how ${brandName} supports the stated objective`, "End each narrative section with a concrete next step"]
    },
    creative: {
      opportunity: "Turn a small set of confirmed inputs into a distinctive hierarchy while keeping assumptions and unknowns visible.",
      designPrinciples: ["Lead with one decisive message", "Use evidence as structure, not decoration", "Create contrast through composition before color"],
      avoid: ["Invented customer or performance metrics", "Generic innovation language", "Directions that differ only by palette"]
    },
    brandSeed: {
      name: brandName,
      industry,
      audience,
      promise: sentence(objective),
      personality: ["clear", "credible", "distinctive"],
      tone: "Clear, credible and human",
      visualDirection: acceptedReference.length
        ? `Evidence-led hierarchy informed by reviewed reference signals: ${acceptedReference.slice(0, 3).map((item) => `${item.kind} (${referenceValueText(item.value).slice(0, 80)})`).join(", ")}`
        : advisoryReference ? `Explore the reference's ${advisoryReference.kind} signal as non-binding inspiration while preserving a distinct composition` : "Evidence-led hierarchy with deliberate contrast and direction-specific composition"
    }
  };
  return validateStrategicCreativeBrief(brief);
}

export type BootstrapSynthesizer = (session: BootstrapSession) => Promise<StrategicCreativeBriefVersion> | StrategicCreativeBriefVersion;

export async function synthesizeBootstrapSession(sessionId: string, synthesizer: BootstrapSynthesizer = deterministicBootstrapSynthesis): Promise<BootstrapSession> {
  const prepared = await mutateSession(sessionId, (session) => {
    if (!new Set(["ready", "review", "failed"]).has(session.status)) throw new Error("Bootstrap is not ready for synthesis.");
    if (session.questions.some((question) => question.required && !session.answers.some((answer) => answer.questionId === question.id && answer.value.trim()))) throw new Error("Required bootstrap questions must be answered before synthesis.");
    assertBootstrapTransition(session.status, "synthesizing");
    session.status = "synthesizing";
    session.error = undefined;
    event(session, "synthesis.started");
    return structuredClone(session);
  });
  try {
    const generated = validateStrategicCreativeBrief(await synthesizer(structuredClone(prepared)));
    return mutateSession(sessionId, (session) => {
      if (session.status !== "synthesizing") throw new Error("Bootstrap synthesis state changed unexpectedly.");
      const version = session.briefs.length + 1;
      const brief = { ...structuredClone(generated), id: `${session.id}:brief:${version}`, version, status: "draft" as const, createdAt: new Date().toISOString() };
      session.briefs = session.briefs.map((item) => item.status === "draft" ? { ...item, status: "superseded" } : item);
      session.briefs.push(brief);
      session.activeBriefVersion = version;
      session.projectDraft = projectDraftFromBrief(session, brief);
      assertBootstrapTransition(session.status, "review");
      session.status = "review";
      event(session, "synthesis.completed", { briefVersion: version });
      return structuredClone(session);
    });
  } catch (error) {
    await mutateSession(sessionId, (session) => {
      if (session.status === "synthesizing") {
        assertBootstrapTransition(session.status, "failed");
        session.status = "failed";
        session.error = { message: error instanceof Error ? error.message : "Bootstrap synthesis failed.", recoverable: true, at: new Date().toISOString() };
        event(session, "synthesis.failed");
      }
    });
    throw error;
  }
}

export async function reviseBootstrapBrief(sessionId: string, expectedVersion: number, rawBrief: StrategicCreativeBriefVersion): Promise<BootstrapSession> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("An expected brief version is required.");
  return mutateSession(sessionId, (session) => {
    if (session.status !== "review" || session.activeBriefVersion !== expectedVersion) throw new Error("Brief version conflict or bootstrap is not in review.");
    const version = session.briefs.length + 1;
    const brief = validateStrategicCreativeBrief({ ...structuredClone(rawBrief), id: `${session.id}:brief:${version}`, version, status: "draft", createdAt: new Date().toISOString(), createdBy: "user" });
    session.briefs = session.briefs.map((item) => item.status === "draft" ? { ...item, status: "superseded" } : item);
    session.briefs.push(brief);
    session.activeBriefVersion = version;
    session.projectDraft = projectDraftFromBrief(session, brief);
    event(session, "brief.revised", { briefVersion: version });
    return structuredClone(session);
  });
}

function approvalProjectIds(session: BootstrapSession, brandName: string) {
  const suffix = assertSessionId(session.id).slice(4);
  const slug = brandName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "project";
  return { pendingProjectId: `bootstrap-approved-${suffix}`, finalProjectId: `${slug}-${suffix}` };
}

type ApprovalProject = ProjectData & { bootstrapApproval?: { sessionId: string; inputHash: string } };

function assertApprovalProject(project: ApprovalProject, session: BootstrapSession) {
  if (project.bootstrapApproval?.sessionId !== session.id || project.bootstrapApproval.inputHash !== session.inputHash) throw new Error("Approval target collision: the project does not belong to this bootstrap session.");
  return project;
}

function resolveProjectRelative(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  const fromRoot = path.relative(root, resolved);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) throw new Error("Provenance path escapes the project.");
  return resolved;
}

async function validateMigratedSources(projectId: string, snapshot: BootstrapReferenceSnapshot, graphProjectId = projectId) {
  const root = await safeProjectRoot(projectId);
  const graph = JSON.parse(await readFile(await safeProjectPath(projectId, "sources", "graph.json"), "utf8")) as {
    projectId?: string;
    sources?: Array<{ id: string; contentHash: string; storage: { blobPath: string } }>;
    extractionRuns?: Array<{ id: string; sourceId: string }>;
    candidates?: Array<{ value?: unknown }>;
  };
  if (graph.projectId !== graphProjectId) throw new Error("Migrated provenance graph targets the wrong project.");
  const source = graph.sources?.find((item) => item.id === snapshot.sourceId && item.contentHash === snapshot.sourceContentHash);
  if (!source) throw new Error("Migrated provenance source does not match the prepared reference.");
  if (snapshot.runId && !graph.extractionRuns?.some((run) => run.id === snapshot.runId && run.sourceId === source.id)) throw new Error("Migrated extraction run is missing.");
  await readFile(resolveProjectRelative(root, source.storage.blobPath));
  for (const candidate of graph.candidates ?? []) {
    if (!candidate.value || typeof candidate.value !== "object" || Array.isArray(candidate.value)) continue;
    const manifestPath = (candidate.value as { evidenceType?: unknown; manifestPath?: unknown }).evidenceType === "capture-manifest" ? (candidate.value as { manifestPath?: unknown }).manifestPath : undefined;
    if (typeof manifestPath === "string") await readFile(resolveProjectRelative(root, manifestPath));
  }
}

async function migrateBootstrapReferenceSources(session: BootstrapSession, projectId: string) {
  const snapshot = session.referenceSnapshot;
  if (!snapshot) return;
  const expectedStaging = `bootstrap-${assertSessionId(session.id).slice(4)}`;
  if (snapshot.stagingProjectId !== expectedStaging) throw new Error("Invalid bootstrap staging project.");
  const stagingProjectId = snapshot.stagingProjectId;
  const stagingSources = await safeProjectPath(stagingProjectId, "sources");
  const stagingGraph = path.join(stagingSources, "graph.json");
  let graph: Record<string, unknown>;
  try {
    graph = JSON.parse(await readFile(stagingGraph, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const finalSources = await safeProjectPath(projectId, "sources");
  try {
    const existing = JSON.parse(await readFile(path.join(finalSources, "graph.json"), "utf8")) as { projectId?: string };
    if (existing.projectId === projectId) {
      await validateMigratedSources(projectId, snapshot);
      return;
    }
    throw new Error("The approved project already contains a different provenance graph.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = await safeProjectPath(projectId, `.sources-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await cp(stagingSources, temporary, { recursive: true, errorOnExist: true });
    graph.projectId = projectId;
    await writeAtomic(path.join(temporary, "graph.json"), graph);
    await renameWithRetry(temporary, finalSources);
    await validateMigratedSources(projectId, snapshot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupBootstrapStaging(sessionId: string, stagingProjectId?: string) {
  if (stagingProjectId !== `bootstrap-${assertSessionId(sessionId).slice(4)}`) return;
  await rm(await safeProjectRoot(stagingProjectId), { recursive: true, force: true });
}

async function projectExists(projectId: string) {
  try { await readFile(await safeProjectPath(projectId, "project.json"), "utf8"); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function rewriteProjectIdentity(projectId: string, finalProjectId: string) {
  for (const relative of [["project.json"], ["history", "initial.json"]]) {
    const file = await safeProjectPath(projectId, ...relative);
    const project = JSON.parse(await readFile(file, "utf8")) as ProjectData;
    project.id = finalProjectId;
    await writeAtomic(file, project);
  }
  const graphPath = await safeProjectPath(projectId, "sources", "graph.json");
  try {
    const graph = JSON.parse(await readFile(graphPath, "utf8")) as Record<string, unknown>;
    graph.projectId = finalProjectId;
    await writeAtomic(graphPath, graph);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function materializeApprovedProject(session: BootstrapSession) {
  if (!session.approval || !session.projectDraft) throw new Error("Bootstrap approval journal is unavailable.");
  const { pendingProjectId, finalProjectId } = session.approval;
  if (await projectExists(finalProjectId)) {
    assertApprovalProject(await loadProject(finalProjectId) as ApprovalProject, session);
    if (session.referenceSnapshot?.sourceId) await validateMigratedSources(finalProjectId, session.referenceSnapshot);
    return loadProject(finalProjectId);
  }
  if (!(await projectExists(pendingProjectId))) {
    const pending = structuredClone(session.projectDraft) as ApprovalProject;
    pending.id = pendingProjectId;
    pending.createdAt = session.approval.startedAt;
    pending.updatedAt = session.approval.startedAt;
    pending.version = 1;
    pending.threadId = undefined;
    pending.webCustomized = false;
    pending.bootstrapApproval = { sessionId: session.id, inputHash: session.inputHash };
    await saveProject(pending, { touch: false, writeInitial: true });
  } else assertApprovalProject(await loadProject(pendingProjectId) as ApprovalProject, session);
  await migrateBootstrapReferenceSources(session, pendingProjectId);
  if (session.referenceSnapshot?.sourceId) await validateMigratedSources(pendingProjectId, session.referenceSnapshot);
  const finalizingProjectId = `bootstrap-finalizing-${assertSessionId(session.id).slice(4)}`;
  await rm(await safeProjectRoot(finalizingProjectId), { recursive: true, force: true });
  await cp(await safeProjectRoot(pendingProjectId), await safeProjectRoot(finalizingProjectId), { recursive: true, errorOnExist: true });
  await rewriteProjectIdentity(finalizingProjectId, finalProjectId);
  if (session.referenceSnapshot?.sourceId) await validateMigratedSources(finalizingProjectId, session.referenceSnapshot, finalProjectId);
  await renameWithRetry(await safeProjectRoot(finalizingProjectId), await safeProjectRoot(finalProjectId));
  return loadProject(finalProjectId);
}

async function clearApprovalProjectMarker(projectId: string, session: BootstrapSession) {
  const project = assertApprovalProject(await loadProject(projectId) as ApprovalProject, session);
  delete project.bootstrapApproval;
  await writeAtomic(await safeProjectPath(projectId, "project.json"), project);
  const initialPath = await safeProjectPath(projectId, "history", "initial.json");
  const initial = JSON.parse(await readFile(initialPath, "utf8")) as ApprovalProject;
  if (initial.bootstrapApproval?.sessionId === session.id && initial.bootstrapApproval.inputHash === session.inputHash) {
    delete initial.bootstrapApproval;
    await writeAtomic(initialPath, initial);
  }
}

export async function approveBootstrapSession(sessionId: string, briefVersion?: number): Promise<{ session: BootstrapSession; project: ProjectData }> {
  const prepared = await mutateSession(sessionId, async (session) => {
    if (session.status === "approved" && session.createdProjectId) return structuredClone(session);
    if (session.status === "approving" && session.approval) return structuredClone(session);
    if (session.status !== "review" || !session.projectDraft || !session.activeBriefVersion) throw new Error("Bootstrap must be synthesized and reviewed before approval.");
    if (briefVersion !== undefined && briefVersion !== session.activeBriefVersion) throw new Error("Brief version conflict.");
    const brief = session.briefs.find((item) => item.version === session.activeBriefVersion && item.status === "draft");
    if (!brief) throw new Error("The active strategic creative brief is unavailable.");
    assertBootstrapTransition(session.status, "approving");
    const ids = approvalProjectIds(session, brief.brandSeed.name);
    session.status = "approving";
    session.approval = { status: "pending", ...ids, startedAt: new Date().toISOString() };
    session.updatedAt = session.approval.startedAt;
    return structuredClone(session);
  });
  if (prepared.status === "approved" && prepared.createdProjectId) {
    await Promise.all([
      cleanupBootstrapStaging(sessionId, prepared.referenceSnapshot?.stagingProjectId),
      prepared.approval ? rm(await safeProjectRoot(prepared.approval.pendingProjectId), { recursive: true, force: true }) : Promise.resolve()
    ]);
    const persisted = JSON.parse(await readFile(await safeProjectPath(prepared.createdProjectId, "project.json"), "utf8")) as ApprovalProject;
    if (persisted.bootstrapApproval) await clearApprovalProjectMarker(prepared.createdProjectId, prepared);
    return { session: prepared, project: await loadProject(prepared.createdProjectId) };
  }
  const project = await materializeApprovedProject(prepared);
  const session = await mutateSession(sessionId, (current) => {
    if (current.status !== "approving" || current.approval?.finalProjectId !== project.id || !current.activeBriefVersion) throw new Error("Bootstrap approval state changed unexpectedly.");
    const brief = current.briefs.find((item) => item.version === current.activeBriefVersion && item.status === "draft");
    if (!brief) throw new Error("The active strategic creative brief is unavailable.");
    brief.status = "approved";
    assertBootstrapTransition(current.status, "approved");
    current.status = "approved";
    current.createdProjectId = project.id;
    event(current, "approved", { briefVersion: brief.version, projectId: project.id });
    return structuredClone(current);
  });
  await Promise.all([
    cleanupBootstrapStaging(sessionId, session.referenceSnapshot?.stagingProjectId),
    rm(await safeProjectRoot(prepared.approval!.pendingProjectId), { recursive: true, force: true })
  ]);
  await clearApprovalProjectMarker(project.id, session);
  return { session, project: await loadProject(project.id) };
}
