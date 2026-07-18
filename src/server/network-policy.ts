import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string, readonly code = "unsafe_url") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4Number(address: string) {
  return address.split(".").reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

function ipv4In(address: string, network: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask);
}

function normalizedIpv6(address: string) {
  const withoutZone = address.toLowerCase().split("%")[0];
  if (withoutZone.startsWith("::ffff:")) {
    const mapped = withoutZone.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }
  return withoutZone;
}

/** Reject addresses that are not globally routable, including documentation ranges. */
export function isPrivateOrReservedAddress(input: string) {
  const address = normalizedIpv6(input);
  const version = isIP(address);
  if (version === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([network, prefix]) => ipv4In(address, network as string, prefix as number));
  }
  if (version === 6) {
    return address.startsWith("::") || address.startsWith("fc") || address.startsWith("fd") ||
      /^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("2001:db8:");
  }
  return true;
}

export interface UrlPolicyOptions {
  allowHttp?: boolean;
  dnsTimeoutMs?: number;
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export function normalizeWebUrl(input: string, options: Pick<UrlPolicyOptions, "allowHttp"> = {}) {
  if (!input.trim() || input.length > 8_192) throw new UnsafeUrlError("The URL is empty or too long.", "invalid_url");
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new UnsafeUrlError("Enter a valid absolute URL.", "invalid_url"); }
  const protocols = options.allowHttp === false ? ["https:"] : ["https:", "http:"];
  if (!protocols.includes(url.protocol)) throw new UnsafeUrlError("Only HTTP and HTTPS URLs are supported.", "unsafe_scheme");
  if (url.username || url.password) throw new UnsafeUrlError("URLs must not contain embedded credentials.", "embedded_credentials");
  if (!url.hostname || url.hostname.endsWith(".")) url.hostname = url.hostname.replace(/\.$/, "");
  if (!url.hostname) throw new UnsafeUrlError("The URL must include a host.", "invalid_url");
  url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url;
}

export async function assertSafeWebUrl(input: string | URL, options: UrlPolicyOptions = {}) {
  const url = normalizeWebUrl(input.toString(), options);
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (/(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)) throw new UnsafeUrlError("Local network hostnames are blocked.", "private_network");
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(literal)) addresses = [{ address: literal, family: isIP(literal) }];
  else {
    const resolver = options.resolve ?? (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));
    let timeout: NodeJS.Timeout | undefined;
    try {
      addresses = await Promise.race([
        resolver(url.hostname),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("DNS lookup timed out.")), options.dnsTimeoutMs ?? 3_000); })
      ]);
    } catch { throw new UnsafeUrlError("The URL host could not be resolved.", "dns_failed"); }
    finally { if (timeout) clearTimeout(timeout); }
  }
  if (!addresses.length) throw new UnsafeUrlError("The URL host did not resolve to an address.", "dns_failed");
  if (addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
    throw new UnsafeUrlError("Private, local, and reserved network addresses are blocked.", "private_network");
  }
  return { url, addresses: [...addresses].sort((a, b) => a.address.localeCompare(b.address)) };
}
