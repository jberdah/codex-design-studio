import { NextResponse } from "next/server";
import { BackgroundQueue } from "@/server/background-queue";
import { publicBackgroundJob } from "@/server/ecosystem-api";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown, status?: number) {
  const message = error instanceof Error ? error.message : "Background job operation failed.";
  const inferred = /not found/i.test(message) ? 404 : /Only failed or cancelled/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status: status ?? inferred });
}

export async function GET(request: Request) {
  try {
    const projectId = activeProjectId(request);
    const jobs = await new BackgroundQueue(projectId).list();
    return NextResponse.json({ jobs: jobs.map(publicBackgroundJob), enqueueSupported: false });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.jobId !== "string") throw new Error("A job id is required.");
    const queue = new BackgroundQueue(activeProjectId(request));
    if (body.action === "cancel") return NextResponse.json({ job: publicBackgroundJob(await queue.cancel(body.jobId)) });
    if (body.action === "retry") return NextResponse.json({ job: publicBackgroundJob(await queue.retry(body.jobId)) });
    return failure(new Error("Only cancel and retry actions are available. Enqueue requires a registered server handler."), 400);
  } catch (error) { return failure(error); }
}
