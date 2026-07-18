import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { activeProjectId, projectRoot } from "@/server/paths";
import { reviewProject } from "@/server/review";
import { loadProject } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const project = await loadProject(activeProjectId(request));
  const report = reviewProject(project);
  await writeFile(path.join(projectRoot(project.id), "reviews", "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return NextResponse.json(report);
}
