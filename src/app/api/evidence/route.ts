import { NextResponse } from "next/server";
import type { ManualEvidenceInput } from "@/domain/sources";
import { activeProjectId } from "@/server/paths";
import { addManualEvidence, loadProvenanceGraph } from "@/server/source-store";

export const runtime = "nodejs";

const manualKinds = new Set(["color", "font", "tone", "accessibility", "rule"]);
const directives = new Set(["must-use", "must-avoid", "advisory"]);
const intents = new Set(["extract", "inspire", "extract-and-inspire"]);

export async function GET(request: Request) {
  const graph = await loadProvenanceGraph(activeProjectId(request));
  return NextResponse.json({ evidence: graph.evidence, candidates: graph.candidates });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!manualKinds.has(String(body.kind))) return NextResponse.json({ error: "Unsupported manual evidence kind." }, { status: 400 });
    if (typeof body.value !== "string" || !body.value.trim()) return NextResponse.json({ error: "Evidence value is required." }, { status: 400 });
    if (body.value.length > 5_000) return NextResponse.json({ error: "Evidence is limited to 5,000 characters." }, { status: 400 });
    const input: ManualEvidenceInput = {
      kind: body.kind as ManualEvidenceInput["kind"],
      value: body.value.trim(),
      directive: directives.has(String(body.directive)) ? body.directive as ManualEvidenceInput["directive"] : "advisory",
      intent: intents.has(String(body.intent)) ? body.intent as ManualEvidenceInput["intent"] : "extract",
      rightsNotes: typeof body.rightsNotes === "string" ? body.rightsNotes : undefined
    };
    return NextResponse.json({ evidence: await addManualEvidence(activeProjectId(request), input) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add evidence." }, { status: 400 });
  }
}
