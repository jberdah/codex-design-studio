import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  const body = await request.json() as { name?: unknown; brandName?: unknown; industry?: unknown; audience?: unknown; promise?: unknown };
  const fields = [body.brandName, body.industry, body.audience, body.promise];
  if (fields.some((field) => typeof field !== "string" || !field.trim())) return NextResponse.json({ error: "Brand name, industry, audience and promise are required." }, { status: 400 });
  if (fields.some((field) => String(field).length > 300) || (typeof body.name === "string" && body.name.length > 100)) return NextResponse.json({ error: "One or more project fields are too long." }, { status: 400 });
  const project = await createProject({ name: typeof body.name === "string" ? body.name : undefined, brandName: String(body.brandName), industry: String(body.industry), audience: String(body.audience), promise: String(body.promise) });
  return NextResponse.json({ project }, { status: 201 });
}
