import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const output = path.join(root, "media", "video");
const raw = path.join(output, ".raw-bootstrap");
const workspace = path.join(raw, "workspace");
const destination = path.join(output, "codex-design-studio-bootstrap-draft.webm");
const port = 3303;
const baseURL = `http://127.0.0.1:${port}`;
const projectId = "codex-design-studio";
const npmEntrypoint = process.env.npm_execpath;
if (!npmEntrypoint) throw new Error("Run this recorder through npm so npm_execpath is available.");

const hold = (page, milliseconds = 2_000) => page.waitForTimeout(milliseconds);

async function stopServer(server) {
  if (!server.pid) return;
  if (process.platform !== "win32") {
    server.kill("SIGTERM");
    return;
  }
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
    killer.once("error", resolve);
    killer.once("exit", resolve);
  });
}

function synthesizedBootstrapSession(sessionId) {
  const now = new Date().toISOString();
  const brief = {
    id: "brief_codex-design-studio",
    version: 1,
    status: "draft",
    createdAt: now,
    createdBy: "codex",
    title: "Codex Design Studio · foundational system",
    summary: "Turn a clear product ambition and carefully reviewed public design signals into a living, editable system for every launch asset.",
    facts: [
      { id: "fact_brand", claim: "The brand is Codex Design Studio.", evidenceIds: ["intake:brand"] },
      { id: "fact_objective", claim: "The creator wants one reference to become an editable design system for launch assets.", evidenceIds: ["intake:objective"] },
      { id: "fact_reference", claim: "openai.com was supplied as a public reference for design-system signal extraction.", evidenceIds: ["bootstrap-reference-url"] }
    ],
    inferences: [
      { id: "inference_direction", claim: "The system should use restrained hierarchy, deliberate spacing and clear actions without copying source assets or copy.", evidenceIds: ["bootstrap-reference-url"], confidence: 0.82 }
    ],
    assumptions: [
      { id: "assumption_components", claim: "The final component set should be tested against the product's own workflows before release.", evidenceIds: [], status: "proposed" }
    ],
    unknowns: ["Exact launch audience and final component inventory remain open for review."],
    questions: [],
    strategy: {
      audience: "Founders and product teams",
      objective: "Create an executable, trusted visual foundation for real launch work.",
      positioning: "A local-first creative studio where an approved system drives editable Web, presentation and visual artifacts.",
      voice: "Clear, confident and quietly optimistic.",
      contentPriorities: ["One clear promise", "Visible system evidence", "A decisive next action"]
    },
    creative: {
      opportunity: "Make the design system itself visible, editable and testable rather than treating it as a static mood board.",
      designPrinciples: ["Keep hierarchy calm and explicit", "Use system rules before decoration", "Preserve evidence and human approval"],
      avoid: ["Copying reference assets or copy", "Untraceable visual claims", "Decorative complexity without purpose"]
    },
    brandSeed: {
      name: "Codex Design Studio",
      industry: "AI creative tooling",
      audience: "Founders and product teams",
      promise: "Turn one trusted direction into editable, consistent launch assets.",
      personality: ["precise", "curious", "capable"],
      tone: "Clear, confident and quietly optimistic",
      visualDirection: "Restrained editorial hierarchy, generous spacing and one purposeful accent."
    }
  };
  return {
    schemaVersion: 1,
    id: sessionId,
    status: "review",
    originalInput: {
      projectName: "Codex Design Studio",
      brandName: "Codex Design Studio",
      audience: "Founders and product teams",
      objective: "Turn one public design reference into an editable, consistent design system for every launch asset.",
      targetDeliverable: "web",
      sourceRefs: [{ id: "bootstrap-reference-url", kind: "url", label: "openai.com", intent: "extract", locator: "https://openai.com" }]
    },
    inputHash: "recording-only-bootstrap-session",
    sourceRefs: [{ id: "bootstrap-reference-url", kind: "url", label: "openai.com", intent: "extract", locator: "https://openai.com" }],
    referenceSnapshot: {
      stagingProjectId: `bootstrap-${sessionId.replace(/^bst_/, "")}`,
      status: "ready",
      effectiveIntent: "extract",
      observations: [],
      observationHash: "recording-only-reference",
      updatedAt: now
    },
    questions: [],
    answers: [],
    briefs: [brief],
    activeBriefVersion: 1,
    createdAt: now,
    updatedAt: now,
    events: [
      { id: "event_created", at: now, action: "created" },
      { id: "event_synthesized", at: now, action: "synthesis.completed" }
    ]
  };
}

function codexLandingHtml(iconDataUrl) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex Design Studio — One trusted direction. Every asset in sync.</title>
<style>
:root{--ink:#211d30;--violet:#6658d6;--lilac:#ede9ff;--acid:#d8ff72;--paper:#f8f7fc;--white:#fff;--text:#1b1824;--muted:#696476}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--text);font-family:Arial,sans-serif;line-height:1.5}.site{min-height:100vh;overflow:hidden}.nav{height:78px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(24px,6vw,92px);border-bottom:1px solid rgba(33,29,48,.1);background:rgba(248,247,252,.9)}.brand{display:flex;align-items:center;gap:11px;font-family:Georgia,serif;font-size:21px;font-weight:700}.brand img{width:30px;height:30px;border-radius:9px}.links{display:flex;gap:28px;font-size:13px;font-weight:700}.nav-cta,.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:12px 19px;background:var(--ink);color:#fff;font-weight:700;text-decoration:none}.hero{position:relative;min-height:650px;padding:92px clamp(24px,8vw,120px) 110px;display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;background:radial-gradient(circle at 87% 26%,#e7e0ff 0,transparent 25%),var(--paper)}.hero:after{content:"";position:absolute;right:-125px;bottom:-220px;width:640px;height:640px;border-radius:50%;background:radial-gradient(circle at 31% 26%,var(--acid),#a7a0ec 45%,var(--ink) 73%);filter:saturate(.92)}.hero-copy{position:relative;z-index:1;max-width:690px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--violet)}h1,h2,h3{font-family:Georgia,serif;letter-spacing:-.045em}h1{font-size:clamp(52px,6.2vw,88px);line-height:.94;margin:22px 0 25px}.subhead{max-width:590px;font-size:19px;color:var(--muted)}.actions{display:flex;align-items:center;gap:22px;margin-top:37px}.link{font-size:14px;font-weight:700;border-bottom:1px solid currentColor}.system-card{position:relative;z-index:1;justify-self:end;width:min(420px,100%);padding:28px;border:1px solid rgba(33,29,48,.15);border-radius:27px;background:rgba(255,255,255,.72);box-shadow:0 28px 70px rgba(33,29,48,.17);backdrop-filter:blur(16px)}.system-card header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}.system-card small{font-size:11px;letter-spacing:.14em;color:var(--violet);font-weight:800}.system-card strong{font-size:12px}.token-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.token{min-height:104px;padding:15px;border-radius:18px;background:var(--white);border:1px solid rgba(33,29,48,.08)}.token i{display:block;width:28px;height:28px;border-radius:50%;margin-bottom:26px}.token b{display:block;font-size:12px}.token span{font-size:11px;color:var(--muted)}.token-primary i{background:var(--ink)}.token-accent i{background:var(--acid)}.token-violet i{background:var(--violet)}.section{padding:96px clamp(24px,8vw,120px)}.intro{max-width:720px}.intro h2{font-size:clamp(39px,4.3vw,64px);line-height:1;margin:14px 0 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin-top:46px}.card{min-height:245px;padding:28px;border-radius:22px;background:#fff;border:1px solid rgba(33,29,48,.09)}.card span{font-size:12px;color:var(--violet);font-weight:800}.card h3{font-size:30px;line-height:1.02;margin:55px 0 11px}.card p{margin:0;color:var(--muted)}.proof{background:var(--ink);color:#fff}.proof .eyebrow{color:var(--acid)}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:43px}.metric{padding:28px 0;border-top:1px solid rgba(255,255,255,.3)}.metric strong{display:block;font-family:Georgia,serif;font-size:50px;color:var(--acid);letter-spacing:-.04em}.metric span{font-size:14px;color:#e0dded}.final{display:flex;align-items:center;justify-content:space-between;gap:38px}.final h2{max-width:730px;font-size:clamp(36px,4vw,59px);line-height:1;margin:0}.footer{padding:31px clamp(24px,8vw,120px);display:flex;justify-content:space-between;border-top:1px solid rgba(33,29,48,.1);font-size:13px;color:var(--muted)}[data-design-id]{outline:2px solid transparent;outline-offset:4px;transition:outline-color .15s,filter .15s}[data-design-id]:hover{outline-color:#7567e8;cursor:pointer;filter:brightness(.985)}[data-selected="true"]{outline:3px solid #7567e8!important}.selection-tag{position:fixed;z-index:9999;background:#211d30;color:#fff;border-radius:6px;padding:5px 8px;font:11px/1.2 Arial;pointer-events:none;display:none}@media(max-width:760px){.links{display:none}.hero{grid-template-columns:1fr;min-height:760px;padding-top:62px}.hero:after{width:420px;height:420px;right:-170px;bottom:-90px}.system-card{justify-self:start}.grid,.metrics{grid-template-columns:1fr}.section{padding-top:70px;padding-bottom:70px}.final{align-items:flex-start;flex-direction:column}h1{font-size:52px}.footer{flex-direction:column;gap:8px}}
</style></head><body><div class="site">
<nav class="nav" data-design-id="navigation" data-design-label="Navigation"><div class="brand"><img src="${iconDataUrl}" alt=""><span>Codex Design Studio</span></div><div class="links"><span>Studio</span><span>Design system</span><span>Workflows</span></div><a class="nav-cta">Start a project</a></nav>
<main><section class="hero" data-design-id="hero" data-design-label="Hero section"><div class="hero-copy"><div class="eyebrow" data-design-id="hero-eyebrow" data-design-label="Hero eyebrow">A local-first design workspace</div><h1 data-design-id="hero-title" data-design-label="Hero title">One trusted direction.<br>Every asset in sync.</h1><p class="subhead" data-design-id="hero-copy" data-design-label="Hero description">Create, build and edit your design system, site and presentation with Codex — with each decision traceable and ready to review.</p><div class="actions" data-design-id="hero-actions" data-design-label="Hero actions"><a class="button">Build your system</a><a class="link">See the workflow →</a></div></div><aside class="system-card" data-design-id="system-card" data-design-label="Design system snapshot"><header><small>CODEx DESIGN SYSTEM / v1.0</small><strong>✓ Synced</strong></header><div class="token-row"><div class="token token-primary"><i></i><b>Ink</b><span>#211D30</span></div><div class="token token-accent"><i></i><b>Accent</b><span>#D8FF72</span></div><div class="token token-violet"><i></i><b>Violet</b><span>#6658D6</span></div></div></aside></section>
<section class="section" data-design-id="benefits" data-design-label="Workflow benefits"><div class="intro"><div class="eyebrow">One source of truth</div><h2>From direction to every deliverable.</h2></div><div class="grid"><article class="card" data-design-id="benefit-1" data-design-label="Source-led briefs"><span>01</span><h3>Start with evidence.</h3><p>Bring a public reference, your logo and your direction into one reviewable brief.</p></article><article class="card" data-design-id="benefit-2" data-design-label="Living design system"><span>02</span><h3>Make the system real.</h3><p>Turn approved decisions into tokens, components and a usable creative foundation.</p></article><article class="card" data-design-id="benefit-3" data-design-label="Editable outputs"><span>03</span><h3>Ship connected work.</h3><p>Edit the actual site and presentation, then validate the result before you choose.</p></article></div></section>
<section class="section proof" data-design-id="proof" data-design-label="System proof"><div class="intro"><div class="eyebrow">Designed for control</div><h2>Make progress without losing the thread.</h2></div><div class="metrics"><div class="metric"><strong>1</strong><span>trusted design system</span></div><div class="metric"><strong>Web + deck</strong><span>editable, connected outputs</span></div><div class="metric"><strong>Reviewable</strong><span>every change stays visible</span></div></div></section>
<section class="section final" data-design-id="final-cta" data-design-label="Final call to action"><h2>Build a brand system that stays useful after the first launch.</h2><a class="button">Create a project</a></section></main>
<footer class="footer" data-design-id="footer" data-design-label="Footer"><strong>Codex Design Studio</strong><span>One source of truth for creative work.</span><span>© 2026</span></footer></div><div class="selection-tag"></div>
<script>const tag=document.querySelector('.selection-tag');let selected;document.addEventListener('mousemove',e=>{const el=e.target.closest('[data-design-id]');if(!el){tag.style.display='none';return}tag.textContent=el.dataset.designLabel||el.dataset.designId;tag.style.display='block';tag.style.left=(e.clientX+12)+'px';tag.style.top=(e.clientY+12)+'px'});document.addEventListener('click',e=>{const el=e.target.closest('[data-design-id]');if(!el)return;e.preventDefault();selected?.removeAttribute('data-selected');selected=el;el.dataset.selected='true';parent.postMessage({type:'design-selection',selection:{deliverableId:'web',designId:el.dataset.designId,label:el.dataset.designLabel||el.dataset.designId,domPath:el.tagName.toLowerCase()+'[data-design-id="'+el.dataset.designId+'"]',text:(el.innerText||'').trim().slice(0,500),viewport:innerWidth<600?'mobile':'desktop'}},'*')});</script></body></html>`;
}

function candidateLandingHtml(activeHtml) {
  return activeHtml
    .replace("One trusted direction.<br>Every asset in sync.", "Design with intent.<br>Ship with confidence.")
    .replace("Create, build and edit your design system, site and presentation with Codex — with each decision traceable and ready to review.", "Codex turns one approved direction into coherent, editable work — then helps you validate every change before it ships.")
    .replace("--violet:#6658d6", "--violet:#4f3fbf")
    .replace("background:radial-gradient(circle at 87% 26%,#e7e0ff 0,transparent 25%),var(--paper)", "background:radial-gradient(circle at 76% 24%,#dcd4ff 0,transparent 31%),var(--paper)");
}

function visualTarget() {
  return {
    artifactId: "web",
    artifactKind: "web",
    contextId: "landing-hero",
    role: "hero-media",
    context: { type: "web", viewport: { width: 1440, height: 900 }, crop: { width: 1024, height: 1024 }, fit: "cover" }
  };
}

function emptyVisualAssetRegistry() {
  return { schemaVersion: 1, projectId, briefs: [], versions: [], runs: [], placements: [], approvedVersionIds: {}, updatedAt: "2026-07-21T20:00:00.000Z" };
}

async function generatedVisualAssetRegistry(brandSystemVersionId) {
  const target = visualTarget();
  const now = "2026-07-21T20:10:00.000Z";
  const brief = {
    schemaVersion: 1,
    id: "vab_codex_design_studio_launch",
    title: "Codex Design Studio launch visuals",
    objective: "Create distinctive, system-bound editorial visuals for the Codex Design Studio launch.",
    audience: "Founders, product teams and creative leads",
    target,
    brandSystemVersionId,
    brandDirection: {
      personality: ["precise", "curious", "capable"],
      visualStyle: "dark editorial clarity with deliberate geometric forms",
      lighting: "soft studio light",
      composition: "purposeful negative space",
      palette: ["#211D30", "#6658D6", "#D8FF72", "#F8F7FC"],
      mustInclude: ["clear focal hierarchy", "usable negative space"],
      mustAvoid: ["logos", "generic stock imagery", "untraceable visual claims"]
    },
    prompt: "A calm, architectural brand visual for Codex Design Studio with a dark plum background, violet forms, an off-white flare and an electric-lime accent.",
    inputAssets: [],
    output: { width: 1536, height: 1536, quality: "medium", encoding: "png", background: "opaque", variants: 3, maxBytes: 8_000_000 },
    createdAt: now,
    createdBy: "codex"
  };
  const definitions = [
    { versionId: "gav_codex_studio_01", file: "codex-design-studio-asset-01.png", prompt: "A luminous four-point flare turns a modular violet composition into one clear direction.", status: "approved" },
    { versionId: "gav_codex_studio_02", file: "codex-design-studio-asset-02.png", prompt: "Layered violet modules and ceramic fragments form an editorial system study.", status: "pending" },
    { versionId: "gav_codex_studio_03", file: "codex-design-studio-asset-03.png", prompt: "A translucent violet ribbon frames a warm geometric signal and electric-lime accent.", status: "pending" }
  ];
  const versions = await Promise.all(definitions.map(async (definition) => {
    const bytes = await readFile(path.join(root, "media", "video", "brand-assets", definition.file));
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    return {
      schemaVersion: 1,
      assetId: "web-hero",
      versionId: definition.versionId,
      briefId: brief.id,
      brandSystemVersionId,
      target,
      prompt: definition.prompt,
      revisedPrompt: definition.prompt,
      inputAssets: [],
      model: { adapter: "codex-app-server", name: "OpenAI image generation" },
      output: { ...brief.output, actualWidth: 1536, actualHeight: 1536, actualBytes: bytes.byteLength, actualEncoding: "png", hasTransparency: false },
      lineage: { inputVersionIds: [], generationRunId: "mgr_codex_studio_launch" },
      contentHash,
      fileUri: `/api/visual-assets/files/${definition.versionId}.png`,
      createdAt: now,
      approval: definition.status === "approved"
        ? { status: "approved", events: [{ from: "pending", to: "approved", actor: "user", at: now, note: "Selected for the launch landing page." }], approvedAt: now, approvedBy: "user" }
        : { status: "pending", events: [] },
      validations: [
        { id: `${definition.versionId}:dimensions`, context: "web", status: "pass", message: "1536×1536 PNG fits the requested hero crop.", checkedAt: now },
        { id: `${definition.versionId}:bytes`, context: "web", status: "pass", message: "Output remains within the approved byte budget.", checkedAt: now }
      ]
    };
  }));
  return {
    schemaVersion: 1,
    projectId,
    briefs: [brief],
    versions,
    runs: [],
    placements: [{ id: "vap_codex_studio_hero", target, assetId: "web-hero", versionId: versions[0].versionId, placedAt: now, placedBy: "user" }],
    approvedVersionIds: { "web-hero": versions[0].versionId },
    updatedAt: now
  };
}

async function seedCodexDesignStudioProject() {
  const projectRoot = path.join(workspace, "projects", projectId);
  const now = "2026-07-21T20:00:00.000Z";
  const iconDataUrl = `data:image/svg+xml;base64,${(await readFile(path.join(root, "desktop", "assets", "icon.svg"))).toString("base64")}`;
  const project = {
    id: projectId,
    name: "Codex Design Studio",
    createdAt: now,
    updatedAt: now,
    version: 1,
    brand: {
      name: "Codex Design Studio",
      industry: "AI creative tooling",
      audience: "Founders, product teams and creative leads",
      promise: "Turn one trusted direction into editable, consistent launch assets.",
      personality: ["precise", "curious", "capable"],
      tone: "Clear, confident and quietly optimistic",
      visualDirection: "Dark editorial clarity, one electric accent and generous whitespace."
    },
    tokens: {
      version: "1.0.0",
      colors: { primary: "#211D30", secondary: "#6658D6", accent: "#D8FF72", background: "#F8F7FC", surface: "#FFFFFF", text: "#1B1824" },
      typography: { display: "Georgia", body: "Arial", scale: { h1: 72, h2: 44, body: 18, caption: 12 } },
      spacing: { xs: 8, sm: 16, md: 24, lg: 40, xl: 72 },
      shape: { radiusSm: 10, radiusCard: 24, radiusButton: 999 },
      media: { style: "editorial product clarity", lighting: "soft studio", composition: "purposeful negative space" },
      voice: { attributes: ["clear", "capable", "human"], forbiddenPatterns: ["generic AI imagery", "untraceable claims"] }
    },
    landing: {
      navigation: { showIcons: false, items: [{ label: "Studio", icon: "layers" }, { label: "Design system", icon: "sparkles" }, { label: "Workflows", icon: "arrow" }] },
      eyebrow: "A local-first design workspace",
      headline: "One trusted direction. Every asset in sync.",
      subhead: "Create, build and edit your design system, site and presentation with Codex.",
      primaryCta: "Build your system",
      secondaryCta: "See the workflow",
      benefits: [{ title: "Start with evidence.", body: "Bring a public reference, your logo and your direction into one reviewable brief." }, { title: "Make the system real.", body: "Turn approved decisions into tokens, components and a usable creative foundation." }, { title: "Ship connected work.", body: "Edit the actual site and presentation, then validate the result before you choose." }],
      proof: [{ value: "1", label: "trusted design system" }, { value: "Web + deck", label: "editable, connected outputs" }, { value: "Reviewable", label: "every change stays visible" }],
      finalHeadline: "Build a brand system that stays useful after the first launch."
    },
    slides: [
      { id: "slide-cover", type: "cover", eyebrow: "CODEX DESIGN STUDIO / 2026", title: "One trusted direction. Every asset in sync.", body: "A living design system for editable Web, presentation and creative outputs." },
      { id: "slide-value", type: "value", eyebrow: "THE WORKFLOW", title: "From reference to a usable creative system", bullets: ["Start from explicit intent and reviewable sources", "Build tokens and components around product needs", "Edit the real artifacts with Codex and validate each candidate"] },
      { id: "slide-metrics", type: "metrics", eyebrow: "THE OUTCOME", title: "A system that stays connected to the work", metrics: [{ value: "1", label: "source of truth" }, { value: "Web + deck", label: "editable outputs" }, { value: "Human", label: "final approval" }] }
    ],
    lastSummary: "Created from an approved public-reference brief and the Codex Design Studio icon."
  };
  const sourceGraph = {
    schemaVersion: 1,
    projectId,
    updatedAt: now,
    sources: [{
      id: "src_openai_reference",
      kind: "url",
      label: "openai.com · public reference",
      contentHash: "recording-openai-reference",
      origin: { type: "url", locator: "https://openai.com", mediaType: "text/uri-list", context: "project-bootstrap", importedAt: now },
      intent: "extract",
      role: "evidence",
      rights: { notes: "Public reference for observable design-system signals only. Source assets and copy are not reused.", confirmed: false, relationship: "third-party", permissions: { analyze: true, inspire: false, reproduceAssets: false, reproduceCopy: false, distribute: false } },
      status: "ready",
      storage: { blobPath: "sources/blobs/recording-openai-reference", byteLength: 18 },
      createdAt: now,
      updatedAt: now,
      latestRunId: "run_openai_reference"
    }],
    evidence: [],
    candidates: [],
    extractionRuns: [{ id: "run_openai_reference", sourceId: "src_openai_reference", status: "succeeded", progress: 100, phase: "public reference signals reviewed", attempt: 1, requestedAt: now, startedAt: now, finishedAt: now, candidateIds: [] }],
    audit: [{ id: "audit_openai_reference", at: now, action: "run.succeeded", sourceId: "src_openai_reference", runId: "run_openai_reference", detail: { phase: "public reference signals reviewed" } }]
  };
  await rm(path.join(projectRoot, "sources"), { recursive: true, force: true });
  await mkdir(path.join(projectRoot, "sources"), { recursive: true });
  await Promise.all([
    writeFile(path.join(projectRoot, "project.json"), `${JSON.stringify(project, null, 2)}\n`),
    writeFile(path.join(projectRoot, "brand", "brand.json"), `${JSON.stringify(project.brand, null, 2)}\n`),
    writeFile(path.join(projectRoot, "design-system", "tokens.json"), `${JSON.stringify(project.tokens, null, 2)}\n`),
    writeFile(path.join(projectRoot, "slides", "deck.json"), `${JSON.stringify(project.slides, null, 2)}\n`),
    writeFile(path.join(projectRoot, "web", "index.html"), codexLandingHtml(iconDataUrl)),
    writeFile(path.join(projectRoot, "sources", "graph.json"), `${JSON.stringify(sourceGraph, null, 2)}\n`)
  ]);
}

await rm(raw, { recursive: true, force: true });
await mkdir(workspace, { recursive: true });
await cp(path.join(root, "projects", "demo"), path.join(workspace, "projects", projectId), { recursive: true });
await seedCodexDesignStudioProject();

const server = spawn(process.execPath, [npmEntrypoint, "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    CODEX_STUDIO_DATA_DIR: workspace,
    CODEX_STUDIO_PROJECT_ID: projectId,
    NEXT_PUBLIC_CODEX_STUDIO_MODE: "fallback",
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Bootstrap demo server did not start.\n${serverLog}`);
}

let browser;
let context;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: raw, size: { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();

  await page.route("**/api/account", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ account: { type: "chatgpt", email: null, planType: "ChatGPT" }, requiresOpenaiAuth: false })
    });
  });
  await page.route(/\/api\/bootstrap\/[^/]+\/synthesize$/, async (route) => {
    const sessionId = route.request().url().match(/\/api\/bootstrap\/([^/]+)\/synthesize$/)?.[1] ?? "bst_recording";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: synthesizedBootstrapSession(sessionId) }) });
  });

  let visualAssetsReady = false;
  let visualAssetRegistry = emptyVisualAssetRegistry();
  const visualAssetFiles = new Map([
    ["gav_codex_studio_01", "codex-design-studio-asset-01.png"],
    ["gav_codex_studio_02", "codex-design-studio-asset-02.png"],
    ["gav_codex_studio_03", "codex-design-studio-asset-03.png"]
  ]);
  await page.route(/\/api\/visual-assets(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fileMatch = url.pathname.match(/\/files\/(gav_codex_studio_0[1-3])\.png$/);
    if (fileMatch) {
      const fileName = visualAssetFiles.get(fileMatch[1]);
      if (!fileName) return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: "image/png", body: await readFile(path.join(root, "media", "video", "brand-assets", fileName)) });
    }
    if (request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ registry: visualAssetsReady ? visualAssetRegistry : emptyVisualAssetRegistry(), defaultAdapter: "codex-app-server", zeroKey: true }) });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.action === "draft-brief") {
        await hold(page, 1_000);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ brief: { ...visualAssetRegistry.briefs[0], brandSystemVersionId: body.brandSystemVersionId, target: body.target, output: body.output } }) });
      }
      if (body.action === "generate") {
        await hold(page, 2_800);
        visualAssetsReady = true;
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ versions: visualAssetRegistry.versions }) });
      }
    }
    return route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ error: "Recording route does not support this visual-asset operation." }) });
  });

  await page.goto(`${baseURL}/?project=${projectId}`, { waitUntil: "networkidle" });
  await page.getByLabel("Active project").waitFor();
  await hold(page, 2_500);

  await page.getByRole("button", { name: /New project/ }).click();
  const bootstrap = page.getByRole("dialog", { name: "Create a brand workspace" });
  await bootstrap.getByLabel("Brand name").fill("Codex Design Studio");
  await bootstrap.getByLabel("Audience").fill("Founders and product teams");
  await bootstrap.getByLabel("What are you trying to achieve?").fill("Turn one public design reference into an editable, consistent design system for every launch asset.");
  await hold(page, 2_200);
  await bootstrap.getByRole("button", { name: "Continue" }).click();
  await bootstrap.getByLabel("Public reference URL").fill("https://openai.com");
  await hold(page, 3_400);
  await bootstrap.getByRole("button", { name: "Analyze context" }).click();
  await bootstrap.getByRole("heading", { name: "Review the creative brief." }).waitFor();
  await hold(page, 6_000);
  await bootstrap.getByRole("button", { name: "Continue to approval" }).click();
  await hold(page, 4_400);
  await bootstrap.getByRole("button", { name: "Close" }).click({ timeout: 90_000 });

  await page.getByRole("button", { name: "Sources" }).click();
  await page.getByText("I confirm this material may be processed").click();
  await page.locator('input[type="file"][accept="image/*,.svg"]').setInputFiles(path.join(root, "desktop", "assets", "icon.svg"));
  await page.getByText("icon.svg", { exact: true }).waitFor();
  await hold(page, 8_000);
  await page.getByRole("button", { name: "Brand" }).click();
  await hold(page, 7_000);
  await page.getByRole("button", { name: "Design system" }).click();
  await hold(page, 6_000);
  await page.getByRole("button", { name: "Save new draft" }).click();
  await page.getByRole("button", { name: "Publish draft" }).waitFor();
  await hold(page, 4_000);
  await page.getByRole("button", { name: "Publish draft" }).click();
  await page.getByText(/BrandSystem v1 published/).waitFor();
  await hold(page, 5_000);

  const brandSystems = await (await page.request.get(`${baseURL}/api/brand-systems?project=${projectId}`)).json();
  if (!brandSystems.registry?.publishedVersionId) throw new Error("The recording project did not publish a BrandSystem version.");
  visualAssetRegistry = await generatedVisualAssetRegistry(brandSystems.registry.publishedVersionId);
  await page.getByRole("button", { name: "Visual assets" }).click();
  await page.getByLabel("Visual objective").fill("Create three distinct editorial launch visuals for Codex Design Studio: dark plum, violet geometry, an off-white focal signal and one electric-lime accent.");
  await hold(page, 2_500);
  await page.getByRole("button", { name: "Generate variants" }).click();
  await page.locator(".asset-grid article").first().waitFor();
  await hold(page, 7_000);
  await page.locator(".asset-image").nth(0).click();
  await page.locator(".asset-image").nth(1).click();
  await hold(page, 4_000);

  await page.getByRole("button", { name: "Landing page" }).click();
  await hold(page, 4_000);
  await page.getByRole("button", { name: "Mobile" }).click();
  await hold(page, 5_000);
  await page.getByRole("button", { name: "Desktop" }).click();
  await hold(page, 3_500);
  await page.getByRole("button", { name: "Edit canvas" }).click();
  const editablePreview = page.frameLocator('iframe[title="Editable Web artifact"]');
  await editablePreview.locator('[data-design-node-id="hero-title"]').click();
  await page.locator(".artifact-edit-toolbar strong").filter({ hasText: "Hero title" }).waitFor();
  await hold(page, 6_000);
  await page.getByRole("button", { name: "Done editing" }).click();

  const project = await (await page.request.get(`${baseURL}/api/project?project=${projectId}`)).json();
  await page.route(/\/api\/refine\?/, async (route) => {
    await hold(page, 1_200);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        source: "codex",
        changed: true,
        summary: "Created a more distinctive editorial direction.",
        filesModified: ["web/index.html"],
        project: project.project,
        landingHtml: project.landingHtml,
        candidateHtml: candidateLandingHtml(project.landingHtml),
        candidate: {
          id: "wrc_bootstrap-video",
          summary: "Created a more distinctive editorial direction.",
          assessment: {
            reasons: ["One conservative contrast check requires human review."],
            comparisons: {
              desktop: { before: { failures: 0, inconclusive: 1 }, after: { failures: 1, inconclusive: 0 }, regressions: ["contrast"] },
              mobile: { before: { failures: 0, inconclusive: 0 }, after: { failures: 0, inconclusive: 0 }, regressions: [] }
            }
          }
        }
      })
    });
  });
  await page.route(/\/api\/refine\/candidate\?/, async (route) => {
    const body = route.request().postDataJSON();
    const acceptedProject = structuredClone(project.project);
    acceptedProject.version += 1;
    acceptedProject.landing.headline = "Design with intent. Ship with confidence.";
    acceptedProject.landing.subhead = "Codex turns one approved direction into coherent, editable work — then helps validate every change before it ships.";
    acceptedProject.lastSummary = "Accepted a Codex Web candidate after desktop and mobile QA review.";
    await hold(page, 1_100);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ project: body.action === "accept" ? acceptedProject : project.project, landingHtml: body.action === "accept" ? candidateLandingHtml(project.landingHtml) : project.landingHtml })
    });
  });
  const preview = page.frameLocator('iframe[title="Generated landing page"]');
  await preview.locator('[data-design-id="hero"]').click();
  await page.getByLabel("Refinement instruction").fill("Make the hero feel more distinctive and editorial.");
  await hold(page, 1_400);
  await page.getByLabel("Send instruction").click();
  await page.getByRole("dialog", { name: "Codex created a proposal" }).waitFor();
  await hold(page, 6_000);
  await page.getByRole("button", { name: "View original" }).click();
  await hold(page, 3_500);
  await page.getByRole("button", { name: "View candidate" }).click();
  await hold(page, 4_000);
  await page.getByRole("button", { name: "Accept with warnings" }).click();
  await page.getByRole("dialog", { name: "Codex created a proposal" }).waitFor({ state: "hidden" });
  await hold(page, 5_000);
  await page.getByRole("button", { name: "Mobile" }).click();
  await hold(page, 5_000);
  await page.getByRole("button", { name: "Desktop" }).click();
  await hold(page, 3_000);

  await page.getByRole("button", { name: "Presentation" }).click();
  await hold(page, 3_000);
  await page.getByLabel("Open slide 1").last().click();
  await hold(page, 3_500);
  await page.getByLabel("Open slide 2").last().click();
  await hold(page, 5_000);
  await page.getByLabel("Open slide 3").last().click();
  await hold(page, 4_500);
  await page.getByRole("button", { name: "Edit canvas" }).click();
  await hold(page, 4_500);
  await page.getByRole("button", { name: "Done editing" }).click();
  await hold(page, 2_000);
  await page.locator(".export-menu").hover();
  await hold(page, 5_000);

  const video = page.video();
  await page.close();
  await context.close();
  if (!video) throw new Error("Playwright did not create a bootstrap demo recording.");
  await video.saveAs(destination);
  console.log(`Recorded bootstrap demo draft at ${destination}`);
} finally {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await stopServer(server);
  await rm(raw, { recursive: true, force: true });
}
