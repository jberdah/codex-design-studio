import { writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { activeProjectId, safeProjectPath } from "@/server/paths";
import { reviewProject } from "@/server/review";
import { loadProject } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const project = await loadProject(activeProjectId(request));
  const report = reviewProject(project);
  await writeFile(await safeProjectPath(project.id, "reviews", "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return NextResponse.json(report);
}
