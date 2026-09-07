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

                const delay = baseDelay * Math.pow(2, attempt - 1);
                await sleep(delay);
            }
        }

        throw lastErr!;
    }

    private async attemptFetchWithHeaders(config: WatchConfig): Promise<{ html: string; headers: Record<string, string> }> {
        const userAgent  = pickRandom(config.userAgents ?? []) ?? pickRandom([...DEFAULT_USER_AGENTS]) ?? FALLBACK_UA;
        const reqHeaders: Record<string, string> = { ...BASE_HEADERS, "User-Agent": userAgent, ...config.headers };
        if (config.cookies && Object.keys(config.cookies).length > 0) {
            const existing = reqHeaders["Cookie"] ? reqHeaders["Cookie"] + "; " : "";
            reqHeaders["Cookie"] = existing + Object.entries(config.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
        }
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), config.timeout);

        try {
            const proxy = pickRandom(config.proxies ?? []);

            const response = proxy
                ? await this.fetchWithProxy(config.url, reqHeaders, controller.signal, proxy)
                : await globalThis.fetch(config.url, {
                    headers:  reqHeaders,
                    signal:   controller.signal,
                    redirect: "follow",
                });

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

            const html = await response.text();
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
        proxy: string
    ): Promise<Response> {
        try {
            // any: undici types differ slightly from globalThis.fetch types - both are valid
            type UndiciModule = {
                fetch(input: string, init: Record<string, unknown>): Promise<Response>;
                ProxyAgent: new (uri: string) => unknown;
            };
            const undici        = await import("undici") as unknown as UndiciModule;
            const dispatcher    = new undici.ProxyAgent(proxy);
            return undici.fetch(url, { headers, signal, redirect: "follow", dispatcher });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("undici") || msg.includes("Cannot find")) {
                console.warn("[watchdiff] undici unavailable - proxy ignored. Run: npm install undici");
                return globalThis.fetch(url, { headers, signal, redirect: "follow" });
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
