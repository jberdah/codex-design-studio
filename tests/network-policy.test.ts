import { describe, expect, it } from "vitest";
import { assertSafeWebUrl, isPrivateOrReservedAddress, normalizeWebUrl, UnsafeUrlError } from "@/server/network-policy";

describe("capture network policy", () => {
  it("normalizes safe web URLs without fragments or default ports", () => {
    expect(normalizeWebUrl(" HTTPS://Example.COM:443/path?q=1#section ").toString()).toBe("https://example.com/path?q=1");
    expect(() => normalizeWebUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => normalizeWebUrl("https://user:secret@example.com")).toThrow(/credentials/);
    expect(() => normalizeWebUrl("http://example.com", { allowHttp: false })).toThrow(/HTTP and HTTPS/);
  });

  it.each(["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.31.0.2", "192.168.1.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])("blocks non-public address %s", (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it("rejects DNS answers if any address can reach a private network", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
    await expect(assertSafeWebUrl("https://example.com", { resolve })).rejects.toMatchObject({ code: "private_network" });
  });

  it("rejects local hostnames before resolution", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(assertSafeWebUrl("http://metadata.google.internal/", { resolve })).rejects.toMatchObject({ code: "private_network" });
  });

  it("returns a stable sorted public DNS set", async () => {
    const resolve = async () => [{ address: "2606:4700:4700::1111", family: 6 }, { address: "93.184.216.34", family: 4 }];
    await expect(assertSafeWebUrl("https://example.com", { resolve })).resolves.toMatchObject({ addresses: [{ address: "2606:4700:4700::1111" }, { address: "93.184.216.34" }] });
  });
});
