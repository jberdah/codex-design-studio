"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlideDocument, SlideNode } from "@/domain/artifacts";
import {
  applyEditTransaction,
  createArtifactEditSession,
  markEditAutosaved,
  redoEditTransaction,
  undoEditTransaction,
  type ArtifactEditOperation,
  type ArtifactEditSession,
  type EditBoundary,
  type EditFeedback
} from "@/domain/editing";

export interface ArtifactCanvasEditorProps {
  artifactId: string;
  document: SlideDocument;
  slideId: string;
  sessionId?: string;
  readOnly?: boolean;
  onChange?: (document: SlideDocument, session: ArtifactEditSession<SlideDocument>) => void;
  onAutosave?: (document: SlideDocument, session: ArtifactEditSession<SlideDocument>) => void | Promise<void>;
}

type Gesture = { kind: "move" | "resize"; nodeId: string; startX: number; startY: number; dx: number; dy: number };
type SaveStatus = "idle" | "saving" | "saved" | "error";

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function nodeStyle(node: SlideNode, width: number, height: number, gesture?: Gesture): React.CSSProperties {
  const moving = gesture?.nodeId === node.id;
  const dx = moving ? gesture.dx : 0;
  const dy = moving ? gesture.dy : 0;
  const resizing = moving && gesture.kind === "resize";
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${((node.frame.x + (gesture?.kind === "move" ? dx : 0)) / width) * 100}%`,
    top: `${((node.frame.y + (gesture?.kind === "move" ? dy : 0)) / height) * 100}%`,
    width: `${((node.frame.width + (resizing ? dx : 0)) / width) * 100}%`,
    height: `${((node.frame.height + (resizing ? dy : 0)) / height) * 100}%`,
    zIndex: node.zIndex,
    opacity: node.opacity,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: "center"
  };
  if (node.type === "text") Object.assign(style, {
    color: node.style?.color,
    fontFamily: node.style?.fontFamily,
    fontSize: node.style?.fontSize ? `${node.style.fontSize}px` : undefined,
    fontWeight: node.style?.fontWeight,
    lineHeight: node.style?.lineHeight,
    letterSpacing: node.style?.letterSpacing ? `${node.style.letterSpacing}px` : undefined,
    textAlign: node.style?.align
  });
  if (node.type === "shape") Object.assign(style, {
    background: node.fill ?? "transparent",
    border: node.stroke ? `1px solid ${node.stroke}` : undefined,
    borderRadius: node.shape === "ellipse" ? "50%" : undefined
  });
  return style;
}

export function ArtifactCanvasEditor({ artifactId, document, slideId, sessionId = `canvas-${artifactId}`, readOnly = false, onChange, onAutosave }: ArtifactCanvasEditorProps) {
  const [session, setSession] = useState(() => createArtifactEditSession({ sessionId, artifactId, document }));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [gesture, setGesture] = useState<Gesture>();
  const [feedback, setFeedback] = useState<EditFeedback[]>([]);
  const [announcement, setAnnouncement] = useState("Canvas ready");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [externalDocument, setExternalDocument] = useState<SlideDocument>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const autosavedVersion = useRef(-1);
  const sessionRef = useRef(session);
  const emittedDocument = useRef<SlideDocument | undefined>(undefined);
  const identity = useRef(`${artifactId}\u0000${sessionId}`);
  const inFlightSave = useRef<Promise<void> | undefined>(undefined);
  const persistRef = useRef<() => Promise<void>>(async () => undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryAttempts = useRef(0);
  const mounted = useRef(true);
  sessionRef.current = session;
  const slide = session.document.slides.find((candidate) => candidate.id === slideId);

  useEffect(() => {
    const nextIdentity = `${artifactId}\u0000${sessionId}`;
    const current = sessionRef.current;
    if (identity.current !== nextIdentity) {
      const next = createArtifactEditSession({ sessionId, artifactId, document });
      identity.current = nextIdentity; sessionRef.current = next; setSession(next); setSelectedIds([]); setExternalDocument(undefined); autosavedVersion.current = -1; setSaveStatus("idle");
      return;
    }
    if (document === emittedDocument.current || document === current.document || JSON.stringify(document) === JSON.stringify(current.document)) return;
    if (current.dirty && autosavedVersion.current < current.version) {
      setExternalDocument(document);
      setAnnouncement("A newer external document is available. Reload it before continuing to avoid overwriting changes.");
      return;
    }
    const next = createArtifactEditSession({ sessionId, artifactId, document });
    sessionRef.current = next; setSession(next); setSelectedIds([]); setExternalDocument(undefined); autosavedVersion.current = -1; setSaveStatus("idle");
  }, [artifactId, document, sessionId]);

  const persistLatest = useCallback(async () => {
    if (externalDocument) return;
    if (inFlightSave.current) {
      try { await inFlightSave.current; } catch { /* The retry below uses the latest local snapshot. */ }
    }
    const target = sessionRef.current;
    if (!target.dirty || autosavedVersion.current >= target.version) return;
    if (mounted.current) setSaveStatus("saving");
    const task = Promise.resolve().then(() => onAutosave?.(target.document, target)).then(() => undefined);
    inFlightSave.current = task;
    try {
      await task;
      retryAttempts.current = 0;
      autosavedVersion.current = target.version;
      if (sessionRef.current.version === target.version) {
        const saved = markEditAutosaved(sessionRef.current, target.version);
        sessionRef.current = saved; if (mounted.current) setSession(saved);
      }
      if (mounted.current) { setSaveStatus("saved"); setAnnouncement("Changes autosaved"); }
    } catch (error) {
      retryAttempts.current += 1;
      if (mounted.current) {
        setSaveStatus("error");
        setAnnouncement(error instanceof Error ? `Autosave failed: ${error.message}. Retrying…` : "Autosave failed. Retrying…");
      }
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      if (retryAttempts.current <= 5) retryTimer.current = window.setTimeout(() => { void persistRef.current().catch(() => undefined); }, Math.min(6_000, 1_000 * retryAttempts.current));
      throw error;
    } finally {
      if (inFlightSave.current === task) inFlightSave.current = undefined;
    }
  }, [externalDocument, onAutosave]);

  useEffect(() => { persistRef.current = persistLatest; }, [persistLatest]);

  useEffect(() => {
    if (!session.dirty || autosavedVersion.current >= session.version || externalDocument) return;
    const timer = window.setTimeout(() => { void persistLatest().catch(() => undefined); }, 750);
    return () => window.clearTimeout(timer);
  }, [externalDocument, persistLatest, session.dirty, session.version]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      void persistRef.current().catch(() => undefined);
    };
  }, []);

  const commit = useCallback((label: string, boundary: Exclude<EditBoundary, "autosave">, operations: ArtifactEditOperation[]) => {
    if (readOnly || externalDocument) return;
    try {
      const current = sessionRef.current;
      const next = applyEditTransaction(current, { id: `tx-${current.version + 1}`, expectedVersion: current.version, label, boundary, operations });
      sessionRef.current = next; emittedDocument.current = next.document; setSession(next);
      setFeedback(next.undoStack.at(-1)?.feedback ?? []);
      setAnnouncement(label);
      onChange?.(next.document, next);
    } catch (error) { setAnnouncement(error instanceof Error ? error.message : "The edit could not be applied."); }
  }, [externalDocument, onChange, readOnly]);

  const undo = useCallback(() => {
    if (externalDocument) return;
    try {
      const current = sessionRef.current;
      if (!current.undoStack.length) return;
      const next = undoEditTransaction(current, current.version);
      sessionRef.current = next; emittedDocument.current = next.document; setSession(next);
      setAnnouncement(`Undid ${current.undoStack.at(-1)?.label ?? "edit"}`);
      onChange?.(next.document, next);
    } catch (error) { setAnnouncement(error instanceof Error ? error.message : "Undo failed."); }
  }, [externalDocument, onChange]);

  const redo = useCallback(() => {
    if (externalDocument) return;
    try {
      const current = sessionRef.current;
      if (!current.redoStack.length) return;
      const next = redoEditTransaction(current, current.version);
      sessionRef.current = next; emittedDocument.current = next.document; setSession(next);
      setAnnouncement(`Redid ${current.redoStack.at(-1)?.label ?? "edit"}`);
      onChange?.(next.document, next);
    } catch (error) { setAnnouncement(error instanceof Error ? error.message : "Redo failed."); }
  }, [externalDocument, onChange]);

  function pointerStart(event: React.PointerEvent, nodeId: string, kind: Gesture["kind"]) {
    if (readOnly || externalDocument) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedIds((current) => event.shiftKey ? current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId] : current.includes(nodeId) ? current : [nodeId]);
    setGesture({ kind, nodeId, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  }

  function pointerMove(event: React.PointerEvent) {
    if (!gesture || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setGesture((current) => current ? { ...current, dx: (event.clientX - current.startX) * session.document.dimensions.width / rect.width, dy: (event.clientY - current.startY) * session.document.dimensions.height / rect.height } : current);
  }

  function pointerEnd() {
    if (!gesture || !slide) return;
    const current = gesture;
    setGesture(undefined);
    if (Math.abs(current.dx) < 0.25 && Math.abs(current.dy) < 0.25) return;
    if (current.kind === "move") {
      const ids = selectedIds.includes(current.nodeId) ? selectedIds : [current.nodeId];
      commit(`Moved ${ids.length} element${ids.length === 1 ? "" : "s"}`, "gesture", [{ type: "slide.move", slideId, nodeIds: ids, dx: current.dx, dy: current.dy }]);
    } else {
      const node = slide.nodes.find((candidate) => candidate.id === current.nodeId);
      if (node) commit("Resized element", "gesture", [{ type: "slide.resize", slideId, nodeId: node.id, frame: { width: node.frame.width + current.dx, height: node.frame.height + current.dy }, minSize: 8 }]);
    }
  }

  function keyboard(event: React.KeyboardEvent) {
    if (isTextEditingTarget(event.target)) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!readOnly && selectedIds.length && movement[event.key]) {
      event.preventDefault();
      const [x, y] = movement[event.key];
      const amount = event.shiftKey ? 10 : 1;
      commit(`Nudged ${selectedIds.length} element${selectedIds.length === 1 ? "" : "s"}`, "keyboard", [{ type: "slide.move", slideId, nodeIds: selectedIds, dx: x * amount, dy: y * amount }]);
    }
  }

  function editText(event: React.FocusEvent<HTMLElement>, node: Extract<SlideNode, { type: "text" }>) {
    const text = event.currentTarget.textContent ?? "";
    if (externalDocument) { event.currentTarget.textContent = node.text; return; }
    if (text === node.text) return;
    const selection = window.getSelection();
    const anchor = selection && event.currentTarget.contains(selection.anchorNode) ? Math.min(text.length, selection.anchorOffset) : text.length;
    const focus = selection && event.currentTarget.contains(selection.focusNode) ? Math.min(text.length, selection.focusOffset) : anchor;
    const direction = selection?.direction === "forward" || selection?.direction === "backward" ? selection.direction : "none";
    commit("Edited text", "inline-edit", [{ type: "slide.text", slideId, nodeId: node.id, text, selection: { anchor, focus, direction } }]);
  }

  const selectedNodes = useMemo(() => slide?.nodes.filter((node) => selectedIds.includes(node.id)) ?? [], [selectedIds, slide]);
  if (!slide) return <div role="alert">Slide {slideId} is unavailable.</div>;
  const align = (alignment: "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom") => commit(`Aligned ${alignment.replace("-", " ")}`, "control", [{ type: "slide.align", slideId, nodeIds: selectedIds, alignment }]);
  const reloadExternal = () => {
    if (!externalDocument) return;
    const next = createArtifactEditSession({ sessionId, artifactId, document: externalDocument });
    sessionRef.current = next; setSession(next); setExternalDocument(undefined); setSelectedIds([]); autosavedVersion.current = -1; setSaveStatus("idle"); setAnnouncement("Reloaded the external document");
  };

  return <section className="artifact-canvas-editor" aria-label={`Editing ${slide.name}`} onKeyDown={keyboard}>
    <div className="artifact-edit-toolbar" role="toolbar" aria-label="Element controls">
      <button type="button" onClick={undo} disabled={!session.undoStack.length || Boolean(externalDocument)} aria-label="Undo">↶</button>
      <button type="button" onClick={redo} disabled={!session.redoStack.length || Boolean(externalDocument)} aria-label="Redo">↷</button>
      <span aria-hidden="true"/>
      <button type="button" onClick={() => align("left")} disabled={selectedIds.length < 2}>Align left</button>
      <button type="button" onClick={() => align("horizontal-center")} disabled={selectedIds.length < 2}>Centre</button>
      <button type="button" onClick={() => commit("Distributed horizontally", "control", [{ type: "slide.distribute", slideId, nodeIds: selectedIds, axis: "horizontal" }])} disabled={selectedIds.length < 3}>Distribute</button>
      <button type="button" onClick={() => commit("Grouped elements", "control", [{ type: "slide.group", slideId, nodeIds: selectedIds, groupId: `group-${session.version + 1}` }])} disabled={selectedIds.length < 2}>Group</button>
      <button type="button" onClick={() => commit("Brought elements forward", "control", [{ type: "slide.z-order", slideId, nodeIds: selectedIds, direction: "front" }])} disabled={!selectedIds.length}>Front</button>
      {selectedNodes.length === 1 && selectedNodes[0].type === "text" && <>
        <label>Size <input aria-label="Font size" type="number" min="8" max="256" value={selectedNodes[0].style?.fontSize ?? 24} onChange={(event) => commit("Changed type size", "control", [{ type: "slide.control", slideId, nodeIds: selectedIds, control: "typography.size", value: Number(event.target.value), scope: "selection" }])}/></label>
        <label>Text <input aria-label="Text colour" type="color" value={selectedNodes[0].style?.color ?? "#17161b"} onChange={(event) => commit("Changed text colour", "control", [{ type: "slide.control", slideId, nodeIds: selectedIds, control: "color.foreground", value: event.target.value, scope: "selection" }])}/></label>
      </>}
      <em>{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed · retrying" : autosavedVersion.current >= session.version ? "Autosaved" : session.dirty ? "Unsaved" : "Saved"} · scope: slide</em>
    </div>
    {externalDocument && <div role="alert" className="artifact-edit-conflict"><span>A newer external version arrived while this canvas had local edits.</span><button type="button" onClick={reloadExternal}>Reload external version</button></div>}
    <div className="artifact-slide-stage">
      <div ref={canvasRef} className="artifact-slide-canvas" tabIndex={0} role="listbox" aria-multiselectable="true" aria-label={`${slide.name} canvas. Use arrow keys to move selected elements; Shift moves by ten points.`} style={{ aspectRatio: `${session.document.dimensions.width}/${session.document.dimensions.height}` }} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={() => setGesture(undefined)} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedIds([]); }}>
        {[...slide.nodes].sort((a, b) => a.zIndex - b.zIndex).map((node) => {
          const selected = selectedIds.includes(node.id);
          return <div key={node.id} className={`artifact-node artifact-node-${node.type}${selected ? " selected" : ""}`} data-node-id={node.id} data-selected={selected || undefined} style={nodeStyle(node, session.document.dimensions.width, session.document.dimensions.height, gesture)} role="option" tabIndex={0} aria-label={node.name ?? `${node.type} ${node.id}`} aria-selected={selected} onFocus={() => { if (!selected) setSelectedIds([node.id]); }} onKeyDown={(event) => { if (!isTextEditingTarget(event.target) && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedIds((current) => event.shiftKey ? current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id] : [node.id]); } }} onPointerDown={(event) => pointerStart(event, node.id, "move")}>
            {node.type === "text" && <span role="textbox" aria-multiline="true" tabIndex={0} contentEditable={!readOnly && !externalDocument} suppressContentEditableWarning onPointerDown={(event) => { if (event.detail > 1) event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={(event) => editText(event, node)}>{node.text}</span>}
            {node.type === "media" && (node.mediaType === "image" ? <img src={node.source.uri} alt={node.altText}/> : <span>{node.mediaType}</span>)}
            {node.type === "group" && <span className="artifact-group-label">{node.name ?? "Group"}</span>}
            {selected && !readOnly && !externalDocument && <button type="button" className="artifact-resize-handle" aria-label={`Resize ${node.name ?? node.id}`} onPointerDown={(event) => pointerStart(event, node.id, "resize")}/>}
          </div>;
        })}
      </div>
    </div>
    <div className="artifact-edit-feedback" aria-live="polite"><span>{announcement}</span>{feedback.map((item) => <strong key={`${item.code}-${item.nodeId}`}>{item.message}</strong>)}</div>
  </section>;
}
