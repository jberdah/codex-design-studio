const baseUrl = process.env.CODEX_STUDIO_URL ?? "http://127.0.0.1:3000";

async function refine(instruction) {
  const response = await fetch(`${baseUrl}/api/refine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction, mode: "codex" })
  });
  const result = await response.json();
  if (!response.ok || result.source !== "codex" || !result.project?.threadId) throw new Error(JSON.stringify(result));
  return result;
}

try {
  const first = await refine("Make the hero more concise while preserving the brand voice");
  const second = await refine("Now make the shared direction slightly warmer");
  if (first.project.threadId !== second.project.threadId) throw new Error("The Codex thread was not resumed.");
  console.log(JSON.stringify({ source: second.source, threadId: second.project.threadId, resumed: true, summary: second.summary }, null, 2));
} finally {
  await fetch(`${baseUrl}/api/project/reset`, { method: "POST" });
}
