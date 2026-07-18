"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}

const interactionScript = `<script>(function(){
let selected;
function send(type,payload){parent.postMessage(Object.assign({type:type},payload||{}),'*')}
document.addEventListener('click',function(event){const node=event.target.closest('[data-design-node-id]');if(!node)return;event.preventDefault();selected&&selected.removeAttribute('data-studio-selected');selected=node;node.setAttribute('data-studio-selected','true');send('artifact-web-selection',{nodeId:node.getAttribute('data-design-node-id'),label:node.getAttribute('aria-label')||node.getAttribute('data-design-label')||node.tagName.toLowerCase(),text:(node.textContent||'').slice(0,10000)})});
document.addEventListener('dblclick',function(event){const node=event.target.closest('[data-design-node-id]');if(!node||node.children.length)return;event.preventDefault();node.contentEditable='true';node.focus();const range=document.createRange();range.selectNodeContents(node);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)});
document.addEventListener('focusout',function(event){const node=event.target.closest&&event.target.closest('[data-design-node-id][contenteditable=true]');if(!node)return;const selection=getSelection();send('artifact-web-text',{nodeId:node.getAttribute('data-design-node-id'),text:node.textContent||'',selection:{anchor:selection&&selection.anchorNode&&node.contains(selection.anchorNode)?selection.anchorOffset:0,focus:selection&&selection.focusNode&&node.contains(selection.focusNode)?selection.focusOffset:0,direction:selection&&selection.direction||'none'}});node.removeAttribute('contenteditable')});
document.addEventListener('keydown',function(event){if(event.key==='Escape'&&event.target.isContentEditable){event.preventDefault();event.target.blur()}});
})();</script>`;

function previewSource(document: WebDocument) {
  const styles = `<style id="studio-document-styles">${document.stylesheets.map((sheet) => sheet.media ? `@media ${sheet.media}{${sheet.code}}` : sheet.code).join("\n")}\n[data-design-node-id]{outline:2px solid transparent;outline-offset:2px}[data-design-node-id]:hover{outline-color:#8b73ef}[data-studio-selected=true]{outline:3px solid #6f52e8!important}</style>`;
  let html = document.html;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${styles}</head>`) : `${styles}${html}`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${interactionScript}</body>`) : `${html}${interactionScript}`;
}

export function WebArtifactEditor({ artifactId, document, sessionId = `web-${artifactId}`, initialScope = "shared", onChange, onAutosave }: WebArtifactEditorProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState(() => createArtifactEditSession({ sessionId, artifactId, document }));
  const [nodeId, setNodeId] = useState<string>();
  const [nodeLabel, setNodeLabel] = useState<string>();
  const [scope, setScope] = useState<ResponsiveScope>(initialScope);
  const [announcement, setAnnouncement] = useState("Web canvas ready");
  const autosavedVersion = useRef(-1);

  useEffect(() => {
    setSession(createArtifactEditSession({ sessionId, artifactId, document }));
    setNodeId(undefined);
    autosavedVersion.current = -1;
  }, [artifactId, sessionId]);

  useEffect(() => {
    if (!session.dirty || autosavedVersion.current === session.version) return;
    const timer = window.setTimeout(() => setSession((current) => {
      if (autosavedVersion.current === current.version) return current;
      const saved = markEditAutosaved(current, current.version);
      autosavedVersion.current = saved.version;
      void onAutosave?.(saved.document, saved);
      setAnnouncement("Web source autosaved");
      return saved;
    }), 750);
    return () => window.clearTimeout(timer);
  }, [onAutosave, session.dirty, session.version]);

  const commit = useCallback((label: string, operation: Parameters<typeof applyEditTransaction<WebDocument>>[1]["operations"][number]) => {
    setSession((current) => {
      const next = applyEditTransaction(current, { id: `tx-${current.version + 1}`, expectedVersion: current.version, label, boundary: operation.type === "web.text" ? "inline-edit" : "control", operations: [operation] });
      const note = next.undoStack.at(-1)?.feedback.at(-1)?.message;
      setAnnouncement(note ? `${label}. ${note}` : label);
      onChange?.(next.document, next);
      return next;
    });
  }, [onChange]);

  const undo = useCallback(() => setSession((current) => {
    if (!current.undoStack.length) return current;
    const next = undoEditTransaction(current, current.version); onChange?.(next.document, next); setAnnouncement("Undid Web edit"); return next;
  }), [onChange]);
  const redo = useCallback(() => setSession((current) => {
    if (!current.redoStack.length) return current;
    const next = redoEditTransaction(current, current.version); onChange?.(next.document, next); setAnnouncement("Redid Web edit"); return next;
  }), [onChange]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "artifact-web-selection" && typeof event.data.nodeId === "string") { setNodeId(event.data.nodeId); setNodeLabel(String(event.data.label ?? event.data.nodeId)); setAnnouncement(`Selected ${event.data.label ?? event.data.nodeId}`); }
      if (event.data?.type === "artifact-web-text" && typeof event.data.nodeId === "string" && typeof event.data.text === "string") {
        const direction = event.data.selection?.direction === "forward" || event.data.selection?.direction === "backward" ? event.data.selection.direction : "none";
        commit("Edited Web text", { type: "web.text", nodeId: event.data.nodeId, text: event.data.text, selection: { anchor: Math.min(event.data.text.length, Number(event.data.selection?.anchor) || 0), focus: Math.min(event.data.text.length, Number(event.data.selection?.focus) || 0), direction } });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [commit]);

  const source = useMemo(() => previewSource(session.document), [session.document]);
  const style = (label: string, declarations: Record<string, string | number>) => { if (nodeId) commit(label, { type: "web.style", nodeIds: [nodeId], declarations, scope }); };
  return <section className="web-artifact-editor" aria-label="Web artifact editor" onKeyDown={(event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  }}>
    <div className="artifact-edit-toolbar" role="toolbar" aria-label="Web element controls">
      <button type="button" aria-label="Undo" onClick={undo} disabled={!session.undoStack.length}>↶</button>
      <button type="button" aria-label="Redo" onClick={redo} disabled={!session.redoStack.length}>↷</button>
      <strong>{nodeLabel ?? "Select an element"}</strong>
      <label>Scope <select aria-label="Responsive edit scope" value={scope} onChange={(event) => setScope(event.target.value as ResponsiveScope)}><option value="shared">Shared composition</option><option value="desktop">Desktop only</option><option value="mobile">Mobile only</option></select></label>
      <label>Padding <input aria-label="Element padding" type="number" min="0" max="240" defaultValue="24" disabled={!nodeId} onBlur={(event) => style("Changed spacing", { padding: `${event.target.value}px` })}/></label>
      <label>Size <input aria-label="Web font size" type="number" min="8" max="256" defaultValue="24" disabled={!nodeId} onBlur={(event) => style("Changed typography", { "font-size": `${event.target.value}px` })}/></label>
      <label>Colour <input aria-label="Web text colour" type="color" defaultValue="#17161b" disabled={!nodeId} onChange={(event) => style("Changed colour", { color: event.target.value })}/></label>
      <em>{session.lastAutosavedAt ? "Autosaved" : session.dirty ? "Unsaved" : "Saved"} · {scope === "shared" ? "all breakpoints" : `${scope} only`}</em>
    </div>
    <iframe ref={iframe} title="Editable Web artifact" srcDoc={source} sandbox="allow-scripts"/>
    <div className="artifact-edit-feedback" aria-live="polite">{announcement}</div>
  </section>;
}
