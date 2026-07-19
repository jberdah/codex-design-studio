"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectData, ProjectSummary, ReviewReport, SelectionContext } from "@/domain/types";
import type { SlideDocument } from "@/domain/artifacts";
import type { BootstrapSession, StrategicCreativeBriefVersion as BootstrapBriefVersion } from "@/domain/bootstrap";
import { projectSlideDocument, projectWithSlideDocument } from "@/domain/slide-editing";
import type { EvidenceDirective, EvidenceKind, ProvenanceGraph, SourceIntent, SourceKind } from "@/domain/sources";
import type { ArtifactKind, BrandSystemRegistry, ReconciliationAction, ReconciliationReview } from "@/domain/brand-system";
import { SlidePreview } from "./SlidePreview";
import { VisualAssetStudio } from "./VisualAssetStudio";
import { ArtifactCanvasEditor } from "./ArtifactCanvasEditor";

type Surface = "sources" | "reconcile" | "brand" | "system" | "assets" | "web" | "slides";
type ApiProject = { project: ProjectData; landingHtml: string };
type AccountState = { account: null | { type: "apiKey" } | { type: "chatgpt"; email: string | null; planType: string }; requiresOpenaiAuth: boolean };
type PendingWebCandidate = {
  id: string;
  summary: string;
  assessment: {
    reasons: string[];
    comparisons: Record<string, { before: { failures: number; inconclusive: number }; after: { failures: number; inconclusive: number }; regressions: string[]; warnings?: string[] }>;
  };
};
type BootstrapStep = 1 | 2 | 3 | 4;
type BootstrapDeliverable = "web" | "slides";
type BootstrapInput = {
  brandName: string;
  objective: string;
  audience: string;
  deliverable: BootstrapDeliverable;
  referenceUrl: string;
  referenceIntent: "extract" | "inspire";
  lockOriginal: boolean;
};

const emptyBootstrap: BootstrapInput = {
  brandName: "",
  objective: "",
  audience: "",
  deliverable: "web",
  referenceUrl: "",
  referenceIntent: "extract",
  lockOriginal: false
};

function activeBootstrapBrief(session: BootstrapSession) {
  return session.briefs.find((brief) => brief.version === session.activeBriefVersion) ?? session.briefs.at(-1);
}

function manualCreativeBrief(input: BootstrapInput): BootstrapBriefVersion {
  const audience = input.audience.trim() || "an audience still to be clarified";
  const medium = input.deliverable === "web" ? "focused Web experience" : "clear presentation narrative";
  const objective = `${input.brandName.trim()} should turn its stated ambition into a ${medium} that helps ${audience} understand why it matters and what to do next.`;
  return {
    id: "manual-bootstrap-brief",
    version: 1,
    status: "draft",
    createdAt: new Date().toISOString(),
    createdBy: "user",
    title: `${input.brandName.trim()} creative brief`,
    summary: objective,
    facts: [
      { id: "manual-brand-name", claim: `The brand name is ${input.brandName.trim()}.`, evidenceIds: [] },
      { id: "manual-original-objective", claim: `The creator's original wording is: “${input.objective.trim()}”`, evidenceIds: [] },
      { id: "manual-deliverable", claim: `The first deliverable is ${input.deliverable === "web" ? "Web" : "Slides"}.`, evidenceIds: [] }
    ],
    inferences: [{ id: "manual-clarity", claim: "The first direction should prioritize a clear hierarchy and a decisive next action.", evidenceIds: [], confidence: 0.55 }],
    assumptions: input.audience.trim() ? [] : [{ id: "manual-audience", claim: "The primary audience still needs confirmation.", status: "proposed", evidenceIds: [] }],
    unknowns: input.audience.trim() ? ["Industry and competitive context remain open."] : ["Primary audience, industry and competitive context remain open."],
    questions: [],
    strategy: {
      audience,
      objective,
      positioning: "Make the value concrete without inventing unsupported brand claims.",
      voice: "Clear, purposeful and specific.",
      contentPriorities: ["Value proposition", "Audience relevance", "Next action"]
    },
    creative: {
      opportunity: `Use the ${input.deliverable === "web" ? "page" : "story"} structure to turn the raw objective into a distinctive, testable direction.`,
      designPrinciples: ["Lead with one strong idea", "Make hierarchy visible", "Keep the source wording traceable"],
      avoid: ["Generic decorative styling", "Unsupported claims", "Copying a reference site's assets or copy"]
    },
    brandSeed: {
      name: input.brandName.trim(),
      industry: "To be defined",
      audience,
      promise: input.lockOriginal ? input.objective.trim() : objective,
      personality: ["purposeful", "clear"],
      tone: "Clear and purposeful",
      visualDirection: input.deliverable === "web" ? "Distinctive digital-first hierarchy" : "Structured editorial storytelling"
    }
  };
}

function isPublicReferenceUrl(value: string) {
  if (!value.trim()) return true;
  try { return ["http:", "https:"].includes(new URL(value.trim()).protocol); }
  catch { return false; }
}

const nav: Array<{ id: Surface; label: string; glyph: string }> = [
  { id: "sources", label: "Sources", glyph: "⊕" },
  { id: "reconcile", label: "Reconcile", glyph: "≋" },
  { id: "brand", label: "Brand", glyph: "✦" },
  { id: "system", label: "Design system", glyph: "◫" },
  { id: "assets", label: "Visual assets", glyph: "◉" },
  { id: "web", label: "Landing page", glyph: "⌁" },
  { id: "slides", label: "Presentation", glyph: "▰" }
];

export function Studio() {
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [data, setData] = useState<ApiProject | null>(null);
  const [projectId, setProjectId] = useState("demo");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [account, setAccount] = useState<AccountState>();
  const [apiKey, setApiKey] = useState("");
  const [bootstrapStep, setBootstrapStep] = useState<BootstrapStep>(1);
  const [bootstrapInput, setBootstrapInput] = useState<BootstrapInput>(emptyBootstrap);
  const [bootstrapSession, setBootstrapSession] = useState<BootstrapSession>();
  const [bootstrapBrief, setBootstrapBrief] = useState<BootstrapBriefVersion>();
  const [bootstrapAnswers, setBootstrapAnswers] = useState<Record<string, string>>({});
  const [bootstrapError, setBootstrapError] = useState<string>();
  const [manualBootstrap, setManualBootstrap] = useState(false);
  const [surface, setSurface] = useState<Surface>("web");
  const [selection, setSelection] = useState<SelectionContext>();
  const [instruction, setInstruction] = useState("Make this hero feel more premium and concise");
  const [busy, setBusy] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [review, setReview] = useState<ReviewReport>();
  const [pendingWebCandidate, setPendingWebCandidate] = useState<{ candidate: PendingWebCandidate; html: string }>();
  const [candidatePreview, setCandidatePreview] = useState<"candidate" | "original">("candidate");
  const [mobile, setMobile] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideDocument, setSlideDocument] = useState<SlideDocument>();
  const [slideEditing, setSlideEditing] = useState(false);
  const projectVersion = useRef(0);
  const projectSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const accountPollToken = useRef(0);
  const [agent, setAgent] = useState<{ available: boolean; model: string; cliVersion: string }>();
  const [provenance, setProvenance] = useState<ProvenanceGraph>();
  const [reconciliation, setReconciliation] = useState<ReconciliationReview>();
  const [systemRegistry, setSystemRegistry] = useState<BrandSystemRegistry>();
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceIntent, setSourceIntent] = useState<SourceIntent>("extract");
  const [rightsNotes, setRightsNotes] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [manualEvidence, setManualEvidence] = useState<{ kind: EvidenceKind; value: string; directive: EvidenceDirective }>({ kind: "color", value: "", directive: "must-use" });
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "Your brand system is ready. Select anything in the landing preview, then describe what should change." }
  ]);

  const load = useCallback(async (id: string) => {
    const response = await fetch(`/api/project?project=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the demo project.");
    const result = await response.json() as ApiProject;
    setData(result);
    setSlideDocument(projectSlideDocument(result.project));
    projectVersion.current = result.project.version;
  }, []);

  const loadSources = useCallback(async (id: string) => {
    const response = await fetch(`/api/sources?project=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load project sources.");
    const result = await response.json() as { graph: ProvenanceGraph };
    setProvenance(result.graph);
  }, []);

  const loadBrandSystems = useCallback(async (id: string) => {
    const response = await fetch(`/api/brand-systems?project=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load BrandSystem review state.");
    const result = await response.json() as { registry: BrandSystemRegistry; reconciliation: ReconciliationReview };
    setSystemRegistry(result.registry); setReconciliation(result.reconciliation);
  }, []);

  const enqueueProjectSave = useCallback((operation: () => Promise<void>) => {
    const pending = projectSaveQueue.current.then(operation);
    projectSaveQueue.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const persistWebInlineEdit = useCallback((designId: string, text: string) => {
    const field = designId === "hero-title" ? "headline" : designId === "hero-eyebrow" ? "eyebrow" : designId === "hero-copy" ? "subhead" : undefined;
    if (!field) { setToast("This composite element must be edited through its generated controls."); return; }
    void enqueueProjectSave(async () => {
      const response = await fetch(`/api/project?project=${encodeURIComponent(projectId)}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ landing: { [field]: text }, expectedVersion: projectVersion.current }), keepalive: true
      });
      const result = await response.json() as ApiProject & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not persist inline text.");
      projectVersion.current = result.project.version;
      setData(result);
      setToast("Inline text saved to source.");
    }).catch((error) => setToast(error instanceof Error ? error.message : "Could not persist inline text."));
  }, [enqueueProjectSave, projectId]);

  useEffect(() => {
    const initialProject = new URL(window.location.href).searchParams.get("project") ?? "demo";
    setProjectId(initialProject);
    load(initialProject).catch((error) => setToast(error.message));
    loadSources(initialProject).catch((error) => setToast(error.message));
    loadBrandSystems(initialProject).catch((error) => setToast(error.message));
    fetch("/api/projects", { cache: "no-store" }).then((response) => response.json()).then((result) => setProjects(result.projects ?? [])).catch(() => undefined);
    fetch("/api/account", { cache: "no-store" }).then((response) => response.json()).then(setAccount).catch(() => setAccount({ account: null, requiresOpenaiAuth: true }));
    fetch("/api/agent/status").then((response) => response.json()).then(setAgent).catch(() => undefined);
  }, [load, loadSources, loadBrandSystems]);

  useEffect(() => { if (data?.project) projectVersion.current = data.project.version; }, [data?.project.version]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (event.data?.type === "design-selection") {
        setSelection(event.data.selection as SelectionContext);
        setInstruction("");
        setMessages((current) => [...current, { role: "assistant", text: `${event.data.selection.label} selected. What would you like to change?` }]);
      }
      if (event.data?.type === "design-inline-edit" && typeof event.data.designId === "string" && typeof event.data.text === "string") persistWebInlineEdit(event.data.designId, event.data.text);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [persistWebInlineEdit]);

  const project = data?.project;
  const apiForProject = (pathname: string) => `${pathname}?project=${encodeURIComponent(projectId)}`;
  const updateProject = (updater: (project: ProjectData) => ProjectData) => setData((current) => current ? { ...current, project: updater(structuredClone(current.project)) } : current);

  async function saveSystem() {
    if (!project) return;
    setBusy("Saving brand system");
    try {
      const response = await fetch(apiForProject("/api/brand-systems"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "draft", brand: project.brand, tokens: project.tokens }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create draft.");
      setSystemRegistry(result.registry);
      setToast(`Draft v${result.snapshot.number} saved. No artifact changed.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create draft.");
    } finally { setBusy(undefined); }
  }

  async function publishDraft(versionId: string) {
    setBusy("Publishing BrandSystem transaction");
    try {
      const response = await fetch(apiForProject("/api/brand-systems"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", versionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Publication failed.");
      setSystemRegistry(result.registry); setData((current) => current ? { ...current, project: result.project } : current);
      setToast(`BrandSystem v${result.snapshot.number} published. Artifact bindings remain controlled.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Publication failed."); }
    finally { setBusy(undefined); }
  }

  async function decideReconciliation(groupId: string, action: ReconciliationAction, optionId?: string) {
    const overrideValue = action === "override" ? window.prompt("Enter the authoritative replacement value") : undefined;
    if (action === "override" && !overrideValue) return;
    setBusy("Recording reconciliation decision");
    try {
      const response = await fetch(apiForProject("/api/reconciliation"), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, action, optionId, overrideValue }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Decision failed.");
      setReconciliation(result.reconciliation); setToast("Decision saved with its original evidence intact.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Decision failed."); }
    finally { setBusy(undefined); }
  }

  async function bindArtifact(artifactId: ArtifactKind, versionId: string, action: "upgrade" | "rollback") {
    setBusy(`${action === "upgrade" ? "Upgrading" : "Rolling back"} ${artifactId}`);
    try {
      const response = await fetch(apiForProject(`/api/brand-systems/${encodeURIComponent(versionId)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId, action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Binding change failed.");
      setSystemRegistry(result.registry); setToast(result.artifactPreserved ? "Binding changed; independent Web composition was preserved." : "Artifact binding changed explicitly.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Binding change failed."); }
    finally { setBusy(undefined); }
  }

  async function previewBinding(artifactId: ArtifactKind, versionId: string) {
    try {
      const response = await fetch(apiForProject(`/api/brand-systems/${encodeURIComponent(versionId)}`) + `&artifact=${artifactId}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return setToast(result.error ?? "Preview failed.");
      setToast(`Preview only · ${artifactId} would use v${result.targetVersion.number}; no files changed.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Preview failed.");
    }
  }

  async function refine() {
    if (!project || !instruction.trim()) return;
    const request = instruction.trim();
    setMessages((current) => [...current, { role: "user", text: request }]);
    setInstruction("");
    setBusy("Codex is analysing the selected context");
    try {
      const mode = process.env.NEXT_PUBLIC_CODEX_STUDIO_MODE === "fallback" ? "fallback" : "auto";
      const response = await fetch(apiForProject("/api/refine"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: request, selection, deliverable: surface, mode }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Refinement failed");
      setData({ project: result.project, landingHtml: result.landingHtml });
      setSlideDocument(projectSlideDocument(result.project));
      if (result.candidate && typeof result.candidateHtml === "string") {
        setPendingWebCandidate({ candidate: result.candidate, html: result.candidateHtml });
        setCandidatePreview("candidate");
        setMessages((current) => [...current, { role: "assistant", text: `${result.summary} I kept it as a candidate because the visual checks found possible regressions. The candidate is visible in the preview; you decide whether to accept it.` }]);
        setToast("Candidate ready · review the checks before deciding.");
        return;
      }
      const assistantText = result.changed === false
        ? `${result.unsupportedReason ?? result.summary} No source change was applied.`
        : `${result.summary} ${result.source === "codex" ? "Applied and visually checked by Codex." : "Applied with the reliable demo fallback."}`;
      setMessages((current) => [...current, { role: "assistant", text: assistantText }]);
      setToast(result.warning ?? (result.changed === false ? "No supported source change." : `${result.filesModified.length} source files updated.`));
    } catch (error) {
      setInstruction(request);
      setMessages((current) => [...current, { role: "assistant", text: error instanceof Error ? error.message : "Refinement failed." }]);
    } finally { setBusy(undefined); }
  }

  async function resolveWebCandidate(action: "accept" | "reject") {
    if (!pendingWebCandidate) return;
    setBusy(action === "accept" ? "Accepting candidate with warnings" : "Keeping the original version");
    try {
      const response = await fetch(apiForProject("/api/refine/candidate"), {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: pendingWebCandidate.candidate.id, action })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not resolve the candidate.");
      setData({ project: result.project, landingHtml: result.landingHtml });
      projectVersion.current = result.project.version;
      setMessages((current) => [...current, { role: "assistant", text: action === "accept" ? "Candidate accepted with its QA warnings recorded. It is now the active Web version." : "Original version kept. The candidate remains recorded in project history." }]);
      setToast(action === "accept" ? "Candidate accepted with warnings." : "Original version kept.");
      setPendingWebCandidate(undefined);
      setCandidatePreview("candidate");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not resolve the candidate.");
    } finally { setBusy(undefined); }
  }

  async function runReview() {
    setBusy("Checking brand consistency");
    try {
      const response = await fetch(apiForProject("/api/review"), { method: "POST" });
      const report = await response.json().catch(() => ({})) as ReviewReport & { error?: string };
      if (!response.ok || typeof report.score !== "number") throw new Error(report.error ?? "The review could not be completed.");
      setReview(report);
      setToast(`Review complete · ${report.score}/100`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The review could not be completed.");
    } finally { setBusy(undefined); }
  }

  async function reset() {
    setBusy("Restoring project");
    try {
      const response = await fetch(apiForProject("/api/project/reset"), { method: "POST" });
      const restored = await response.json().catch(() => ({})) as ApiProject & { error?: string };
      if (!response.ok || !restored.project) throw new Error(restored.error ?? "Could not restore the project.");
      setData(restored); setSlideDocument(projectSlideDocument(restored.project)); projectVersion.current = restored.project.version;
      setSelection(undefined); setReview(undefined); setSlideEditing(false); setActiveSlide(0);
      setMessages([{ role: "assistant", text: "Project restored. Its initial brand system and deliverables are ready." }]);
      setToast("Project restored.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not restore the project.");
    } finally { setBusy(undefined); }
  }

  async function switchProject(id: string) {
    const previousId = projectId;
    setProjectId(id);
    window.history.replaceState({}, "", `/?project=${encodeURIComponent(id)}`);
    setData(null); setSelection(undefined); setReview(undefined); setSlideEditing(false); setActiveSlide(0);
    try {
      await Promise.all([load(id), loadSources(id), loadBrandSystems(id)]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not open the project.");
      if (previousId !== id) {
        setProjectId(previousId);
        window.history.replaceState({}, "", `/?project=${encodeURIComponent(previousId)}`);
        await Promise.all([load(previousId), loadSources(previousId), loadBrandSystems(previousId)]).catch(() => undefined);
      }
    }
  }

  async function saveSlideCanvas(document: SlideDocument) {
    setSlideDocument(document);
    if (!data?.project) throw new Error("The project is no longer available.");
    const updated = projectWithSlideDocument(data.project, document);
    try {
      await enqueueProjectSave(async () => {
      const response = await fetch(`/api/project?project=${encodeURIComponent(projectId)}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides: updated.slides, slideDocument: document, expectedVersion: projectVersion.current }), keepalive: true
      });
      const result = await response.json() as ApiProject & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not persist slide edits.");
      projectVersion.current = result.project.version;
      setData(result);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not persist slide edits.";
      setToast(message);
      throw new Error(message);
    }
  }

  async function addUrlSource() {
    if (!sourceUrl.trim()) return;
    setBusy("Adding source");
    try {
      const response = await fetch(apiForProject("/api/sources"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: sourceUrl, intent: sourceIntent, rightsNotes, rightsConfirmed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not add source.");
      setSourceUrl("");
      await Promise.all([loadSources(projectId), loadBrandSystems(projectId)]);
      setToast(result.deduplicated ? "Duplicate source linked to the existing original." : "Source added and extraction queued.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not add source."); }
    finally { setBusy(undefined); }
  }

  async function addFiles(files: FileList | null, kind?: SourceKind) {
    if (!files?.length) return;
    setBusy(`Adding ${files.length} source${files.length === 1 ? "" : "s"}`);
    try {
      let duplicates = 0;
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.set("file", file); body.set("intent", sourceIntent); body.set("rightsNotes", rightsNotes); body.set("rightsConfirmed", String(rightsConfirmed));
        if (kind) body.set("kind", kind);
        const response = await fetch(apiForProject("/api/sources"), { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `Could not add ${file.name}.`);
        if (result.deduplicated) duplicates += 1;
      }
      await Promise.all([loadSources(projectId), loadBrandSystems(projectId)]);
      setToast(duplicates ? `${files.length} sources processed · ${duplicates} duplicate${duplicates === 1 ? "" : "s"}.` : `${files.length} source${files.length === 1 ? "" : "s"} queued.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not add source files."); }
    finally { setBusy(undefined); }
  }

  async function sourceAction(sourceId: string, action: "retry" | "refresh" | "reprocess" | "remove") {
    setBusy(`${action[0].toUpperCase()}${action.slice(1)} source`);
    try {
      const response = await fetch(apiForProject(`/api/sources/${encodeURIComponent(sourceId)}`), action === "remove" ? { method: "DELETE" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Source action failed.");
      await Promise.all([loadSources(projectId), loadBrandSystems(projectId)]);
      setToast(action === "remove" ? "Source removed; its original remains recoverable." : "Extraction queued.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Source action failed."); }
    finally { setBusy(undefined); }
  }

  async function cancelRun(runId: string) {
    try {
      const response = await fetch(apiForProject(`/api/extraction-runs/${encodeURIComponent(runId)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return setToast(result.error ?? "Could not cancel extraction.");
      await loadSources(projectId); setToast("Extraction cancelled.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not cancel extraction.");
    }
  }

  async function addEvidence() {
    if (!manualEvidence.value.trim()) return;
    setBusy("Recording evidence");
    try {
      const response = await fetch(apiForProject("/api/evidence"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...manualEvidence, intent: sourceIntent, rightsNotes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not add evidence.");
      setManualEvidence((current) => ({ ...current, value: "" }));
      await Promise.all([loadSources(projectId), loadBrandSystems(projectId)]); setToast("Manual evidence added with explicit provenance.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not add evidence."); }
    finally { setBusy(undefined); }
  }

  function openBootstrapWizard() {
    setBootstrapStep(1);
    setBootstrapInput(emptyBootstrap);
    setBootstrapSession(undefined);
    setBootstrapBrief(undefined);
    setBootstrapAnswers({});
    setBootstrapError(undefined);
    setManualBootstrap(false);
    setShowNewProject(true);
  }

  async function parseBootstrapResponse(response: Response, fallback: string) {
    const result = await response.json().catch(() => ({})) as { error?: string; session?: BootstrapSession; project?: ProjectData };
    if (!response.ok) throw new Error(result.error ?? fallback);
    return result;
  }

  async function startBootstrap() {
    setBootstrapStep(3);
    setBootstrapError(undefined);
    setBusy("Synthesizing project context");
    try {
      const referenceUrl = bootstrapInput.referenceUrl.trim();
      const response = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {
          projectName: bootstrapInput.brandName.trim(),
          brandName: bootstrapInput.brandName.trim(),
          audience: bootstrapInput.audience.trim() || undefined,
          objective: bootstrapInput.objective.trim(),
          targetDeliverable: bootstrapInput.deliverable,
          sourceRefs: referenceUrl ? [{
            id: "bootstrap-reference-url",
            kind: "url",
            label: new URL(referenceUrl).hostname,
            intent: bootstrapInput.referenceIntent,
            locator: referenceUrl
          }] : []
        } })
      });
      const result = await parseBootstrapResponse(response, "Could not start the project brief.");
      if (!result.session) throw new Error("The bootstrap service did not return a session.");
      setBootstrapSession(result.session);
      setBootstrapAnswers(Object.fromEntries(result.session.answers.map((answer) => [answer.questionId, answer.value])));
      const brief = activeBootstrapBrief(result.session);
      if (brief) setBootstrapBrief(brief);
      if (!result.session.questions.length && !brief) await synthesizeBootstrap(result.session, {});
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "Could not start the project brief.");
    } finally { setBusy(undefined); }
  }

  async function synthesizeBootstrap(sessionOverride?: BootstrapSession, answersOverride?: Record<string, string>) {
    const currentSession = sessionOverride ?? bootstrapSession;
    if (!currentSession) return;
    const answers = answersOverride ?? bootstrapAnswers;
    const requiredMissing = currentSession.questions.slice(0, 3).some((question) => question.required && !answers[question.id]?.trim());
    if (requiredMissing) { setBootstrapError("Answer the required questions or continue manually."); return; }
    setBusy("Turning evidence into a creative brief");
    setBootstrapError(undefined);
    try {
      let session = currentSession;
      if (session.questions.length) {
        const response = await fetch(`/api/bootstrap/${encodeURIComponent(session.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers: session.questions.slice(0, 3).map((question) => ({ questionId: question.id, value: answers[question.id]?.trim() ?? "" })).filter((answer) => answer.value) })
        });
        const result = await parseBootstrapResponse(response, "Could not save the focused answers.");
        if (!result.session) throw new Error("The bootstrap service did not return the updated session.");
        session = result.session;
      }
      const response = await fetch(`/api/bootstrap/${encodeURIComponent(session.id)}/synthesize`, { method: "POST" });
      const result = await parseBootstrapResponse(response, "Could not synthesize the creative brief.");
      if (!result.session) throw new Error("The bootstrap service did not return a synthesized session.");
      const brief = activeBootstrapBrief(result.session);
      if (!brief) throw new Error("No creative brief was produced. You can retry or continue manually.");
      setBootstrapSession(result.session);
      setBootstrapBrief(brief);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "Could not synthesize the creative brief.");
    } finally { setBusy(undefined); }
  }

  function continueBootstrapManually() {
    setManualBootstrap(true);
    setBootstrapSession(undefined);
    setBootstrapBrief(manualCreativeBrief(bootstrapInput));
    setBootstrapError(undefined);
  }

  async function reviewBootstrapApproval() {
    if (!bootstrapBrief) return;
    setBootstrapError(undefined);
    if (!bootstrapSession || manualBootstrap) { setBootstrapStep(4); return; }
    setBusy("Saving the reviewed creative brief");
    try {
      const reviewedBrief = bootstrapInput.lockOriginal
        ? { ...bootstrapBrief, brandSeed: { ...bootstrapBrief.brandSeed, promise: bootstrapInput.objective.trim() } }
        : bootstrapBrief;
      const response = await fetch(`/api/bootstrap/${encodeURIComponent(bootstrapSession.id)}/brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: reviewedBrief, expectedVersion: bootstrapSession.activeBriefVersion ?? bootstrapBrief.version })
      });
      const result = await parseBootstrapResponse(response, "Could not save the reviewed creative brief.");
      if (!result.session) throw new Error("The bootstrap service did not return the reviewed session.");
      setBootstrapSession(result.session);
      setBootstrapBrief(activeBootstrapBrief(result.session) ?? reviewedBrief);
      setBootstrapStep(4);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "Could not save the reviewed creative brief.");
    } finally { setBusy(undefined); }
  }

  async function attachBootstrapReference(createdProjectId: string) {
    if (!bootstrapInput.referenceUrl.trim()) return undefined;
    try {
      const extract = bootstrapInput.referenceIntent === "extract";
      const response = await fetch(`/api/sources?project=${encodeURIComponent(createdProjectId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: bootstrapInput.referenceUrl.trim(),
          bootstrapReference: true,
          intent: bootstrapInput.referenceIntent,
          sourceRole: extract ? "evidence" : "inspiration",
          relationship: "unknown",
          rightsNotes: extract ? "Reference requested for design-system extraction; the project creator remains responsible for having appropriate rights." : "Public reference supplied for inspiration only; do not copy assets or copy.",
          rightsConfirmed: false,
          permissions: { analyze: true, inspire: true, reproduceAssets: false, reproduceCopy: false, distribute: false }
        })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; bootstrapReference?: { warning?: { message?: string } } };
      if (!response.ok) return result.error ?? "The project was created, but its reference site could not be queued.";
      if (result.bootstrapReference?.warning?.message) return `Project created. Reference queued with warning: ${result.bootstrapReference.warning.message}`;
    } catch { return "The project was created, but its reference site could not be queued."; }
    return undefined;
  }

  async function createNewProject() {
    if (!bootstrapBrief) return;
    setBusy("Creating the approved project");
    setBootstrapError(undefined);
    try {
      let result: { project?: ProjectData };
      if (bootstrapSession && !manualBootstrap) {
        const response = await fetch(`/api/bootstrap/${encodeURIComponent(bootstrapSession.id)}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ briefVersion: bootstrapSession.activeBriefVersion ?? bootstrapBrief.version })
        });
        result = await parseBootstrapResponse(response, "Could not approve and create the project.");
      } else {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: bootstrapInput.brandName.trim(),
            brandName: bootstrapInput.brandName.trim(),
            industry: bootstrapBrief.brandSeed.industry || "To be defined",
            audience: bootstrapBrief.brandSeed.audience || "Audience to be defined",
            promise: bootstrapBrief.brandSeed.promise.slice(0, 300)
          })
        });
        result = await parseBootstrapResponse(response, "Could not create the project.");
      }
      if (!result.project) throw new Error("The bootstrap service approved the brief but did not return a project.");
      const createdProject = result.project;
      // A synthesized bootstrap already captured the reference in its staging
      // project and approval migrated that durable source graph atomically.
      // Only the manual fallback still needs to attach the URL after creation.
      const referenceWarning = bootstrapSession && !manualBootstrap
        ? bootstrapSession.referenceSnapshot?.warning?.message
        : await attachBootstrapReference(createdProject.id);
      const summary: ProjectSummary = { id: createdProject.id, name: createdProject.name, brandName: createdProject.brand.name, industry: createdProject.brand.industry, updatedAt: createdProject.updatedAt, version: createdProject.version };
      setProjects((current) => [summary, ...current.filter((item) => item.id !== summary.id)]);
      setShowNewProject(false);
      await switchProject(createdProject.id);
      setToast(referenceWarning ?? `${createdProject.brand.name} project created from the approved brief.`);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "Could not create the project.");
    } finally { setBusy(undefined); }
  }

  async function refreshAccount() {
    const response = await fetch("/api/account", { cache: "no-store" });
    const state = await response.json() as AccountState;
    setAccount(state);
    return state;
  }

  function closeAccountModal() {
    accountPollToken.current += 1;
    setShowAccount(false);
    setBusy((current) => current === "Opening OpenAI sign-in" || current === "Connecting API key" ? undefined : current);
  }

  async function connectAccount(action: "login" | "apiKey") {
    const token = ++accountPollToken.current;
    setBusy(action === "login" ? "Opening OpenAI sign-in" : "Connecting API key");
    try {
      const response = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, apiKey: action === "apiKey" ? apiKey : undefined }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not start sign-in.");
      if (result.authUrl) window.open(result.authUrl, "_blank", "noopener,noreferrer");
      for (let attempt = 0; attempt < 80 && accountPollToken.current === token; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        if (accountPollToken.current !== token) break;
        const state = await refreshAccount();
        if (state.account) {
          setShowAccount(false); setApiKey(""); setToast("OpenAI account connected.");
          break;
        }
      }
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not connect the account."); }
    finally { if (accountPollToken.current === token) setBusy(undefined); }
  }

  async function disconnectAccount() {
    try {
      await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
      await refreshAccount(); setShowAccount(false); setToast("OpenAI account disconnected.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not disconnect the account.");
    }
  }

  const surfaceTitle = useMemo(() => nav.find((item) => item.id === surface)?.label ?? "Studio", [surface]);
  const focusedBootstrapQuestions = bootstrapSession?.questions.slice(0, 3) ?? [];
  const referenceReady = isPublicReferenceUrl(bootstrapInput.referenceUrl);
  if (!project || !data) return <main className="loading-screen"><div className="loader-mark">✦</div><p>Opening the studio…</p></main>;
  const safeSlideIndex = Math.min(activeSlide, Math.max(project.slides.length - 1, 0));
  const activeSlideData = project.slides[safeSlideIndex];

  return <main className="studio-shell">
    <header className="topbar">
      <div className="wordmark"><span>✦</span><strong>Codex</strong> Design Studio</div>
      <div className="project-crumb"><span className="status-dot"/>{project.name}<span>·</span><small>v{project.tokens.version}</small></div>
      <div className="top-actions">
        <button className="account-button" onClick={() => setShowAccount(true)}><span className={account?.account ? "connected" : ""}/>{account?.account?.type === "chatgpt" ? account.account.email ?? account.account.planType : account?.account?.type === "apiKey" ? "API account" : "Connect OpenAI"}</button>
        <button className="ghost-button" onClick={openBootstrapWizard}>＋ New project</button>
        <button className="ghost-button" onClick={reset}>Restore project</button>
        <button className="ghost-button" onClick={runReview}>✓ Review</button>
        <div className="export-menu"><span>Export</span><div><a href={apiForProject("/api/export/web")}>Landing ZIP</a><a href={apiForProject("/api/export/pptx")}>Editable PPTX</a><a href={apiForProject("/api/export/tokens")}>Tokens JSON</a></div></div>
      </div>
    </header>
    <div className="studio-grid">
      <aside className="sidebar">
        <div className="project-tile"><div className="project-avatar">{project.brand.name.slice(0, 1).toUpperCase()}</div><div><select aria-label="Active project" value={projectId} onChange={(event) => switchProject(event.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.brandName}</option>)}</select><span>{project.brand.industry}</span></div></div>
        <nav>{nav.map((item) => <button key={item.id} className={surface === item.id ? "current" : ""} onClick={() => setSurface(item.id)}><span>{item.glyph}</span>{item.label}{item.id === "web" && <i>Live</i>}</button>)}</nav>
        <div className="side-bottom"><div className="agent-state"><span className="agent-pulse"/><div><strong>{agent?.available ? "Codex connected" : "Checking Codex"}</strong><small>{agent ? `${agent.model} · CLI ${agent.cliVersion}` : "App Server"}</small></div></div></div>
      </aside>
      <section className="workspace">
        <div className="workspace-bar"><div><small>{surface === "sources" || surface === "system" ? "SOURCE OF TRUTH" : "ACTIVE DELIVERABLE"}</small><strong>{surfaceTitle}</strong></div>{surface === "web" && <div className="viewport-toggle"><button className={!mobile ? "active" : ""} onClick={() => setMobile(false)}>Desktop</button><button className={mobile ? "active" : ""} onClick={() => setMobile(true)}>Mobile</button></div>}<div className="workspace-meta"><span>{surface === "sources" ? `${provenance?.sources.filter((source) => source.status !== "deleted").length ?? 0} active sources` : "Synced with tokens"}</span><b>●</b></div></div>
        <div className="canvas-area">
          {surface === "sources" && <div className="sources-page">
            <div className="editor-heading"><div><small>BRAND BOOTSTRAP</small><h1>Build from evidence.</h1><p>Add originals, decide how Codex may use them, and keep every extracted claim traceable.</p></div></div>
            <div className="source-intake-grid">
              <section className="source-panel">
                <h2>Add source material</h2>
                <div className="url-row"><input aria-label="Source URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://brand.example.com"/><button onClick={addUrlSource} disabled={!sourceUrl.trim()}>Add URL</button></div>
                <div className="source-drop-grid">
                  <label><span>◫</span><strong>Logos & images</strong><small>PNG, JPG, SVG, screenshots</small><input type="file" accept="image/*,.svg" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}/></label>
                  <label><span>▤</span><strong>Documents & decks</strong><small>PDF, DOCX, PPTX, spreadsheets</small><input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.key,.xls,.xlsx,.csv,.ods" multiple onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}/></label>
                  <label><span>⌘</span><strong>Local codebase</strong><small>Upload a portable ZIP or archive</small><input type="file" accept=".zip,.tar,.gz,.tgz" onChange={(event) => { addFiles(event.target.files, "codebase"); event.target.value = ""; }}/></label>
                </div>
                <div className="source-options">
                  <label>Use intent<select value={sourceIntent} onChange={(event) => setSourceIntent(event.target.value as SourceIntent)}><option value="extract">Extract facts</option><option value="inspire">Inspiration only</option><option value="extract-and-inspire">Extract + inspire</option></select></label>
                  <label>Rights / licence notes<input value={rightsNotes} onChange={(event) => setRightsNotes(event.target.value)} placeholder="Owned by client; internal use"/></label>
                  <label className="rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)}/> I confirm this material may be processed</label>
                </div>
              </section>
              <section className="source-panel manual-panel">
                <h2>Add first-class evidence</h2>
                <p>Record human direction with 100% confidence.</p>
                <label>Evidence type<select value={manualEvidence.kind} onChange={(event) => setManualEvidence((current) => ({ ...current, kind: event.target.value as EvidenceKind }))}><option value="color">Colour</option><option value="font">Font</option><option value="tone">Tone</option><option value="accessibility">Accessibility constraint</option><option value="rule">Explicit rule</option></select></label>
                <label>Direction<textarea value={manualEvidence.value} onChange={(event) => setManualEvidence((current) => ({ ...current, value: event.target.value }))} placeholder={manualEvidence.kind === "color" ? "#215C4B for primary actions" : manualEvidence.kind === "accessibility" ? "All text must meet WCAG AA" : "Describe the evidence…"}/></label>
                <label>Strength<select value={manualEvidence.directive} onChange={(event) => setManualEvidence((current) => ({ ...current, directive: event.target.value as EvidenceDirective }))}><option value="must-use">Must use</option><option value="must-avoid">Must avoid</option><option value="advisory">Advisory</option></select></label>
                <button className="primary-button" onClick={addEvidence} disabled={!manualEvidence.value.trim()}>Add evidence</button>
              </section>
            </div>
            <section className="source-library">
              <div className="source-library-head"><div><h2>Source library</h2><span>{provenance?.evidence.length ?? 0} evidence items · {provenance?.extractionRuns.length ?? 0} extraction runs</span></div><code>schema v{provenance?.schemaVersion ?? 1}</code></div>
              <div className="source-list">{provenance?.sources.length ? provenance.sources.map((source) => {
                const run = provenance.extractionRuns.find((item) => item.id === source.latestRunId);
                return <article className={`source-row ${source.status}`} key={source.id}>
                  <div className="source-kind">{source.kind === "url" ? "↗" : source.kind === "codebase" ? "⌘" : source.kind === "manual" ? "✎" : "▧"}</div>
                  <div className="source-copy"><strong>{source.label}</strong><span>{source.origin.fileName ?? source.origin.locator ?? source.kind} · {source.intent.replaceAll("-", " ")}</span><code>{source.contentHash.slice(0, 12)}</code></div>
                  <div className="source-progress"><span className={`status-badge ${source.status}`}>{source.status}</span>{run && <><div><i style={{ width: `${run.progress}%` }}/></div><small>{run.phase} · attempt {run.attempt}{run.error ? ` · ${run.error.message}` : ""}</small></>}</div>
                  <div className="source-actions">{run && ["queued", "running"].includes(run.status) && <button onClick={() => cancelRun(run.id)}>Cancel</button>}{source.status === "error" && <button onClick={() => sourceAction(source.id, "retry")}>Retry</button>}{source.kind === "url" && source.status !== "deleted" && <button onClick={() => sourceAction(source.id, "refresh")}>Refresh</button>}{source.status !== "deleted" && <button onClick={() => sourceAction(source.id, "reprocess")}>Reprocess</button>}{source.status !== "deleted" && <button className="danger" onClick={() => sourceAction(source.id, "remove")}>Remove</button>}</div>
                </article>;
              }) : <div className="source-empty">No sources yet. Add a URL, file, codebase archive, or a manual rule.</div>}</div>
              {Boolean(provenance?.evidence.length) && <div className="evidence-strip">{provenance?.evidence.map((item) => <div key={item.id}><b>{item.directive}</b><strong>{item.kind}</strong><span>{typeof item.value === "string" ? item.value : JSON.stringify(item.value)}</span><small>{Math.round(item.confidence.score * 100)}% · {item.confidence.method}</small></div>)}</div>}
            </section>
          </div>}
          {surface === "reconcile" && <div className="reconcile-page">
            <div className="editor-heading"><div><small>EVIDENCE REVIEW</small><h1>Resolve without erasing.</h1><p>Compatible findings are merged. Every disagreement keeps its source, confidence, intent and human-authored priority.</p></div><span className={`conflict-count ${reconciliation?.unresolvedConflictCount ? "open" : "clear"}`}>{reconciliation?.unresolvedConflictCount ?? 0} unresolved</span></div>
            <div className="reconcile-list">{reconciliation?.groups.length ? reconciliation.groups.map((group) => <article className={`reconcile-group ${group.conflict ? "conflict" : "compatible"}`} key={group.id}>
              <header><div><small>{group.kind} · {group.label}</small><h2>{group.conflict ? "Sources disagree" : "Compatible evidence merged"}</h2>{group.conflictExplanation && <p>{group.conflictExplanation}</p>}</div>{group.decision && <span className="decision-badge">{group.decision.action}</span>}</header>
              <div className="reconcile-options">{group.options.map((option) => <section className={group.decision?.optionId === option.id ? "selected" : ""} key={option.id}>
                <div className="candidate-value">{typeof option.value === "string" ? option.value : JSON.stringify(option.value)}</div>
                <div className="candidate-meta"><strong>{Math.round(option.confidence * 100)}% confidence</strong><span>priority {option.priority}</span><span>{option.sources.length} source{option.sources.length === 1 ? "" : "s"}</span></div>
                <div className="source-previews">{option.sources.map((source) => <div key={source.id}><b>{source.userAuthored ? "✎" : "↗"}</b><span><strong>{source.sourceLabel}</strong><small>{source.sourceLocator} · {source.directive} · {Math.round(source.confidence * 100)}%</small></span></div>)}</div>
                <div className="candidate-actions"><button onClick={() => decideReconciliation(group.id, "accept", option.id)}>Accept</button><button onClick={() => decideReconciliation(group.id, "inspiration", option.id)}>Inspiration</button></div>
              </section>)}</div>
              <footer><button onClick={() => decideReconciliation(group.id, "override")}>Override value</button><button className="danger" onClick={() => decideReconciliation(group.id, "reject")}>Reject group</button>{group.resolved && <span>✓ Resolved{group.resolvedValue !== undefined ? ` · ${typeof group.resolvedValue === "string" ? group.resolvedValue : "custom value"}` : ""}</span>}</footer>
            </article>) : <div className="source-empty">No extracted candidates yet. Process sources or add manual evidence first.</div>}</div>
          </div>}
          {surface === "assets" && <VisualAssetStudio projectId={projectId} project={project} brandSystems={systemRegistry} onBusy={setBusy} onToast={setToast}/>}
          {surface === "web" && <div className={`browser-frame ${mobile ? "mobile" : ""}`}><div className="browser-chrome"><i/><i/><i/><span>asteria.local</span><em>↗</em></div><iframe ref={previewRef} title="Generated landing page" srcDoc={pendingWebCandidate && candidatePreview === "candidate" ? pendingWebCandidate.html : data.landingHtml} sandbox="allow-scripts"/></div>}
          {surface === "slides" && (activeSlideData ? <div className="slides-canvas"><div className="slides-stage"><button className="canvas-edit-toggle" onClick={() => setSlideEditing((current) => !current)}>{slideEditing ? "Done editing" : "Edit canvas"}</button>{slideEditing && slideDocument ? <ArtifactCanvasEditor artifactId="slides" document={slideDocument} slideId={activeSlideData.id} onChange={(next) => setSlideDocument(next)} onAutosave={saveSlideCanvas}/> : <SlidePreview slide={activeSlideData} tokens={project.tokens} brandName={project.brand.name} index={safeSlideIndex} active onClick={() => undefined} document={slideDocument}/>}</div><div className="slide-strip">{project.slides.map((slide, index) => <div key={slide.id}><span>0{index + 1}</span><SlidePreview slide={slide} tokens={project.tokens} brandName={project.brand.name} index={index} active={safeSlideIndex === index} onClick={() => setActiveSlide(index)} document={slideDocument}/></div>)}</div></div> : <div className="source-empty">This project has no slides yet. Create them from the chat or switch deliverable.</div>)}
          {surface === "brand" && <div className="editor-card"><div className="editor-heading"><div><small>BRAND PROFILE</small><h1>Define once. Review before release.</h1><p>The profile guides every creative decision and is published only through a versioned draft.</p></div><button className="primary-button" onClick={saveSystem}>Save draft</button></div><div className="form-grid">
            <label>Brand name<input value={project.brand.name} onChange={(e) => updateProject((p) => { p.brand.name = e.target.value; return p; })}/></label>
            <label>Industry<input value={project.brand.industry} onChange={(e) => updateProject((p) => { p.brand.industry = e.target.value; return p; })}/></label>
            <label className="span-two">Audience<input value={project.brand.audience} onChange={(e) => updateProject((p) => { p.brand.audience = e.target.value; return p; })}/></label>
            <label className="span-two">Promise<textarea value={project.brand.promise} onChange={(e) => updateProject((p) => { p.brand.promise = e.target.value; return p; })}/></label>
            <label>Tone<input value={project.brand.tone} onChange={(e) => updateProject((p) => { p.brand.tone = e.target.value; return p; })}/></label>
            <label>Visual direction<input value={project.brand.visualDirection} onChange={(e) => updateProject((p) => { p.brand.visualDirection = e.target.value; return p; })}/></label>
          </div></div>}
          {surface === "system" && <div className="token-page system-kit"><div className="editor-heading"><div><small>DESIGN SYSTEM · REVIEW KIT</small><h1>Your brand, before it ships.</h1><p>Inspect foundations and representative components, then save a draft and publish it explicitly.</p></div><div className="system-actions"><button className="ghost-button" onClick={saveSystem}>Save new draft</button>{systemRegistry?.draftVersionId && <button className="primary-button" onClick={() => publishDraft(systemRegistry.draftVersionId!)} disabled={Boolean(reconciliation?.unresolvedConflictCount)}>Publish draft</button>}</div></div>
            <div className="token-layout">
              <section className="token-section"><h2>Palette</h2><div className="swatch-grid">{Object.entries(project.tokens.colors).map(([name, value]) => <label key={name} className="swatch"><input type="color" value={value} onChange={(e) => updateProject((p) => { p.tokens.colors[name as keyof typeof p.tokens.colors] = e.target.value.toUpperCase(); return p; })}/><span style={{ background: value }}/><strong>{name}</strong><code>{value}</code></label>)}</div></section>
              <section className="token-section type-preview"><h2>Typography</h2><div><small>DISPLAY · {project.tokens.typography.display}</small><strong style={{ fontFamily: project.tokens.typography.display }}>Clarity that compounds.</strong></div><div><small>BODY · {project.tokens.typography.body}</small><p style={{ fontFamily: project.tokens.typography.body }}>Precise, confident and human communication across every touchpoint.</p></div></section>
              <section className="token-section"><h2>Spacing scale</h2><div className="spacing-kit">{Object.entries(project.tokens.spacing).map(([name, value]) => <div key={name}><code>{name} · {value}px</code><span style={{ width: `${value * 2}px` }}/></div>)}</div></section>
              <section className="token-section"><h2>Shape language</h2><div className="shape-kit">{Object.entries(project.tokens.shape).map(([name, value]) => <div key={name} style={{ borderRadius: value }}><span>{name}</span><code>{value}px</code></div>)}</div></section>
              <section className="token-section component-kit"><h2>Navigation, buttons & cards</h2><nav><strong>{project.brand.name}</strong>{project.landing.navigation.items.map((item) => <span key={item.label}>{item.label}</span>)}<button>{project.landing.primaryCta}</button></nav><div className="button-kit"><button className="kit-primary">Primary action</button><button className="kit-secondary">Secondary action</button></div><div className="card-kit">{project.landing.benefits.slice(0, 3).map((benefit) => <article key={benefit.title}><small>0{project.landing.benefits.indexOf(benefit) + 1}</small><h3>{benefit.title}</h3><p>{benefit.body}</p></article>)}</div></section>
              <section className="token-section representative-kit"><h2>Representative content</h2><small>{project.landing.eyebrow}</small><h3>{project.landing.headline}</h3><p>{project.landing.subhead}</p><button>{project.landing.primaryCta}</button></section>
              <section className="token-section version-panel"><h2>Immutable versions</h2><div className="version-list">{systemRegistry?.versions.length ? [...systemRegistry.versions].reverse().map((version) => <div key={version.id}><span className={`status-badge ${version.status}`}>{version.status}</span><strong>v{version.number}</strong><code>{version.contentHash.slice(0, 10)}</code>{version.status === "draft" && <button onClick={() => publishDraft(version.id)} disabled={Boolean(reconciliation?.unresolvedConflictCount)}>Publish</button>}</div>) : <p>No version yet. Save a draft after reviewing the kit.</p>}</div><h2>Artifact bindings</h2>{systemRegistry?.bindings.map((binding) => <div className="binding-row" key={binding.artifactId}><div><strong>{binding.artifactId}</strong><small>{binding.independentlyComposed ? "Independent composition protected" : "Structured artifact"}</small></div><span>v{systemRegistry.versions.find((item) => item.id === binding.brandSystemVersionId)?.number}</span><div>{systemRegistry.versions.filter((item) => item.status !== "draft" && item.id !== binding.brandSystemVersionId).map((version) => <span key={version.id}><button onClick={() => previewBinding(binding.artifactId, version.id)}>Preview v{version.number}</button><button onClick={() => bindArtifact(binding.artifactId, version.id, version.number < (systemRegistry.versions.find((item) => item.id === binding.brandSystemVersionId)?.number ?? 0) ? "rollback" : "upgrade")}>{version.number < (systemRegistry.versions.find((item) => item.id === binding.brandSystemVersionId)?.number ?? 0) ? "Rollback" : "Upgrade"}</button></span>)}</div></div>)}</section>
              <section className="token-section json-panel"><h2>Structured source</h2><pre>{JSON.stringify(project.tokens, null, 2)}</pre></section>
            </div></div>}
        </div>
      </section>
      <aside className="chat-panel">
        <div className="chat-head"><div><small>CODEX</small><strong>Creative direction</strong></div><span>•••</span></div>
        <div className="context-card"><div className="context-icon">⌖</div><div><small>CURRENT CONTEXT</small><strong>{selection?.label ?? (surface === "slides" ? `Slide ${safeSlideIndex + 1}` : surfaceTitle)}</strong><span>{selection ? `${selection.viewport} · ${selection.designId}` : "Select an element to target it"}</span></div>{selection && <button onClick={() => setSelection(undefined)}>×</button>}</div>
        <div className="messages">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}><span>{message.role === "assistant" ? "✦" : "You"}</span><p>{message.text}</p></div>)}{busy && <div className="message assistant working"><span>✦</span><p>{busy}<i/><i/><i/></p></div>}<div ref={messagesEndRef} aria-hidden="true"/></div>
        <div className="quick-prompts"><button onClick={() => setInstruction("Make this feel more premium")}>More premium</button><button onClick={() => setInstruction("Make it warmer")}>Warmer</button><button onClick={() => setInstruction("Shorten this copy")}>Shorten</button></div>
        <div className="composer"><textarea aria-label="Refinement instruction" placeholder={selection ? `Change ${selection.label}…` : "Ask Codex to refine the brand…"} value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); refine(); } }}/><div><span>Context attached</span><button aria-label="Send instruction" onClick={refine} disabled={!instruction.trim() || Boolean(busy)}>↑</button></div></div>
      </aside>
    </div>
    {review && <div className="review-drawer"><div className="review-score"><span>{review.score}</span><div><small>BRAND HEALTH</small><strong>{review.score >= 90 ? "Ready to ship" : "Needs attention"}</strong></div><button onClick={() => setReview(undefined)}>×</button></div>{review.checks.map((check) => <div className={`review-item ${check.status}`} key={check.id}><b>{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×"}</b><div><strong>{check.label}</strong><span>{check.message}</span></div></div>)}</div>}
    {toast && <button className="toast" onClick={() => setToast(undefined)}>{toast}<span>×</span></button>}
    {pendingWebCandidate && <div className="modal-backdrop candidate-backdrop"><section className="project-modal candidate-modal" role="dialog" aria-modal="false" aria-labelledby="candidate-title"><div className="modal-heading"><div><small>WEB CANDIDATE · QA REVIEW</small><h2 id="candidate-title">Codex created a proposal</h2><p>{pendingWebCandidate.candidate.summary} The proposal is preserved even if you keep the original.</p></div></div><div className="candidate-preview-toggle"><button className={candidatePreview === "original" ? "active" : ""} onClick={() => setCandidatePreview("original")}>View original</button><button className={candidatePreview === "candidate" ? "active" : ""} onClick={() => setCandidatePreview("candidate")}>View candidate</button></div><div className="candidate-checks">{Object.entries(pendingWebCandidate.candidate.assessment.comparisons).map(([viewport, comparison]) => <div key={viewport}><strong>{viewport}</strong><span>Contrast failures {comparison.before.failures} → {comparison.after.failures}</span><em className={comparison.regressions.length || comparison.warnings?.length ? "warning" : "improved"}>{comparison.regressions.length ? `${comparison.regressions.join(", ")} needs review` : comparison.warnings?.length ? `${comparison.warnings.join(", ")} needs review` : "No new deterministic regression"}</em></div>)}</div><p className="candidate-note">Quality and accessibility warnings are overridable. Integrity and security failures are never offered for acceptance.</p><div className="modal-actions"><button className="ghost-button" onClick={() => resolveWebCandidate("reject")} disabled={Boolean(busy)}>Keep original</button><button className="primary-button" onClick={() => resolveWebCandidate("accept")} disabled={Boolean(busy)}>Accept with warnings</button></div></section></div>}
    {showNewProject && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowNewProject(false); }}>
      <section className="project-modal bootstrap-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div className="modal-heading"><div><small>NEW PROJECT · STEP {bootstrapStep} OF 4</small><h2 id="new-project-title">Create a brand workspace</h2><p>Start with intent, keep every inference visible, then approve the brief before anything is created.</p></div><button aria-label="Close" onClick={() => setShowNewProject(false)} disabled={Boolean(busy)}>×</button></div>
        <ol className="bootstrap-progress" aria-label="Project setup progress">
          {([1, 2, 3, 4] as BootstrapStep[]).map((step) => <li className={step === bootstrapStep ? "active" : step < bootstrapStep ? "complete" : ""} key={step}><button onClick={() => { if (step < bootstrapStep && !busy) setBootstrapStep(step); }} disabled={step > bootstrapStep || Boolean(busy)}><span>{step < bootstrapStep ? "✓" : step}</span>{step === 1 ? "Intent" : step === 2 ? "Reference" : step === 3 ? "Brief" : "Approve"}</button></li>)}
        </ol>

        {bootstrapStep === 1 && <div className="bootstrap-panel">
          <div className="bootstrap-intro"><small>START WITH THE JOB, NOT A TEMPLATE</small><h3>What should this project make possible?</h3><p>Codex will transform your wording into a strategic brief. It will not silently copy these fields into the final brand.</p></div>
          <div className="modal-form bootstrap-form">
            <label>Brand name<input autoFocus value={bootstrapInput.brandName} onChange={(event) => setBootstrapInput((current) => ({ ...current, brandName: event.target.value }))} placeholder="Northstar"/></label>
            <label>Audience <em>optional</em><input value={bootstrapInput.audience} onChange={(event) => setBootstrapInput((current) => ({ ...current, audience: event.target.value }))} placeholder="Finance leaders in scaling companies"/></label>
            <label className="span-two">What are you trying to achieve?<textarea value={bootstrapInput.objective} onChange={(event) => setBootstrapInput((current) => ({ ...current, objective: event.target.value }))} placeholder="Help operations leaders understand our product and feel confident requesting a demo."/></label>
          </div>
          <fieldset className="bootstrap-choice-group"><legend>First deliverable</legend><div className="bootstrap-choices">
            <label className={bootstrapInput.deliverable === "web" ? "selected" : ""}><input type="radio" name="bootstrap-deliverable" value="web" checked={bootstrapInput.deliverable === "web"} onChange={() => setBootstrapInput((current) => ({ ...current, deliverable: "web" }))}/><span>⌁</span><strong>Web experience</strong><small>A responsive first page and system</small></label>
            <label className={bootstrapInput.deliverable === "slides" ? "selected" : ""}><input type="radio" name="bootstrap-deliverable" value="slides" checked={bootstrapInput.deliverable === "slides"} onChange={() => setBootstrapInput((current) => ({ ...current, deliverable: "slides" }))}/><span>▰</span><strong>Presentation</strong><small>An editable narrative and slide system</small></label>
          </div></fieldset>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setShowNewProject(false)}>Cancel</button><button className="primary-button" disabled={!bootstrapInput.brandName.trim() || !bootstrapInput.objective.trim()} onClick={() => setBootstrapStep(2)}>Continue</button></div>
        </div>}

        {bootstrapStep === 2 && <div className="bootstrap-panel">
          <div className="bootstrap-intro"><small>OPTIONAL REFERENCE</small><h3>Bring a site, without losing authorship.</h3><p>Use one public URL now, or skip it. Codex records whether it is evidence from your brand or inspiration only.</p></div>
          <div className="bootstrap-reference">
            <label>Public reference URL <em>optional</em><input type="url" value={bootstrapInput.referenceUrl} onChange={(event) => setBootstrapInput((current) => ({ ...current, referenceUrl: event.target.value }))} placeholder="https://brand.example.com" aria-describedby="reference-url-note"/></label>
            <small id="reference-url-note">Authenticated or private pages are not accessed during bootstrap.</small>
            {bootstrapInput.referenceUrl.trim() && !isPublicReferenceUrl(bootstrapInput.referenceUrl) && <p className="field-error">Enter a complete http or https URL.</p>}
          </div>
          {bootstrapInput.referenceUrl.trim() && <>
            <fieldset className="bootstrap-choice-group"><legend>How may Codex use it?</legend><div className="bootstrap-choices reference-choices">
              <label className={bootstrapInput.referenceIntent === "extract" ? "selected" : ""}><input type="radio" name="reference-intent" value="extract" checked={bootstrapInput.referenceIntent === "extract"} onChange={() => setBootstrapInput((current) => ({ ...current, referenceIntent: "extract" }))}/><span>⌖</span><strong>Extract design-system signals</strong><small>Treat detected rules as evidence to review</small></label>
              <label className={bootstrapInput.referenceIntent === "inspire" ? "selected" : ""}><input type="radio" name="reference-intent" value="inspire" checked={bootstrapInput.referenceIntent === "inspire"} onChange={() => setBootstrapInput((current) => ({ ...current, referenceIntent: "inspire" }))}/><span>✦</span><strong>Use as inspiration</strong><small>Explore signals without copying assets or copy</small></label>
            </div></fieldset>
            <div className="bootstrap-responsibility"><span>!</span><p><strong>You remain responsible for using references lawfully.</strong> This warning does not block your selected intent. Codex does not copy source assets or copy by default.</p></div>
          </>}
          <div className="bootstrap-trust-note"><span>♢</span><p><strong>Your source remains traceable.</strong> Facts, inferences and assumptions stay separate in the next step.</p></div>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setBootstrapStep(1)}>Back</button><button className="primary-button" disabled={!referenceReady || Boolean(busy)} onClick={startBootstrap}>{bootstrapInput.referenceUrl.trim() ? "Analyze context" : "Continue without reference"}</button></div>
        </div>}

        {bootstrapStep === 3 && <div className="bootstrap-panel brief-panel">
          <div className="bootstrap-intro"><small>TRACEABLE SYNTHESIS</small><h3>{bootstrapBrief ? "Review the creative brief." : focusedBootstrapQuestions.length ? "A few answers will sharpen the brief." : "Building your brief…"}</h3><p>Only high-impact unknowns are asked. You can retry the synthesis or continue with a transparent manual draft.</p></div>
          {bootstrapError && <div className="bootstrap-error" role="alert"><div><strong>Synthesis needs your help</strong><p>{bootstrapError}</p></div><div><button className="ghost-button" onClick={() => bootstrapSession ? synthesizeBootstrap() : startBootstrap()} disabled={Boolean(busy)}>Try again</button><button className="ghost-button" onClick={continueBootstrapManually} disabled={Boolean(busy)}>Continue manually</button></div></div>}
          {!bootstrapBrief && focusedBootstrapQuestions.length > 0 && <div className="bootstrap-questions"><div><strong>{focusedBootstrapQuestions.length} focused question{focusedBootstrapQuestions.length === 1 ? "" : "s"}</strong><span>Asked because each answer can change the direction.</span></div>{focusedBootstrapQuestions.map((question) => <label key={question.id}>{question.prompt}{question.required && <b>required</b>}{question.options?.length ? <select value={bootstrapAnswers[question.id] ?? ""} onChange={(event) => setBootstrapAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">Choose one</option>{question.options.map((option) => <option value={option} key={option}>{option}</option>)}</select> : <textarea value={bootstrapAnswers[question.id] ?? ""} onChange={(event) => setBootstrapAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Your answer"/>}<small>{question.reason}</small></label>)}<button className="primary-button" onClick={() => synthesizeBootstrap()} disabled={Boolean(busy) || focusedBootstrapQuestions.some((question) => question.required && !bootstrapAnswers[question.id]?.trim())}>Synthesize brief</button></div>}
          {!bootstrapBrief && !focusedBootstrapQuestions.length && !bootstrapError && <div className="bootstrap-loading"><span>✦</span><strong>{busy ?? "Preparing synthesis"}</strong><p>The local session preserves the original input while Codex works.</p></div>}
          {bootstrapBrief && <>
            <label className="original-wording"><span><small>ORIGINAL WORDING · NEVER REPLACED SILENTLY</small><q>{bootstrapInput.objective}</q></span><input aria-label="Lock original wording verbatim" type="checkbox" checked={bootstrapInput.lockOriginal} onChange={(event) => setBootstrapInput((current) => ({ ...current, lockOriginal: event.target.checked }))}/><strong>{bootstrapInput.lockOriginal ? "Locked verbatim" : "Editable seed"}</strong></label>
            <div className="brief-editor"><label>Brief summary<textarea value={bootstrapBrief.summary} onChange={(event) => setBootstrapBrief((current) => current ? ({ ...current, summary: event.target.value }) : current)}/></label><div><label>Strategic objective<textarea value={bootstrapBrief.strategy.objective} onChange={(event) => setBootstrapBrief((current) => current ? ({ ...current, strategy: { ...current.strategy, objective: event.target.value } }) : current)}/></label><label>Positioning<textarea value={bootstrapBrief.strategy.positioning} onChange={(event) => setBootstrapBrief((current) => current ? ({ ...current, strategy: { ...current.strategy, positioning: event.target.value } }) : current)}/></label></div><label>Voice<input value={bootstrapBrief.strategy.voice} onChange={(event) => setBootstrapBrief((current) => current ? ({ ...current, strategy: { ...current.strategy, voice: event.target.value } }) : current)}/></label></div>
            <div className="brief-trace"><section><header><span>●</span><strong>Facts</strong><small>{bootstrapBrief.facts.length}</small></header>{bootstrapBrief.facts.length ? bootstrapBrief.facts.map((fact) => <p key={fact.id}>{fact.claim}</p>) : <p>No source-backed facts yet.</p>}</section><section><header><span>◐</span><strong>Inferences</strong><small>{bootstrapBrief.inferences.length}</small></header>{bootstrapBrief.inferences.length ? bootstrapBrief.inferences.map((inference) => <p key={inference.id}>{inference.claim}<em>{Math.round(inference.confidence * 100)}% confidence</em></p>) : <p>No inference was required.</p>}</section><section><header><span>◇</span><strong>Assumptions</strong><small>{bootstrapBrief.assumptions.length}</small></header>{bootstrapBrief.assumptions.length ? bootstrapBrief.assumptions.map((assumption) => <p key={assumption.id}>{assumption.claim}<em>{assumption.status}</em></p>) : <p>No open assumption.</p>}</section></div>
            {bootstrapBrief.unknowns.length > 0 && <div className="brief-unknowns"><strong>Still unknown</strong><span>{bootstrapBrief.unknowns.join(" · ")}</span></div>}
            <div className="modal-actions"><button className="ghost-button" onClick={() => setBootstrapStep(2)}>Back to sources</button><button className="primary-button" onClick={reviewBootstrapApproval} disabled={!bootstrapBrief.summary.trim() || !bootstrapBrief.strategy.objective.trim() || Boolean(busy)}>Continue to approval</button></div>
          </>}
        </div>}

        {bootstrapStep === 4 && bootstrapBrief && <div className="bootstrap-panel approval-panel">
          <div className="bootstrap-intro"><small>EXPLICIT APPROVAL</small><h3>Ready to create, not overwrite.</h3><p>Approval creates a new local project and its first versioned brief. No existing workspace or repository is changed.</p></div>
          {bootstrapError && <div className="bootstrap-error" role="alert"><div><strong>Project not created</strong><p>{bootstrapError}</p></div></div>}
          <article className="approval-card"><header><div><small>{bootstrapInput.deliverable === "web" ? "WEB EXPERIENCE" : "PRESENTATION"}</small><h4>{bootstrapBrief.title}</h4></div><span>{manualBootstrap ? "Manual recovery" : "Synthesized"}</span></header><p>{bootstrapBrief.summary}</p><dl><div><dt>Audience</dt><dd>{bootstrapBrief.strategy.audience}</dd></div><div><dt>Positioning</dt><dd>{bootstrapBrief.strategy.positioning}</dd></div><div><dt>Voice</dt><dd>{bootstrapBrief.strategy.voice}</dd></div></dl><div className="approval-principles">{bootstrapBrief.creative.designPrinciples.map((principle) => <span key={principle}>{principle}</span>)}</div></article>
          <div className="approval-provenance"><span>✓ Original wording {bootstrapInput.lockOriginal ? "locked" : "preserved"}</span><span>✓ {bootstrapBrief.facts.length} facts separated from {bootstrapBrief.inferences.length} inferences</span><span>✓ Reference {bootstrapInput.referenceUrl.trim() ? bootstrapInput.referenceIntent === "extract" ? "selected for extraction" : "selected for inspiration" : "not supplied"}</span></div>
          <div className="modal-actions"><button className="ghost-button" onClick={() => setBootstrapStep(3)}>Review brief</button><button className="primary-button" onClick={createNewProject} disabled={Boolean(busy)}>{busy ? "Creating…" : "Approve & create project"}</button></div>
        </div>}
      </section>
    </div>}
    {showAccount && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAccountModal(); }}><section className="project-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><div className="modal-heading"><div><small>OPENAI ACCOUNT</small><h2 id="account-title">{account?.account ? "Codex is connected" : "Connect Codex"}</h2><p>{account?.account ? "Your credentials stay in the Codex keychain and are never stored by the project." : "Use your ChatGPT subscription or an OpenAI Platform API key."}</p></div><button aria-label="Close" onClick={closeAccountModal}>×</button></div>{account?.account ? <div className="account-summary"><span className="account-mark">✓</span><div><strong>{account.account.type === "chatgpt" ? account.account.email ?? "ChatGPT account" : "OpenAI API key"}</strong><small>{account.account.type === "chatgpt" ? `${account.account.planType} plan` : "Usage-based billing"}</small></div><button className="ghost-button" onClick={disconnectAccount}>Sign out</button></div> : <div className="account-options"><button className="chatgpt-login" onClick={() => connectAccount("login")} disabled={Boolean(busy)}><span>✦</span><div><strong>Continue with ChatGPT</strong><small>Use your Codex subscription and workspace access</small></div><b>→</b></button><div className="account-divider"><span>or use an API key</span></div><label>OpenAI API key<div><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…"/><button onClick={() => connectAccount("apiKey")} disabled={!apiKey.trim() || Boolean(busy)}>Connect</button></div><small>The key is passed directly to the local Codex login flow.</small></label></div>}</section></div>}
  </main>;
}
