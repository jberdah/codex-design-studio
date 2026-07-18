"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectData, ReviewReport, SelectionContext } from "@/domain/types";
import { SlidePreview } from "./SlidePreview";

type Surface = "brand" | "system" | "web" | "slides";
type ApiProject = { project: ProjectData; landingHtml: string };

const nav: Array<{ id: Surface; label: string; glyph: string }> = [
  { id: "brand", label: "Brand", glyph: "✦" },
  { id: "system", label: "Design system", glyph: "◫" },
  { id: "web", label: "Landing page", glyph: "⌁" },
  { id: "slides", label: "Presentation", glyph: "▰" }
];

export function Studio() {
  const previewRef = useRef<HTMLIFrameElement>(null);
  const [data, setData] = useState<ApiProject | null>(null);
  const [surface, setSurface] = useState<Surface>("web");
  const [selection, setSelection] = useState<SelectionContext>();
  const [instruction, setInstruction] = useState("Make this hero feel more premium and concise");
  const [busy, setBusy] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [review, setReview] = useState<ReviewReport>();
  const [mobile, setMobile] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [agent, setAgent] = useState<{ available: boolean; model: string; cliVersion: string }>();
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "Your brand system is ready. Select anything in the landing preview, then describe what should change." }
  ]);

  const load = useCallback(async () => {
    const response = await fetch("/api/project", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the demo project.");
    setData(await response.json() as ApiProject);
  }, []);

  useEffect(() => {
    load().catch((error) => setToast(error.message));
    fetch("/api/agent/status").then((response) => response.json()).then(setAgent).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== previewRef.current?.contentWindow) return;
      if (event.data?.type === "design-selection") {
        setSelection(event.data.selection as SelectionContext);
        setInstruction("");
        setMessages((current) => [...current, { role: "assistant", text: `${event.data.selection.label} selected. What would you like to change?` }]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const project = data?.project;
  const updateProject = (updater: (project: ProjectData) => ProjectData) => setData((current) => current ? { ...current, project: updater(structuredClone(current.project)) } : current);

  async function saveSystem() {
    if (!project) return;
    setBusy("Saving brand system");
    try {
      const response = await fetch("/api/project", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ brand: project.brand, tokens: project.tokens, landing: project.landing }) });
      setData(await response.json() as ApiProject);
      setToast("Brand system saved and propagated to web + slides.");
    } finally { setBusy(undefined); }
  }

  async function refine() {
    if (!project || !instruction.trim()) return;
    const request = instruction.trim();
    setMessages((current) => [...current, { role: "user", text: request }]);
    setInstruction("");
    setBusy("Codex is analysing the selected context");
    try {
      const mode = process.env.NEXT_PUBLIC_CODEX_STUDIO_MODE === "fallback" ? "fallback" : "auto";
      const response = await fetch("/api/refine", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: request, selection, mode }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Refinement failed");
      setData({ project: result.project, landingHtml: result.landingHtml });
      setMessages((current) => [...current, { role: "assistant", text: `${result.summary} ${result.source === "codex" ? "Applied by Codex." : "Applied with the reliable demo fallback."}` }]);
      setToast(result.warning ?? `${result.filesModified.length} source files updated.`);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: error instanceof Error ? error.message : "Refinement failed." }]);
    } finally { setBusy(undefined); }
  }

  async function runReview() {
    setBusy("Checking brand consistency");
    try {
      const response = await fetch("/api/review", { method: "POST" });
      const report = await response.json() as ReviewReport;
      setReview(report);
      setToast(`Review complete · ${report.score}/100`);
    } finally { setBusy(undefined); }
  }

  async function reset() {
    setBusy("Restoring demo project");
    const response = await fetch("/api/project/reset", { method: "POST" });
    setData(await response.json() as ApiProject);
    setSelection(undefined); setReview(undefined); setMessages([{ role: "assistant", text: "Demo restored. The original Asteria brand system is ready." }]);
    setBusy(undefined); setToast("Demo project restored.");
  }

  const surfaceTitle = useMemo(() => nav.find((item) => item.id === surface)?.label ?? "Studio", [surface]);
  if (!project || !data) return <main className="loading-screen"><div className="loader-mark">✦</div><p>Opening the studio…</p></main>;

  return <main className="studio-shell">
    <header className="topbar">
      <div className="wordmark"><span>✦</span><strong>Codex</strong> Design Studio</div>
      <div className="project-crumb"><span className="status-dot"/>{project.name}<span>·</span><small>v{project.tokens.version}</small></div>
      <div className="top-actions">
        <button className="ghost-button" onClick={reset}>Restore demo</button>
        <button className="ghost-button" onClick={runReview}>✓ Review</button>
        <div className="export-menu"><span>Export</span><div><a href="/api/export/web">Landing ZIP</a><a href="/api/export/pptx">Editable PPTX</a><a href="/api/export/tokens">Tokens JSON</a></div></div>
      </div>
    </header>
    <div className="studio-grid">
      <aside className="sidebar">
        <div className="project-tile"><div className="project-avatar">A</div><div><strong>{project.brand.name}</strong><span>{project.brand.industry}</span></div></div>
        <nav>{nav.map((item) => <button key={item.id} className={surface === item.id ? "current" : ""} onClick={() => setSurface(item.id)}><span>{item.glyph}</span>{item.label}{item.id === "web" && <i>Live</i>}</button>)}</nav>
        <div className="side-bottom"><div className="agent-state"><span className="agent-pulse"/><div><strong>{agent?.available ? "Codex connected" : "Checking Codex"}</strong><small>{agent ? `${agent.model} · CLI ${agent.cliVersion}` : "App Server"}</small></div></div></div>
      </aside>
      <section className="workspace">
        <div className="workspace-bar"><div><small>{surface === "system" ? "SOURCE OF TRUTH" : "ACTIVE DELIVERABLE"}</small><strong>{surfaceTitle}</strong></div>{surface === "web" && <div className="viewport-toggle"><button className={!mobile ? "active" : ""} onClick={() => setMobile(false)}>Desktop</button><button className={mobile ? "active" : ""} onClick={() => setMobile(true)}>Mobile</button></div>}<div className="workspace-meta"><span>Synced with tokens</span><b>●</b></div></div>
        <div className="canvas-area">
          {surface === "web" && <div className={`browser-frame ${mobile ? "mobile" : ""}`}><div className="browser-chrome"><i/><i/><i/><span>asteria.local</span><em>↗</em></div><iframe ref={previewRef} title="Generated landing page" srcDoc={data.landingHtml} sandbox="allow-scripts"/></div>}
          {surface === "slides" && <div className="slides-canvas"><div className="slides-stage"><SlidePreview slide={project.slides[activeSlide]} tokens={project.tokens} brandName={project.brand.name} index={activeSlide} active onClick={() => undefined}/></div><div className="slide-strip">{project.slides.map((slide, index) => <div key={slide.id}><span>0{index + 1}</span><SlidePreview slide={slide} tokens={project.tokens} brandName={project.brand.name} index={index} active={activeSlide === index} onClick={() => setActiveSlide(index)}/></div>)}</div></div>}
          {surface === "brand" && <div className="editor-card"><div className="editor-heading"><div><small>BRAND PROFILE</small><h1>Define once. Use everywhere.</h1><p>The profile guides every creative decision Codex makes.</p></div><button className="primary-button" onClick={saveSystem}>Save & propagate</button></div><div className="form-grid">
            <label>Brand name<input value={project.brand.name} onChange={(e) => updateProject((p) => { p.brand.name = e.target.value; return p; })}/></label>
            <label>Industry<input value={project.brand.industry} onChange={(e) => updateProject((p) => { p.brand.industry = e.target.value; return p; })}/></label>
            <label className="span-two">Audience<input value={project.brand.audience} onChange={(e) => updateProject((p) => { p.brand.audience = e.target.value; return p; })}/></label>
            <label className="span-two">Promise<textarea value={project.brand.promise} onChange={(e) => updateProject((p) => { p.brand.promise = e.target.value; return p; })}/></label>
            <label>Tone<input value={project.brand.tone} onChange={(e) => updateProject((p) => { p.brand.tone = e.target.value; return p; })}/></label>
            <label>Visual direction<input value={project.brand.visualDirection} onChange={(e) => updateProject((p) => { p.brand.visualDirection = e.target.value; return p; })}/></label>
          </div></div>}
          {surface === "system" && <div className="token-page"><div className="editor-heading"><div><small>DESIGN SYSTEM · {project.tokens.version}</small><h1>Your brand, made executable.</h1><p>Every token below controls the landing page and presentation.</p></div><button className="primary-button" onClick={saveSystem}>Apply tokens</button></div><div className="token-layout"><section className="token-section"><h2>Colour foundations</h2><div className="swatch-grid">{Object.entries(project.tokens.colors).map(([name, value]) => <label key={name} className="swatch"><input type="color" value={value} onChange={(e) => updateProject((p) => { p.tokens.colors[name as keyof typeof p.tokens.colors] = e.target.value.toUpperCase(); return p; })}/><span style={{ background: value }}/><strong>{name}</strong><code>{value}</code></label>)}</div></section><section className="token-section type-preview"><h2>Typography</h2><div><small>DISPLAY · {project.tokens.typography.display}</small><strong style={{ fontFamily: project.tokens.typography.display }}>Clarity that compounds.</strong></div><div><small>BODY · {project.tokens.typography.body}</small><p style={{ fontFamily: project.tokens.typography.body }}>Precise, confident and human communication across every touchpoint.</p></div></section><section className="token-section json-panel"><h2>Structured source</h2><pre>{JSON.stringify(project.tokens, null, 2)}</pre></section></div></div>}
        </div>
      </section>
      <aside className="chat-panel">
        <div className="chat-head"><div><small>CODEX</small><strong>Creative direction</strong></div><span>•••</span></div>
        <div className="context-card"><div className="context-icon">⌖</div><div><small>CURRENT CONTEXT</small><strong>{selection?.label ?? (surface === "slides" ? `Slide ${activeSlide + 1}` : surfaceTitle)}</strong><span>{selection ? `${selection.viewport} · ${selection.designId}` : "Select an element to target it"}</span></div>{selection && <button onClick={() => setSelection(undefined)}>×</button>}</div>
        <div className="messages">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}><span>{message.role === "assistant" ? "✦" : "You"}</span><p>{message.text}</p></div>)}{busy && <div className="message assistant working"><span>✦</span><p>{busy}<i/><i/><i/></p></div>}</div>
        <div className="quick-prompts"><button onClick={() => setInstruction("Make this feel more premium")}>More premium</button><button onClick={() => setInstruction("Make it warmer")}>Warmer</button><button onClick={() => setInstruction("Shorten this copy")}>Shorten</button></div>
        <div className="composer"><textarea aria-label="Refinement instruction" placeholder={selection ? `Change ${selection.label}…` : "Ask Codex to refine the brand…"} value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); refine(); } }}/><div><span>Context attached</span><button aria-label="Send instruction" onClick={refine} disabled={!instruction.trim() || Boolean(busy)}>↑</button></div></div>
      </aside>
    </div>
    {review && <div className="review-drawer"><div className="review-score"><span>{review.score}</span><div><small>BRAND HEALTH</small><strong>{review.score >= 90 ? "Ready to ship" : "Needs attention"}</strong></div><button onClick={() => setReview(undefined)}>×</button></div>{review.checks.map((check) => <div className={`review-item ${check.status}`} key={check.id}><b>{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×"}</b><div><strong>{check.label}</strong><span>{check.message}</span></div></div>)}</div>}
    {toast && <button className="toast" onClick={() => setToast(undefined)}>{toast}<span>×</span></button>}
  </main>;
}
