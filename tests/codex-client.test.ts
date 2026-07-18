import { describe, expect, it } from "vitest";
import { parseStructuredOutput } from "@/server/codex-client";

describe("Codex structured output", () => {
  it("parses a single structured patch", () => {
    expect(parseStructuredOutput('{"headline":null,"summary":"No visual change."}').summary).toBe("No visual change.");
  });

  it("selects the final JSON object when App Server streams an earlier message", () => {
    const output = '{"headline":"Draft","summary":"Thinking"}\n{"headline":"Final","summary":"Propagated to web and slides."}';
    expect(parseStructuredOutput(output).headline).toBe("Final");
  });
});
