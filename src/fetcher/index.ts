/**
 * Fetcher - retrieves raw HTML from a URL using the native fetch API (Node 18+).
 *
 * Supports proxy rotation and User-Agent rotation via WatchConfig.
 * When proxies are provided, uses undici ProxyAgent for per-request proxy selection.
 * Automatic retry with exponential backoff via `retries` and `retryDelay` options.
 */

import type { WatchConfig } from "../models.js";

const DEFAULT_USER_AGENTS: readonly string[] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; WatchDiff/0.2; +https://github.com/watchdiff/watchdiff)",
];

const FALLBACK_UA = "Mozilla/5.0 (compatible; WatchDiff/0.2)";

const BASE_HEADERS: Record<string, string> = {
    Accept:            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
};

export class FetchError extends Error {
    /** Retry-After header value (seconds or HTTP-date), set on 429/503 responses. */
    public retryAfter?: string;

    constructor(
        message: string,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = "FetchError";
    }
}

// ---------------------------------------------------------------------------
// H-1: SSRF guard
// ---------------------------------------------------------------------------

export function assertSafeUrl(url: string): void {
    let parsed: URL;
    try { parsed = new URL(url); } catch {
        throw new Error(`watchdiff: invalid URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`watchdiff: only http/https URLs are allowed, got: ${parsed.protocol}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        throw new Error(`watchdiff: URL points to a loopback address: ${hostname}`);
    }
    // Block link-local (AWS metadata, etc.)
    if (hostname === "169.254.169.254" || hostname.startsWith("169.254.")) {
        throw new Error(`watchdiff: URL points to a link-local address: ${hostname}`);
    }
    // Block private IPv4 ranges (basic check)
    const privateRanges = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
    if (privateRanges.some(r => r.test(hostname))) {
        throw new Error(`watchdiff: URL points to a private network address: ${hostname}`);
    }
}

// ---------------------------------------------------------------------------
// M-4: Manual redirect following with hop limit and SSRF check on each hop
// ---------------------------------------------------------------------------

async function followRedirects(
    url: string,
    init: RequestInit,
    config: WatchConfig,
    maxHops = 10
): Promise<Response> {
    let currentUrl = url;
    for (let hop = 0; hop < maxHops; hop++) {
        const resp = await globalThis.fetch(currentUrl, { ...init, redirect: "manual" });
        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get("location");
            if (!location) return resp;
            const nextUrl = new URL(location, currentUrl).toString();
            if (!config.allowPrivateUrls) assertSafeUrl(nextUrl);
            currentUrl = nextUrl;
            continue;
        }
        return resp;
    }
    throw new FetchError(`Too many redirects (max ${maxHops}) for ${url}`);
}

export class Fetcher {
    async fetch(config: WatchConfig): Promise<string> {
        const result = await this.fetchWithHeaders(config);
        return result.html;
    }

    async fetchWithHeaders(config: WatchConfig): Promise<{ html: string; headers: Record<string, string> }> {
        const maxAttempts   = 1 + (config.retries ?? 0);
        const baseDelay     = config.retryDelay ?? 1_000;
        let lastErr: FetchError | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.attemptFetchWithHeaders(config);
            } catch (err) {
                lastErr = err instanceof FetchError ? err : new FetchError(String(err));

                const isLast    = attempt === maxAttempts;
                const retryable = !lastErr.statusCode || lastErr.statusCode >= 500 || lastErr.statusCode === 429;

                if (isLast || !retryable) throw lastErr;

                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), config.maxRetryDelay ?? Infinity);
                await sleep(delay);
            }
        }

        throw lastErr!;
    }

    private async attemptFetchWithHeaders(config: WatchConfig): Promise<{ html: string; headers: Record<string, string> }> {
        // H-1: SSRF guard on the target URL
        if (!config.allowPrivateUrls) assertSafeUrl(config.url);

        const userAgent  = pickRandom(config.userAgents ?? []) ?? pickRandom([...DEFAULT_USER_AGENTS]) ?? FALLBACK_UA;
        const reqHeaders: Record<string, string> = { ...BASE_HEADERS, "User-Agent": userAgent, ...config.headers };
        if (config.cookies && Object.keys(config.cookies).length > 0) {
            // M-2: Encode cookie values to prevent header injection
            const existing       = reqHeaders["Cookie"] ? reqHeaders["Cookie"] + "; " : "";
            reqHeaders["Cookie"] = existing + Object.entries(config.cookies)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join("; ");
        }
        // HTTP Basic Auth
        if (config.auth) {
            const encoded                  = Buffer.from(`${config.auth.user}:${config.auth.pass}`).toString("base64");
            reqHeaders["Authorization"]    = `Basic ${encoded}`;
        }

        // POST body handling
        let method  = "GET";
        let reqBody: string | undefined;
        if (config.requestBody !== undefined) {
            method = "POST";
            if (typeof config.requestBody === "string") {
                reqBody = config.requestBody;
            } else {
                reqBody                       = JSON.stringify(config.requestBody);
                reqHeaders["Content-Type"]    = "application/json";
            }
        }

        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), config.timeout);

        try {
            const proxy = pickRandom(config.proxies ?? []);

            // M-4: Use manual redirect following (proxy path keeps its own redirect handling)
            const response = proxy
                ? await this.fetchWithProxy(config.url, reqHeaders, controller.signal, proxy, method, reqBody)
                : await followRedirects(config.url, {
                    method,
                    headers:  reqHeaders,
                    body:     reqBody,
                    signal:   controller.signal,
                }, config);

            if (!response.ok) {
                const fetchErr = new FetchError(
                    `HTTP ${response.status} for ${config.url}`,
                    response.status
                );
                if (response.status === 429 || response.status === 503) {
                    const ra = response.headers.get("retry-after");
                    if (ra) fetchErr.retryAfter = ra;
                }
                throw fetchErr;
            }

            // H-2: Enforce maximum response size
            const MAX = config.maxResponseSize ?? 10 * 1024 * 1024; // 10MB default
            const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
            if (contentLength > MAX) {
                throw new FetchError(`Response too large: ${contentLength} bytes (max ${MAX})`);
            }

            // H-2: Stream body with running total to enforce limit even without Content-Length
            let html: string;
            const reader = response.body?.getReader();
            if (!reader) {
                html = await response.text(); // fallback for environments without streaming
            } else {
                let total = 0;
                const chunks: Uint8Array[] = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > MAX) {
                        await reader.cancel();
                        throw new FetchError(`Response too large: exceeded ${MAX} bytes`);
                    }
                    chunks.push(value);
                }
                html = new TextDecoder().decode(Buffer.concat(chunks));
            }

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key.toLowerCase()] = value;
            });
            return { html, headers: responseHeaders };
        } catch (err) {
            if (err instanceof FetchError) throw err;
            if (err instanceof Error && err.name === "AbortError") {
                throw new FetchError(`Request timeout for ${config.url}`);
            }
            throw new FetchError(
                `Request error for ${config.url}: ${err instanceof Error ? err.message : String(err)}`
            );
        } finally {
            clearTimeout(timer);
        }
    }

    private async fetchWithProxy(
        url: string,
        headers: Record<string, string>,
        signal: AbortSignal,
        proxy: string,
        method = "GET",
        body?: string
    ): Promise<Response> {
        try {
            // any: undici types differ slightly from globalThis.fetch types - both are valid
            type UndiciModule = {
                fetch(input: string, init: Record<string, unknown>): Promise<Response>;
                ProxyAgent: new (uri: string) => unknown;
            };
            const undici        = await import("undici") as unknown as UndiciModule;
            const dispatcher    = new undici.ProxyAgent(proxy);
            return undici.fetch(url, { method, headers, body, signal, redirect: "follow", dispatcher });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("undici") || msg.includes("Cannot find")) {
                console.warn("[watchdiff] undici unavailable - proxy ignored. Run: npm install undici");
                return globalThis.fetch(url, { method, headers, body, signal, redirect: "follow" });
            }
            throw err;
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(pool: readonly T[]): T | undefined {
    if (pool.length === 0) return undefined;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
