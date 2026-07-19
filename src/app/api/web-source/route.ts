import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/http";
import { activeProjectId } from "@/server/paths";
import { activateCustomLanding } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEB_SOURCE_BYTES = 2 * 1024 * 1024;

function retainsPreviewInstrumentation(html: string) {
  return html.includes("data-design-id=") && html.includes("design-selection") && html.includes("parent.postMessage");
}

export async function POST(request: Request) {
  const body = await readJsonBody<{ html?: unknown; expectedProjectVersion?: unknown; expectedSourceHash?: unknown; summary?: unknown }>(request);
  if (!body || typeof body.html !== "string" || !body.html.trim()) return NextResponse.json({ error: "The edited Web source is required." }, { status: 400 });
  if (new TextEncoder().encode(body.html).byteLength > MAX_WEB_SOURCE_BYTES) return NextResponse.json({ error: "The Web source exceeds the 2 MB safety limit." }, { status: 400 });
  if (!Number.isInteger(body.expectedProjectVersion) || (body.expectedProjectVersion as number) < 0) return NextResponse.json({ error: "An integer expectedProjectVersion is required." }, { status: 400 });
  if (typeof body.expectedSourceHash !== "string" || !/^[0-9a-f]{64}$/i.test(body.expectedSourceHash)) return NextResponse.json({ error: "The current source hash is required." }, { status: 400 });
  if (!retainsPreviewInstrumentation(body.html)) return NextResponse.json({ error: "The edit removed required preview instrumentation; the original artifact was preserved." }, { status: 422 });
  try {
    const project = await activateCustomLanding(activeProjectId(request), {
      expectedProjectVersion: body.expectedProjectVersion as number,
      expectedSourceHash: body.expectedSourceHash,
      html: body.html,
      summary: typeof body.summary === "string" && body.summary.trim() ? body.summary.slice(0, 300) : "Applied a direct canvas edit to the Web composition."
    });
    return NextResponse.json({ project, landingHtml: body.html });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the Web edit.";
    return NextResponse.json({ error: message }, { status: /stale/i.test(message) ? 409 : 400 });
  }
}
