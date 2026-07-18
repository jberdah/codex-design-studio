import { spawn } from "node:child_process";
import path from "node:path";
import type { VisualCheckReport } from "./codex-client";
import { bundleRoot, safeProjectPath, safeProjectRoot } from "./paths";

export async function runVisualCheck(projectId: string, phase: "before" | "after") {
  const root = await safeProjectRoot(projectId);
  const script = path.join(bundleRoot, "skills", "web-art-director", "scripts", "visual-check.mjs");
  const landing = await safeProjectPath(projectId, "web", "index.html");
  return new Promise<VisualCheckReport>((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--file", landing, "--phase", phase], { cwd: root, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Visual check exited with ${code}`));
      try { resolve(JSON.parse(stdout.trim()) as VisualCheckReport); }
      catch { reject(new Error("Visual check returned invalid output.")); }
    });
  });
}
