import { NextResponse } from "next/server";
import { activeProjectId } from "@/server/paths";
import { acceptWebRefinementCandidate, rejectWebRefinementCandidate } from "@/server/web-candidates";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { candidateId?: unknown; action?: unknown };
    if (typeof body.candidateId !== "string") return NextResponse.json({ error: "A Web refinement candidate id is required." }, { status: 400 });
    const projectId = activeProjectId(request);
    if (body.action === "accept") return NextResponse.json(await acceptWebRefinementCandidate(projectId, body.candidateId));
    if (body.action === "reject") return NextResponse.json(await rejectWebRefinementCandidate(projectId, body.candidateId));
    return NextResponse.json({ error: "Candidate action must be accept or reject." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the Web refinement candidate.";
    const status = /stale|already/i.test(message) ? 409 : /invalid|required|integrity/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
