import { NextResponse } from "next/server";
import type { ReconciliationAction } from "@/domain/brand-system";
import { activeProjectId } from "@/server/paths";
import { reconcileProjectEvidence, recordReconciliationDecision } from "@/server/brand-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({ reconciliation: await reconcileProjectEvidence(activeProjectId(request)) });
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const actions = new Set<ReconciliationAction>(["accept", "override", "reject", "inspiration"]);
    if (typeof body.groupId !== "string" || !actions.has(body.action as ReconciliationAction)) return NextResponse.json({ error: "A valid group and reconciliation action are required." }, { status: 400 });
    const reconciliation = await recordReconciliationDecision(activeProjectId(request), {
      groupId: body.groupId,
      action: body.action as ReconciliationAction,
      optionId: typeof body.optionId === "string" ? body.optionId : undefined,
      overrideValue: body.overrideValue,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 1_000) : undefined
    });
    return NextResponse.json({ reconciliation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record the reconciliation decision." }, { status: 400 });
  }
}

