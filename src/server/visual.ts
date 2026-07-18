import { spawn } from "node:child_process";
import path from "node:path";
import type { WebVisualCheckReport } from "@/domain/quality";
import { bundleRoot, safeProjectPath, safeProjectRoot } from "./paths";

function parseVisualReport(output: string): WebVisualCheckReport {
  const report = JSON.parse(output) as Partial<WebVisualCheckReport>;
  if (report.schemaVersion !== 2 || !report.renders || !report.summary || !Array.isArray(report.summary.responsiveStates)) throw new Error("Visual check returned an unsupported report schema.");
  for (const state of ["desktop", "tablet", "mobile"]) {
    const render = report.renders[state];
    if (!render || !Array.isArray(render.findings) || !render.viewport || typeof render.horizontalOverflow !== "boolean") throw new Error(`Visual check omitted the ${state} rendered audit.`);
  }
  return report as WebVisualCheckReport;
}

export async function runVisualCheck(projectId: string, phase: "before" | "after") {
  const root = await safeProjectRoot(projectId);
  const script = path.join(bundleRoot, "skills", "web-art-director", "scripts", "visual-check.mjs");
  const landing = await safeProjectPath(projectId, "web", "index.html");
  return new Promise<WebVisualCheckReport>((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--file", landing, "--phase", phase], { cwd: root, env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (operation: () => void) => { if (settled) return; settled = true; clearTimeout(timeout); operation(); };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Visual check timed out after 120 seconds.")));
    }, 120_000);
    child.stdout.on("data", (chunk) => {
      if (stdout.length >= 5_000_000) return;
      stdout += String(chunk).slice(0, 5_000_000 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length >= 500_000) return;
      stderr += String(chunk).slice(0, 500_000 - stderr.length);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) return reject(new Error(stderr.trim() || `Visual check exited with ${code}`));
        try { resolve(parseVisualReport(stdout.trim())); }
        catch { reject(new Error("Visual check returned invalid output.")); }
      });
    });
  });
}
