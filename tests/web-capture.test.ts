import { describe, expect, it } from "vitest";
import { isCaptureMethodAllowed } from "@/server/web-capture";

describe("read-only web capture", () => {
  it("allows only idempotent retrieval methods", () => {
    expect(isCaptureMethodAllowed("GET")).toBe(true);
    expect(isCaptureMethodAllowed("HEAD")).toBe(true);
    expect(isCaptureMethodAllowed("POST")).toBe(false);
    expect(isCaptureMethodAllowed("PUT")).toBe(false);
    expect(isCaptureMethodAllowed("PATCH")).toBe(false);
    expect(isCaptureMethodAllowed("DELETE")).toBe(false);
  });
});
