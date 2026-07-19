import { describe, expect, it } from "vitest";
import { isCaptureMethodAllowed, pinnedLookup } from "@/server/web-capture";

describe("read-only web capture", () => {
  it("allows only idempotent retrieval methods", () => {
    expect(isCaptureMethodAllowed("GET")).toBe(true);
    expect(isCaptureMethodAllowed("HEAD")).toBe(true);
    expect(isCaptureMethodAllowed("POST")).toBe(false);
    expect(isCaptureMethodAllowed("PUT")).toBe(false);
    expect(isCaptureMethodAllowed("PATCH")).toBe(false);
    expect(isCaptureMethodAllowed("DELETE")).toBe(false);
  });

  it("returns the DNS shape requested by Node while retaining the policy-approved address", async () => {
    const lookup = pinnedLookup("93.184.216.34");
    await expect(new Promise((resolve, reject) => lookup("example.com", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses))))
      .resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(new Promise((resolve, reject) => lookup("example.com", {}, (error, address, family) => error ? reject(error) : resolve({ address, family }))))
      .resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });
});
