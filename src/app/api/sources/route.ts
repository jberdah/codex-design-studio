import { NextResponse } from "next/server";
import type { SourceIntent, SourceKind } from "@/domain/sources";
import { activeProjectId } from "@/server/paths";
import { addSource, loadProvenanceGraph } from "@/server/source-store";
import { assertSafeWebUrl } from "@/server/network-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceKinds = new Set<SourceKind>(["url", "codebase", "logo", "image", "screenshot", "document", "deck", "spreadsheet", "manual"]);
const intents = new Set<SourceIntent>(["extract", "inspire", "extract-and-inspire"]);
const maxSourceBytes = 100 * 1024 * 1024;

function inferredKind(file: File): SourceKind {
  const name = file.name.toLowerCase();
  if (/logo/.test(name)) return "logo";
  if (/screenshot|screen[-_ ]?shot/.test(name)) return "screenshot";
  if (/\.(pptx?|key|odp)$/.test(name)) return "deck";
  if (/\.(xlsx?|csv|numbers|ods)$/.test(name)) return "spreadsheet";
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(name) || file.type.startsWith("image/")) return "image";
  if (/\.(zip|tar|gz|tgz)$/.test(name)) return "codebase";
  return "document";
}

export async function GET(request: Request) {
  return NextResponse.json({ graph: await loadProvenanceGraph(activeProjectId(request)) });
}

export async function POST(request: Request) {
  const projectId = activeProjectId(request);
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const declaredLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxSourceBytes + 1024 * 1024) {
        return NextResponse.json({ error: "Sources are limited to 100 MB each." }, { status: 413 });
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to add." }, { status: 400 });
      if (file.size > maxSourceBytes) return NextResponse.json({ error: "Sources are limited to 100 MB each." }, { status: 413 });
      const requestedKind = String(form.get("kind") ?? "");
      const requestedIntent = String(form.get("intent") ?? "extract");
      const result = await addSource(projectId, {
        kind: sourceKinds.has(requestedKind as SourceKind) ? requestedKind as SourceKind : inferredKind(file),
        label: String(form.get("label") ?? file.name),
        content: new Uint8Array(await file.arrayBuffer()),
        origin: { type: "upload", fileName: file.name, mediaType: file.type || "application/octet-stream" },
        intent: intents.has(requestedIntent as SourceIntent) ? requestedIntent as SourceIntent : "extract",
        rightsNotes: String(form.get("rightsNotes") ?? ""),
        rightsConfirmed: form.get("rightsConfirmed") === "true"
      });
      return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
    }

    const body = await request.json() as { url?: unknown; label?: unknown; intent?: unknown; rightsNotes?: unknown; rightsConfirmed?: unknown };
    if (typeof body.url !== "string") return NextResponse.json({ error: "A URL is required." }, { status: 400 });
    if (body.url.length > 8_192) return NextResponse.json({ error: "The source URL is too long." }, { status: 400 });
    let url: URL;
    try { url = (await assertSafeWebUrl(body.url)).url; } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Enter a safe URL." }, { status: 400 }); }
    const canonical = url.toString();
    const intent = intents.has(body.intent as SourceIntent) ? body.intent as SourceIntent : "extract";
    const result = await addSource(projectId, {
      kind: "url",
      label: typeof body.label === "string" && body.label.trim() ? body.label : url.hostname,
      content: Buffer.from(canonical),
      origin: { type: "url", locator: canonical, mediaType: "text/uri-list" },
      intent,
      rightsNotes: typeof body.rightsNotes === "string" ? body.rightsNotes : "",
      rightsConfirmed: body.rightsConfirmed === true
    });
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add source." }, { status: 400 });
  }
}
