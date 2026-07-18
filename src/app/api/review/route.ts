import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { projectRoot } from "@/server/paths";
import { reviewProject } from "@/server/review";
import { loadProject } from "@/server/store";

export const runtime = "nodejs";

export async function POST() {
  const project = await loadProject();
  const report = reviewProject(project);
  await writeFile(path.join(projectRoot(project.id), "reviews", "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return NextResponse.json(report);
}
