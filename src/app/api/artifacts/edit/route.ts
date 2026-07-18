import { NextResponse } from "next/server";
import type { EditTransactionInput } from "@/domain/editing";
import { activeProjectId } from "@/server/paths";
import {
  applyStoredEditTransaction,
  autosaveStoredEdit,
  commitStoredEdit,
  loadEditSession,
  redoStoredEdit,
  startEditSession,
  undoStoredEdit
} from "@/server/edit-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conflict(error: unknown) {
  const message = error instanceof Error ? error.message : "Artifact edit failed.";
  const status = /version conflict/i.test(message) ? 409 : /not found|ENOENT/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("session");
    if (!sessionId) return NextResponse.json({ error: "A session id is required." }, { status: 400 });
    return NextResponse.json(await loadEditSession(activeProjectId(request), sessionId));
  } catch (error) { return conflict(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { artifactId?: unknown; baseArtifactVersionId?: unknown; sessionId?: unknown };
    if (typeof body.artifactId !== "string" || typeof body.baseArtifactVersionId !== "string") return NextResponse.json({ error: "Artifact and base version ids are required." }, { status: 400 });
    return NextResponse.json(await startEditSession(activeProjectId(request), { artifactId: body.artifactId, baseArtifactVersionId: body.baseArtifactVersionId, sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined }), { status: 201 });
  } catch (error) { return conflict(error); }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; sessionId?: unknown; expectedVersion?: unknown; transaction?: EditTransactionInput; requestId?: unknown };
    if (typeof body.sessionId !== "string" || !Number.isInteger(body.expectedVersion)) return NextResponse.json({ error: "Session id and integer expectedVersion are required." }, { status: 400 });
    const projectId = activeProjectId(request);
    const expectedVersion = body.expectedVersion as number;
    if (body.action === "apply" && body.transaction) return NextResponse.json(await applyStoredEditTransaction(projectId, body.sessionId, { ...body.transaction, expectedVersion }));
    if (body.action === "undo") return NextResponse.json(await undoStoredEdit(projectId, body.sessionId, expectedVersion));
    if (body.action === "redo") return NextResponse.json(await redoStoredEdit(projectId, body.sessionId, expectedVersion));
    if (body.action === "autosave") return NextResponse.json(await autosaveStoredEdit(projectId, body.sessionId, expectedVersion));
    if (body.action === "commit") return NextResponse.json(await commitStoredEdit(projectId, body.sessionId, expectedVersion, typeof body.requestId === "string" ? body.requestId : undefined));
    return NextResponse.json({ error: "Use apply, undo, redo, autosave, or commit." }, { status: 400 });
  } catch (error) { return conflict(error); }
}
