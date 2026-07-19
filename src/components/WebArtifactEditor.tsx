"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { WebDocument } from "@/domain/artifacts";
import {
  applyEditTransaction,
  createArtifactEditSession,
  markEditAutosaved,
  redoEditTransaction,
  undoEditTransaction,
  type ArtifactEditSession,
  type ResponsiveScope
} from "@/domain/editing";

export interface WebArtifactEditorProps {
  artifactId: string;
  document: WebDocument;
  sessionId?: string;
  initialScope?: ResponsiveScope;
  onChange?: (document: WebDocument, session: ArtifactEditSession<WebDocument>) => void;
  onAutosave?: (document: WebDocument, session: ArtifactEditSession<WebDocument>) => void | Promise<void>;
  onSelectNode?: (selection: { nodeId: string; label: string; text: string }) => void;
}

function interactionScript(channel: string) { return `<script nonce="${channel}">(function(){
let selected;
const channel=${JSON.stringify(channel)};
function send(type,payload){parent.postMessage(Object.assign({type:type,channel:channel},payload||{}),'*')}
document.addEventListener('click',function(event){const node=event.target.closest('[data-design-node-id]');if(!node)return;event.preventDefault();selected&&selected.removeAttribute('data-studio-selected');selected=node;node.setAttribute('data-studio-selected','true');send('artifact-web-selection',{nodeId:node.getAttribute('data-design-node-id'),label:node.getAttribute('aria-label')||node.getAttribute('data-design-label')||node.tagName.toLowerCase(),text:(node.textContent||'').slice(0,10000)})});
document.addEventListener('dblclick',function(event){const node=event.target.closest('[data-design-node-id]');if(!node||node.children.length)return;event.preventDefault();node.contentEditable='true';node.focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)});
document.addEventListener('focusout',function(event){const node=event.target.closest&&event.target.closest('[data-design-node-id][contenteditable=true]');if(!node)return;const selection=getSelection();send('artifact-web-text',{nodeId:node.getAttribute('data-design-node-id'),text:node.textContent||'',selection:{anchor:selection&&selection.anchorNode&&node.contains(selection.anchorNode)?selection.anchorOffset:0,focus:selection&&selection.focusNode&&node.contains(selection.focusNode)?selection.focusOffset:0,direction:selection&&selection.direction||'none'}});node.removeAttribute('contenteditable')});
document.addEventListener('keydown',function(event){if(event.key==='Escape'&&event.target.isContentEditable){event.preventDefault();event.target.blur()}});
})();</script>`; }

function safeStyleBlock(code: string) { return code.replace(/<\/style/gi, "<\\/style"); }

function isEditorInput(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function inertAuthoredScripts(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "$1=$2#$2");
}

export function buildWebEditorPreview(document: WebDocument, channel: string) {
  const stylesheet = document.stylesheets.map((sheet) => sheet.media ? `@media ${sheet.media}{${sheet.code}}` : sheet.code).join("\n");
  const styles = `<style id="studio-document-styles">${safeStyleBlock(stylesheet)}\n[data-design-node-id]{outline:2px solid transparent;outline-offset:2px}[data-design-node-id]:hover{outline-color:#8b73ef}[data-studio-selected=true]{outline:3px solid #6f52e8!important}</style>`;
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${channel}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  let html = inertAuthoredScripts(document.html);
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (opening) => `${opening}${policy}${styles}`);
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (opening) => `${opening}<head>${policy}${styles}</head>`);
  else html = `<head>${policy}${styles}</head>${html}`;
  const script = interactionScript(channel);
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : `${html}${script}`;
}

export function WebArtifactEditor({ artifactId, document, sessionId = `web-${artifactId}`, initialScope = "shared", onChange, onAutosave, onSelectNode }: WebArtifactEditorProps) {
  const channel = useId().replace(/[^a-z0-9_-]/gi, "") || "studio-channel";
  const iframe = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState(() => createArtifactEditSession({ sessionId, artifactId, document }));
  const [nodeId, setNodeId] = useState<string>();
  const [nodeLabel, setNodeLabel] = useState<string>();
  const [scope, setScope] = useState<ResponsiveScope>(initialScope);
  const [announcement, setAnnouncement] = useState("Web canvas ready");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [externalDocument, setExternalDocument] = useState<WebDocument>();
  const autosavedVersion = useRef(-1);
  const sessionRef = useRef(session);
  const emittedDocument = useRef<WebDocument | undefined>(undefined);
  const identity = useRef(`${artifactId}\u0000${sessionId}`);
  const inFlightSave = useRef<Promise<void> | undefined>(undefined);
  const persistRef = useRef<() => Promise<void>>(async () => undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryAttempts = useRef(0);
  const mounted = useRef(true);
  sessionRef.current = session;

  useEffect(() => {
    const nextIdentity = `${artifactId}\u0000${sessionId}`;
    const current = sessionRef.current;
    if (identity.current !== nextIdentity) {
      const next = createArtifactEditSession({ sessionId, artifactId, document });
      identity.current = nextIdentity; sessionRef.current = next; setSession(next); setNodeId(undefined); setExternalDocument(undefined); autosavedVersion.current = -1; setSaveStatus("idle");
      return;
    }
    if (document === emittedDocument.current || document === current.document || JSON.stringify(document) === JSON.stringify(current.document)) return;
    if (current.dirty && autosavedVersion.current < current.version) { setExternalDocument(document); setAnnouncement("A newer external Web document is available. Reload it before continuing."); return; }
    const next = createArtifactEditSession({ sessionId, artifactId, document });
    sessionRef.current = next; setSession(next); setNodeId(undefined); setExternalDocument(undefined); autosavedVersion.current = -1; setSaveStatus("idle");
  }, [artifactId, document, sessionId]);

  const persistLatest = useCallback(async () => {
    if (externalDocument) return;
    if (inFlightSave.current) { try { await inFlightSave.current; } catch { /* Retry the latest snapshot below. */ } }
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
      if (mounted.current) { setSaveStatus("saved"); setAnnouncement("Web source autosaved"); }
    } catch (error) {
      retryAttempts.current += 1;
      if (mounted.current) {
        setSaveStatus("error"); setAnnouncement(error instanceof Error ? `Autosave failed: ${error.message}. Retrying…` : "Autosave failed. Retrying…");
      }
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      if (retryAttempts.current <= 5) retryTimer.current = window.setTimeout(() => { void persistRef.current().catch(() => undefined); }, Math.min(6_000, 1_000 * retryAttempts.current));
      throw error;
    } finally { if (inFlightSave.current === task) inFlightSave.current = undefined; }
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

  const commit = useCallback((label: string, operation: Parameters<typeof applyEditTransaction<WebDocument>>[1]["operations"][number]) => {
    if (externalDocument) return;
    try {
      const current = sessionRef.current;
      const next = applyEditTransaction(current, { id: `tx-${current.version + 1}`, expectedVersion: current.version, label, boundary: operation.type === "web.text" ? "inline-edit" : "control", operations: [operation] });
      sessionRef.current = next; emittedDocument.current = next.document; setSession(next);
      const note = next.undoStack.at(-1)?.feedback.at(-1)?.message;
      setAnnouncement(note ? `${label}. ${note}` : label);
      onChange?.(next.document, next);
    } catch (error) { setAnnouncement(error instanceof Error ? error.message : "The Web edit could not be applied."); }
  }, [externalDocument, onChange]);

  const undo = useCallback(() => {
    if (externalDocument || !sessionRef.current.undoStack.length) return;
    try { const next = undoEditTransaction(sessionRef.current, sessionRef.current.version); sessionRef.current = next; emittedDocument.current = next.document; setSession(next); onChange?.(next.document, next); setAnnouncement("Undid Web edit"); }
    catch (error) { setAnnouncement(error instanceof Error ? error.message : "Undo failed."); }
  }, [externalDocument, onChange]);
  const redo = useCallback(() => {
    if (externalDocument || !sessionRef.current.redoStack.length) return;
    try { const next = redoEditTransaction(sessionRef.current, sessionRef.current.version); sessionRef.current = next; emittedDocument.current = next.document; setSession(next); onChange?.(next.document, next); setAnnouncement("Redid Web edit"); }
    catch (error) { setAnnouncement(error instanceof Error ? error.message : "Redo failed."); }
  }, [externalDocument, onChange]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data?.type === "artifact-web-selection" && typeof event.data.nodeId === "string") {
        const label = String(event.data.label ?? event.data.nodeId);
        setNodeId(event.data.nodeId); setNodeLabel(label); setAnnouncement(`Selected ${label}`);
        onSelectNode?.({ nodeId: event.data.nodeId, label, text: typeof event.data.text === "string" ? event.data.text : "" });
      }
      if (event.data?.type === "artifact-web-text" && typeof event.data.nodeId === "string" && typeof event.data.text === "string") {
        const direction = event.data.selection?.direction === "forward" || event.data.selection?.direction === "backward" ? event.data.selection.direction : "none";
        commit("Edited Web text", { type: "web.text", nodeId: event.data.nodeId, text: event.data.text, selection: { anchor: Math.min(event.data.text.length, Number(event.data.selection?.anchor) || 0), focus: Math.min(event.data.text.length, Number(event.data.selection?.focus) || 0), direction } });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, commit]);

  const source = useMemo(() => buildWebEditorPreview(session.document, channel), [channel, session.document]);
  const style = (label: string, declarations: Record<string, string | number>) => { if (nodeId) commit(label, { type: "web.style", nodeIds: [nodeId], declarations, scope }); };
  return <section className="web-artifact-editor" aria-label="Web artifact editor" onKeyDown={(event) => {
    if (isEditorInput(event.target)) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  }}>
    <div className="artifact-edit-toolbar" role="toolbar" aria-label="Web element controls">
      <button type="button" aria-label="Undo" onClick={undo} disabled={!session.undoStack.length || Boolean(externalDocument)}>↶</button>
      <button type="button" aria-label="Redo" onClick={redo} disabled={!session.redoStack.length || Boolean(externalDocument)}>↷</button>
      <strong>{nodeLabel ?? "Select an element"}</strong>
      <label>Scope <select aria-label="Responsive edit scope" value={scope} onChange={(event) => setScope(event.target.value as ResponsiveScope)}><option value="shared">Shared composition</option><option value="desktop">Desktop only</option><option value="mobile">Mobile only</option></select></label>
      <label>Padding <input aria-label="Element padding" type="number" min="0" max="240" defaultValue="24" disabled={!nodeId} onBlur={(event) => style("Changed spacing", { padding: `${event.target.value}px` })}/></label>
      <label>Size <input aria-label="Web font size" type="number" min="8" max="256" defaultValue="24" disabled={!nodeId} onBlur={(event) => style("Changed typography", { "font-size": `${event.target.value}px` })}/></label>
      <label>Colour <input aria-label="Web text colour" type="color" defaultValue="#17161b" disabled={!nodeId} onChange={(event) => style("Changed colour", { color: event.target.value })}/></label>
      <em>{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed · retrying" : autosavedVersion.current >= session.version ? "Autosaved" : session.dirty ? "Unsaved" : "Saved"} · {scope === "shared" ? "all breakpoints" : `${scope} only`}</em>
    </div>
    {externalDocument && <div role="alert" className="artifact-edit-conflict"><span>A newer external Web version arrived while local edits were pending.</span><button type="button" onClick={() => { const next = createArtifactEditSession({ sessionId, artifactId, document: externalDocument }); sessionRef.current = next; setSession(next); setExternalDocument(undefined); setNodeId(undefined); autosavedVersion.current = -1; setSaveStatus("idle"); setAnnouncement("Reloaded the external Web document"); }}>Reload external version</button></div>}
    <iframe ref={iframe} title="Editable Web artifact" srcDoc={source} sandbox="allow-scripts" referrerPolicy="no-referrer"/>
    <div className="artifact-edit-feedback" aria-live="polite">{announcement}</div>
  </section>;
}
