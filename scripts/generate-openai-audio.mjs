import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function usage() {
  console.error("Usage: node scripts/generate-openai-audio.mjs --input <text-file> --output <audio-file> [--voice cedar] [--format wav] [--instructions <text>]");
  process.exit(1);
}

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!flag?.startsWith("--") || value === undefined) usage();
  options[flag.slice(2)] = value;
}

if (!options.input || !options.output) usage();

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error("Refusing to send an OpenAI API key while TLS certificate verification is disabled.");
}

const script = (await readFile(options.input, "utf8")).trim();
if (!script) throw new Error("The narration input is empty.");

const voice = options.voice ?? "cedar";
const format = options.format ?? "wav";
const instructions = options.instructions ?? [
  "Read the supplied narration verbatim in clear, natural English.",
  "Use a mature, confident, masculine presentation with a warm, credible tone.",
  "Keep a measured documentary pace. Do not add an introduction, outro, or commentary."
].join(" ");

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gpt-audio-1.5",
    modalities: ["text", "audio"],
    audio: { voice, format },
    max_completion_tokens: 4096,
    messages: [
      {
        role: "developer",
        content: `${instructions} You are a voice-over renderer. Reproduce the supplied script in full, word for word. Never summarize, paraphrase, answer, or omit any part of it.`
      },
      {
        role: "user",
        content: `Read the following voice-over script exactly as written. Start immediately and add nothing before or after it.\n\n<voiceover>\n${script}\n</voiceover>`
      }
    ]
  })
});

if (!response.ok) {
  const failure = await response.json().catch(() => null);
  const message = typeof failure?.error?.message === "string" ? `: ${failure.error.message}` : "";
  throw new Error(`OpenAI audio request failed with HTTP ${response.status}${message}`);
}

const output = path.resolve(options.output);
await mkdir(path.dirname(output), { recursive: true });
const completion = await response.json();
const audioBase64 = completion.choices?.[0]?.message?.audio?.data;
const transcript = completion.choices?.[0]?.message?.audio?.transcript;
if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
  throw new Error("OpenAI returned no audio data.");
}
if (typeof transcript !== "string" || transcript.trim().length === 0) {
  throw new Error("OpenAI returned no audio transcript for verification.");
}
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
if (normalize(transcript) !== normalize(script)) {
  throw new Error("OpenAI did not reproduce the narration script verbatim.");
}
const audio = Buffer.from(audioBase64, "base64");
if (audio.length === 0) throw new Error("OpenAI returned no audio data.");
await writeFile(output, audio);
console.log(JSON.stringify({ output, voice, format, bytes: audio.length, verifiedTranscript: true }));
