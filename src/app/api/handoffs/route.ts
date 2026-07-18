import { NextResponse } from "next/server";
import type { HandoffBundleInput, HandoffFileRole } from "@/domain/handoff";
import { listHandoffManifests } from "@/server/ecosystem-api";
import { createHandoffBundle } from "@/server/handoff";
import { activeProjectId } from "@/server/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roles = new Set<HandoffFileRole>(["artifact-source", "code-reality-map", "screenshot", "test"]);

function failure(error: unknown, status?: number) {
  const message = error instanceof Error ? error.message : "Handoff operation failed.";
  const inferred = /not found|ENOENT/i.test(message) ? 404 : /already exists|duplicate/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message }, { status: status ?? inferred });
}

export async function GET(request: Request) {
  try {
    const listing = await listHandoffManifests(activeProjectId(request));
    return NextResponse.json({ handoffs: listing.manifests, rejected: listing.rejected });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("A JSON object is required.");
    if (typeof body.designIntent !== "string" || typeof body.implementationInstructions !== "string" || typeof body.brandSystemVersionId !== "string") {
      throw new Error("Design intent, implementation instructions and a BrandSystem version id are required.");
    }
    if (!Array.isArray(body.files) || body.files.length > 1_000) throw new Error("Handoff files must be an array of at most 1000 entries.");
    const files = body.files.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Each handoff file must be an object.");
      const file = value as Record<string, unknown>;
      if (typeof file.path !== "string" || typeof file.role !== "string" || !roles.has(file.role as HandoffFileRole)) throw new Error("Each handoff file requires a relative path and valid role.");
      if (file.name !== undefined && typeof file.name !== "string") throw new Error("Handoff file names must be strings.");
      return { path: file.path, role: file.role as HandoffFileRole, name: file.name as string | undefined };
    });
    const input: HandoffBundleInput = {
      designIntent: body.designIntent,
      implementationInstructions: body.implementationInstructions,
      brandSystemVersionId: body.brandSystemVersionId,
      files
    };
    return NextResponse.json({ handoff: await createHandoffBundle(activeProjectId(request), input) }, { status: 201 });
  } catch (error) { return failure(error); }
}
