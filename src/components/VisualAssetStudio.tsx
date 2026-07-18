"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BrandSystemRegistry } from "@/domain/brand-system";
import type { ProjectData } from "@/domain/types";
import type { GeneratedAssetVersion, VisualAssetBrief, VisualAssetRegistry, VisualAssetTarget } from "@/domain/visual-assets";

type AdapterName = "codex-app-server" | "openai-image-api" | "openai-responses-api";

export function VisualAssetStudio({ projectId, project, brandSystems, onBusy, onToast }: { projectId: string; project: ProjectData; brandSystems?: BrandSystemRegistry; onBusy(value?: string): void; onToast(value: string): void }) {
  const [registry, setRegistry] = useState<VisualAssetRegistry>();
  const [prompt, setPrompt] = useState("A confident team making one clear decision together, with room for a headline");
  const [variants, setVariants] = useState(3);
  const [targetKind, setTargetKind] = useState<"web" | "slides">("web");
  const [adapter, setAdapter] = useState<AdapterName>("codex-app-server");
  const [selected, setSelected] = useState<string[]>([]);
  const [byokKey, setByokKey] = useState("");
  const [byokConfigured, setByokConfigured] = useState(false);

  const endpoint = useCallback((pathname = "/api/visual-assets") => `${pathname}?project=${encodeURIComponent(projectId)}`, [projectId]);
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint(), { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load visual assets.");
    setRegistry(result.registry);
  }, [endpoint]);

  useEffect(() => {
    refresh().catch((error) => onToast(error.message));
    fetch("/api/openai-key", { cache: "no-store" }).then((response) => response.json()).then((result) => setByokConfigured(Boolean(result.configured))).catch(() => undefined);
  }, [refresh, onToast]);

  const published = brandSystems?.versions.find((version) => version.id === brandSystems.publishedVersionId && version.status === "published");
  const target = useMemo<VisualAssetTarget>(() => targetKind === "web"
    ? { artifactId: "web", artifactKind: "web", contextId: "landing-hero", role: "hero-media", context: { type: "web", viewport: { width: 1440, height: 900 }, crop: { width: 1024, height: 1024 }, fit: "cover" } }
    : { artifactId: "slides", artifactKind: "slides", contextId: `slide-${project.slides[0]?.id ?? "cover"}-media`, role: "cover-media", context: { type: "slide", slideId: project.slides[0]?.id ?? "cover", frame: { width: 960, height: 540, unit: "pt" }, fit: "cover" } }, [project.slides, targetKind]);

  async function request(body: Record<string, unknown>, method: "POST" | "PATCH" = "POST") {
    const response = await fetch(endpoint(), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Visual asset operation failed.");
    await refresh(); return result;
  }

  async function generate() {
    if (!published || !prompt.trim()) return;
    onBusy("Codex is generating deliberate visual variants");
    const localBrief: VisualAssetBrief = {
      schemaVersion: 1, id: `vab_${crypto.randomUUID()}`, title: `${targetKind === "web" ? "Landing" : "Presentation"} visual`, objective: `Create brand-aware ${target.role}`, audience: project.brand.audience,
      target, brandSystemVersionId: published.id,
      brandDirection: { personality: project.brand.personality, visualStyle: project.tokens.media.style, lighting: project.tokens.media.lighting, composition: project.tokens.media.composition, palette: Object.values(project.tokens.colors), mustInclude: ["usable negative space", "clear focal hierarchy"], mustAvoid: [...project.tokens.voice.forbiddenPatterns, "logos unless explicitly requested", "generic stock-photo gestures"] },
      prompt: prompt.trim(), inputAssets: [], output: { width: 1024, height: 1024, quality: "medium", encoding: "png", background: "opaque", variants, maxBytes: 8_000_000 }, createdAt: new Date().toISOString(), createdBy: "user"
    };
    try {
      const planned = await request({ action: "draft-brief", objective: prompt.trim(), target, brandSystemVersionId: published.id, output: localBrief.output });
      const result = await request({ action: "generate", assetId: `${targetKind}-hero`, brief: planned.brief, adapter });
      setSelected(result.versions.map((version: GeneratedAssetVersion) => version.versionId)); onToast(`${result.versions.length} immutable variants generated from a Codex-authored brief.`);
    }
    catch (error) { onToast(error instanceof Error ? error.message : "Generation failed."); }
    finally { onBusy(); }
  }

  async function action(actionName: string, version: GeneratedAssetVersion) {
    onBusy(`${actionName[0].toUpperCase()}${actionName.slice(1)} visual asset`);
    try {
      if (actionName === "refine") {
        const instruction = window.prompt("Describe the refinement. Unmentioned details will be preserved.");
        if (!instruction) return;
        await request({ action: "refine", sourceVersionId: version.versionId, instruction, adapter });
      } else if (actionName === "place") await request({ action: "place", versionId: version.versionId, target, placementId: `${target.artifactId}:${target.contextId}` }, "PATCH");
      else await request({ action: actionName, versionId: version.versionId }, "PATCH");
      onToast(actionName === "place" ? `Placement now binds to ${version.versionId}.` : `${actionName} completed without erasing prior versions.`);
    } catch (error) { onToast(error instanceof Error ? error.message : "Visual asset action failed."); }
    finally { onBusy(); }
  }

  async function saveByok() {
    const response = await fetch("/api/openai-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: byokKey }) });
    const result = await response.json(); if (!response.ok) return onToast(result.error ?? "Could not store BYOK key.");
    setByokKey(""); setByokConfigured(true); onToast("Platform key stored in the operating-system keychain for explicit BYOK generation.");
  }

  const versions = registry?.versions.filter((version) => version.assetId === `${targetKind}-hero`).slice().reverse() ?? [];
  return <div className="asset-studio">
    <header className="asset-studio-head"><div><small>OPENAI · VERSIONED MEDIA</small><h1>Generate broadly. Place precisely.</h1><p>Codex creates the brief and distinct directions; the host validates and preserves every original and derivative.</p></div><div className="asset-auth"><b>{adapter === "codex-app-server" ? "ChatGPT connected path" : byokConfigured ? "Platform keychain ready" : "BYOK key required"}</b><span>{adapter === "codex-app-server" ? "Zero-key default" : "Explicit batch workflow"}</span></div></header>
    {!published && <div className="asset-blocker">Publish a BrandSystem version before generating assets so every output has a stable brand binding.</div>}
    <section className="asset-controls">
      <label className="asset-prompt">Visual objective<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000}/></label>
      <label>Target<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as "web" | "slides")}><option value="web">Web hero · square crop</option><option value="slides">Slide cover · 16:9 crop</option></select></label>
      <label>Variants<select value={variants} onChange={(event) => setVariants(Number(event.target.value))}><option value={2}>2 distinct</option><option value={3}>3 distinct</option><option value={4}>4 distinct</option></select></label>
      <label>Generation path<select value={adapter} onChange={(event) => setAdapter(event.target.value as AdapterName)}><option value="codex-app-server">ChatGPT / Codex (default)</option><option value="openai-image-api">Platform Image API (BYOK)</option><option value="openai-responses-api">Platform Responses (BYOK edits)</option></select></label>
      {adapter !== "codex-app-server" && !byokConfigured && <label className="asset-key">Platform API key<div><input type="password" value={byokKey} onChange={(event) => setByokKey(event.target.value)} placeholder="sk-…"/><button onClick={saveByok} disabled={!byokKey.trim()}>Store in keychain</button></div></label>}
      <button className="primary-button" onClick={generate} disabled={!published || !prompt.trim() || (adapter !== "codex-app-server" && !byokConfigured)}>Generate variants</button>
    </section>
    <div className="asset-library-head"><div><h2>Version library</h2><span>{versions.length} preserved · {registry?.placements.filter((placement) => placement.target.artifactId === targetKind).length ?? 0} placed</span></div><b>{selected.length >= 2 ? `Comparing ${selected.length}` : "Select 2–4 to compare"}</b></div>
    <section className="asset-grid">{versions.map((version) => {
      const hasError = version.validations.some((validation) => validation.status === "error");
      const placed = registry?.placements.some((placement) => placement.versionId === version.versionId);
      return <article key={version.versionId} className={selected.includes(version.versionId) ? "selected" : ""}>
        <button className="asset-image" onClick={() => setSelected((current) => current.includes(version.versionId) ? current.filter((id) => id !== version.versionId) : current.length < 4 ? [...current, version.versionId] : current)}><img src={`${version.fileUri}?project=${encodeURIComponent(projectId)}`} alt={`${version.assetId} ${version.versionId}`}/><span>{selected.includes(version.versionId) ? "✓ Compare" : "Add to compare"}</span></button>
        <div className="asset-version"><code>{version.versionId}</code><span className={`status-badge ${version.approval.status}`}>{version.approval.status}</span>{placed && <b>Placed</b>}</div>
        <p>{version.revisedPrompt ?? version.prompt}</p>
        <div className={`asset-validation ${hasError ? "error" : "pass"}`}>{hasError ? "× Validation errors" : `✓ ${version.output.actualWidth}×${version.output.actualHeight} · ${Math.round(version.output.actualBytes / 1024)} KB`}</div>
        <div className="asset-actions">{version.approval.status !== "approved" && <button onClick={() => action("approve", version)} disabled={hasError}>Approve</button>}<button onClick={() => action("refine", version)}>Refine</button><button onClick={() => action("restore", version)}>Restore</button>{version.approval.status === "approved" && <button onClick={() => action("place", version)}>Place</button>}</div>
      </article>;
    })}{!versions.length && <div className="asset-empty">Your generated directions will appear here with hashes, validation status and stable version IDs.</div>}</section>
  </div>;
}
