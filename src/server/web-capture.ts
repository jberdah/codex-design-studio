import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import type { Browser, Page, Response } from "playwright";
import { bundleRoot } from "./paths";
import {
  DEFAULT_CAPTURE_LIMITS,
  DEFAULT_CAPTURE_VIEWPORTS,
  type CaptureArtifact,
  type CaptureLimits,
  type CaptureManifest,
  type CaptureViewport,
  type CapturedAsset,
  type ExtractionIssue,
  type PageObservation
} from "@/domain/extraction";
import { assertSafeWebUrl, type UrlPolicyOptions } from "./network-policy";

// Playwright ships in the desktop runtime bundle (studio-runtime), not in the
// traced Next server output, so it must be resolved from the bundle root at
// runtime — mirroring how the spawned skill scripts already find it. In source
// checkouts the bundle root is the repository, so this is the same module.
const requireFromBundle = createRequire(path.join(bundleRoot, "package.json"));
const { chromium } = requireFromBundle("playwright") as typeof import("playwright");

export interface CaptureOptions {
  browser?: Browser;
  limits?: Partial<CaptureLimits>;
  viewports?: readonly CaptureViewport[];
  networkPolicy?: UrlPolicyOptions;
  clock?: () => Date;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function redirectCount(response: Response | null) {
  let count = 0;
  let request = response?.request().redirectedFrom();
  while (request) { count += 1; request = request.redirectedFrom(); }
  return count;
}

function boundedUtf8(value: string, maxBytes: number) {
  const bytes = Buffer.from(value);
  return bytes.byteLength <= maxBytes ? value : bytes.subarray(0, maxBytes).toString("utf8");
}

export function isCaptureMethodAllowed(method: string) {
  return method === "GET" || method === "HEAD";
}

interface PinnedResponse { status: number; headers: Record<string, string>; body: Buffer; }

/** Keeps every request pinned to the address that passed the SSRF policy check. */
export function pinnedLookup(address: string): LookupFunction {
  const family = address.includes(":") ? 6 : 4;
  return (_hostname, options, callback) => {
    // Node asks custom resolvers for an array when `all` is enabled. Returning
    // the scalar callback shape in that case leaves the selected IP undefined.
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

async function fetchPinned(url: URL, address: string, method: string, headers: Record<string, string>, postData: Buffer | null, maxBytes: number, timeoutMs: number): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method, headers: { ...headers, host: url.host, "accept-encoding": "identity", connection: "close" },
      lookup: pinnedLookup(address),
      ...(url.protocol === "https:" ? { servername: url.hostname } : {})
    }, (response) => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) response.destroy(new Error("Asset exceeded the per-asset byte limit."));
        else chunks.push(chunk);
      });
      response.on("end", () => {
        const normalizedHeaders = Object.fromEntries(Object.entries(response.headers).flatMap(([name, value]) => value === undefined || ["connection", "transfer-encoding", "content-length"].includes(name) ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]]));
        resolve({ status: response.statusCode ?? 502, headers: normalizedHeaders, body: Buffer.concat(chunks) });
      });
      response.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Network request timed out.")));
    request.on("error", reject);
    if (postData) request.write(postData);
    request.end();
  });
}

async function observePage(page: Page): Promise<PageObservation> {
  return page.evaluate(() => {
    const normalized = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 500);
    const pathFor = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && parts.length < 8) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? `#${CSS.escape(current.id)}` : "";
        const parent: Element | null = current.parentElement;
        const siblings = parent ? [...parent.children].filter((child) => child.tagName === current!.tagName) : [];
        const position = !id && siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
        parts.unshift(`${tag}${id}${position}`);
        if (id) break;
        current = parent;
      }
      return parts.join(" > ");
    };
    const assetUrls = (element: Element, style: CSSStyleDeclaration) => {
      const urls: string[] = [];
      if (element instanceof HTMLImageElement && element.currentSrc) urls.push(element.currentSrc);
      if (element instanceof HTMLSourceElement && element.src) urls.push(element.src);
      for (const match of style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        try { urls.push(new URL(match[1], document.baseURI).toString()); } catch { /* invalid CSS URL */ }
      }
      return [...new Set(urls)].sort().slice(0, 20);
    };
    const candidates = [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0) return false;
      return /^(H[1-6]|P|A|BUTTON|IMG|SVG|HEADER|NAV|MAIN|SECTION|ARTICLE|FOOTER|LI|INPUT)$/.test(element.tagName) ||
        style.display.includes("grid") || style.display.includes("flex") || parseFloat(style.borderRadius) > 0;
    }).slice(0, 1200);
    const elements = candidates.map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") ?? "",
        text: normalized(element.textContent ?? ""),
        path: pathFor(element),
        colors: [...new Set([style.color, style.backgroundColor, style.borderTopColor].filter((color) => color && color !== "rgba(0, 0, 0, 0)") )].sort(),
        fontFamily: normalized(style.fontFamily), fontSize: style.fontSize, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, margin: style.margin,
        padding: style.padding, gap: style.gap, borderRadius: style.borderRadius, display: style.display,
        gridTemplateColumns: style.gridTemplateColumns, width: Math.round(box.width), height: Math.round(box.height),
        assetUrls: assetUrls(element, style)
      };
    });
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVariables = Object.fromEntries([...rootStyle].filter((name) => name.startsWith("--")).sort().slice(0, 500).map((name) => [name, normalized(rootStyle.getPropertyValue(name))]));
    const logos = [...document.querySelectorAll('img,svg,a,[class*="logo" i],[id*="logo" i]')].filter((element) => {
      const description = `${element.getAttribute("class") ?? ""} ${element.id} ${element.getAttribute("alt") ?? ""} ${element.getAttribute("aria-label") ?? ""}`;
      return /logo|brand/i.test(description);
    }).slice(0, 50).map((element) => {
      const box = element.getBoundingClientRect();
      return {
        path: pathFor(element),
        url: element instanceof HTMLImageElement ? element.currentSrc : undefined,
        text: normalized(element.getAttribute("alt") ?? element.getAttribute("aria-label") ?? element.textContent ?? "") || undefined,
        width: Math.round(box.width), height: Math.round(box.height)
      };
    }).sort((a, b) => a.path.localeCompare(b.path));
    return { title: normalized(document.title), lang: document.documentElement.lang, cssVariables, elements, logos };
  });
}

async function captureViewport(browser: Browser, requestedUrl: URL, viewport: CaptureViewport, limits: CaptureLimits, policy: UrlPolicyOptions, clock: () => Date): Promise<CaptureArtifact> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile, serviceWorkers: "block", acceptDownloads: false, javaScriptEnabled: true,
    permissions: [], locale: "en-US", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce"
  });
  const page = await context.newPage();
  const issues: ExtractionIssue[] = [];
  const assets: CapturedAsset[] = [];
  let requests = 0;
  let totalBytes = 0;
  let budgetError: Error | undefined;
  page.on("download", (download) => { void download.cancel(); issues.push({ code: "download_blocked", message: "A page download was blocked.", recoverable: true }); });
  page.on("popup", (popup) => { void popup.close(); issues.push({ code: "popup_blocked", message: "A page popup was blocked.", recoverable: true }); });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const browserRequest = route.request();
    const url = browserRequest.url();
    if (!/^https?:/i.test(url)) return route.abort("blockedbyclient");
    if (!isCaptureMethodAllowed(browserRequest.method())) {
      issues.push({ code: "method_blocked", message: `The ${browserRequest.method()} request method was blocked during read-only capture.`, recoverable: true, provenance: url.slice(0, 2_000) });
      if (browserRequest.isNavigationRequest()) budgetError ??= new Error("A state-changing navigation request was blocked during read-only capture.");
      return route.fulfill({ status: 405, headers: { allow: "GET, HEAD" }, body: "Only read-only requests are allowed during capture." });
    }
    let redirects = 0;
    let redirectedFrom = route.request().redirectedFrom();
    while (redirectedFrom) { redirects += 1; redirectedFrom = redirectedFrom.redirectedFrom(); }
    if (redirects > limits.maxRedirects) {
      budgetError ??= new Error(`Capture exceeded the ${limits.maxRedirects} redirect limit.`);
      return route.abort("blockedbyclient");
    }
    requests += 1;
    if (requests > limits.maxRequests) {
      issues.push({ code: "request_limit", message: `Capture exceeded the ${limits.maxRequests} request limit.`, recoverable: true, provenance: url.slice(0, 2_000) });
      if (browserRequest.isNavigationRequest()) budgetError ??= new Error(`Capture exceeded the ${limits.maxRequests} request limit.`);
      return route.fulfill({ status: 429, body: "Capture request limit reached." });
    }
    try {
      const safe = await assertSafeWebUrl(url, policy);
      const response = await fetchPinned(safe.url, safe.addresses[0].address, browserRequest.method(), browserRequest.headers(), browserRequest.postDataBuffer(), limits.maxAssetBytes, limits.navigationTimeoutMs);
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        issues.push({ code: "encoded_response_blocked", message: "A server ignored the identity encoding request; the compressed response was blocked.", recoverable: true, provenance: url.slice(0, 2_000) });
        if (browserRequest.isNavigationRequest()) budgetError ??= new Error("The navigation response used an unsafe content encoding.");
        return route.fulfill({ status: 415, body: "Encoded responses are blocked during bounded capture." });
      }
      if (/\battachment\b/i.test(response.headers["content-disposition"] ?? "")) {
        issues.push({ code: "download_blocked", message: "An attachment response was blocked.", recoverable: true, provenance: url.slice(0, 2_000) });
        return route.fulfill({ status: 403, body: "Downloads are blocked during capture." });
      }
      if (totalBytes + response.body.byteLength > limits.maxTotalBytes) {
        issues.push({ code: "capture_size_limit", message: "Capture exceeded its total byte limit.", recoverable: true, provenance: url.slice(0, 2_000) });
        if (browserRequest.isNavigationRequest()) budgetError ??= new Error("Capture exceeded its total byte limit.");
        return route.fulfill({ status: 413, body: "Capture byte limit reached." });
      }
      totalBytes += response.body.byteLength;
      assets.push({ url: safe.url.toString(), mediaType: response.headers["content-type"]?.split(";")[0] ?? "application/octet-stream", byteLength: response.body.byteLength, sha256: sha256(response.body), body: response.body });
      await route.fulfill({ status: response.status, headers: response.headers, body: response.body });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "An unsafe request was blocked.";
      issues.push({ code: "request_blocked", message, recoverable: true, provenance: url.slice(0, 2_000) });
      if (browserRequest.isNavigationRequest()) budgetError ??= new Error(message);
      await route.fulfill({ status: 502, body: "Request blocked by capture policy." });
    }
  });
  try {
    const response = await page.goto(requestedUrl.toString(), { waitUntil: "domcontentloaded", timeout: limits.navigationTimeoutMs });
    if (redirectCount(response) > limits.maxRedirects) throw new Error(`Capture exceeded the ${limits.maxRedirects} redirect limit.`);
    const final = await assertSafeWebUrl(page.url(), policy);
    if (budgetError) throw budgetError;
    const dom = boundedUtf8(await page.content(), limits.maxDomBytes);
    const pageSize = await page.evaluate(() => ({ width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0), height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) }));
    const fullPage = pageSize.width * pageSize.height * 4 <= limits.maxScreenshotBytes;
    if (!fullPage) issues.push({ code: "screenshot_truncated", message: "The page was too large for a bounded full-page screenshot; the viewport was captured.", recoverable: true });
    const screenshot = await page.screenshot({ fullPage, animations: "disabled", timeout: limits.navigationTimeoutMs });
    if (screenshot.byteLength > limits.maxScreenshotBytes) throw new Error("Screenshot exceeded the capture limit.");
    const observation = await observePage(page);
    return {
      viewport, finalUrl: final.url.toString(), capturedAt: clock().toISOString(), screenshot, dom,
      assets: assets.sort((a, b) => a.url.localeCompare(b.url) || a.sha256.localeCompare(b.sha256)), observation,
      issues: issues.sort((a, b) => `${a.code}:${a.provenance ?? ""}`.localeCompare(`${b.code}:${b.provenance ?? ""}`))
    };
  } finally {
    await context.close();
  }
}

export async function captureReferencePage(input: string, options: CaptureOptions = {}): Promise<CaptureManifest> {
  const policy = options.networkPolicy ?? {};
  const requested = await assertSafeWebUrl(input, policy);
  const limits = { ...DEFAULT_CAPTURE_LIMITS, ...options.limits };
  const viewports = options.viewports ?? DEFAULT_CAPTURE_VIEWPORTS;
  const clock = options.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const browser = options.browser ?? await chromium.launch({ headless: true, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
  try {
    const captures: CaptureArtifact[] = [];
    for (const viewport of viewports) captures.push(await captureViewport(browser, requested.url, viewport, limits, policy, clock));
    return { schemaVersion: 1, requestedUrl: requested.url.toString(), startedAt, finishedAt: clock().toISOString(), captures };
  } finally {
    if (!options.browser) await browser.close();
  }
}

export function captureFileName(artifact: CaptureArtifact, extension: "png" | "html" | "json") {
  const content = extension === "png" ? artifact.screenshot : extension === "html" ? artifact.dom : JSON.stringify(artifact.observation);
  return `${artifact.viewport.name}-${sha256(content).slice(0, 16)}.${extension}`;
}
