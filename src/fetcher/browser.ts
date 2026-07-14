/**
 * BrowserFetcher - renders JS-heavy pages using a headless Playwright browser.
 *
 * Playwright is an optional peer dependency.
 * Install: npm install playwright && npx playwright install chromium
 */

import { FetchError } from "./index.js";
import type { WatchConfig } from "../models.js";

type ChromiumType = {
    launch(opts: Record<string, unknown>): Promise<{
        newPage(): Promise<{
            setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
            goto(url: string, opts: Record<string, unknown>): Promise<void>;
            waitForSelector(selector: string, opts: Record<string, unknown>): Promise<void>;
            content(): Promise<string>;
            screenshot(opts?: Record<string, unknown>): Promise<Buffer>;
        }>;
        close(): Promise<void>;
    }>;
};

export class BrowserFetcher {
    /**
     * Launch a headless Chromium browser, navigate to the URL and return the
     * fully-rendered HTML (after JavaScript execution).
     *
     * @throws FetchError if playwright is not installed or navigation fails
     */
    async fetch(config: WatchConfig): Promise<string> {
        const chromium = await this.loadChromium();

        const opts    = config.browserOptions ?? {};
        const timeout = config.timeout;

        const launchOpts: Record<string, unknown> = { headless: true };

        if (opts.executablePath) {
            launchOpts["executablePath"] = opts.executablePath;
        }

        const proxy = pickRandom(config.proxies ?? []);
        if (proxy) {
            launchOpts["proxy"] = { server: proxy };
        }

        let browser: Awaited<ReturnType<ChromiumType["launch"]>>;
        try {
            browser = await chromium.launch(launchOpts);
        } catch (err) {
            throw new FetchError(
                `Browser launch failed (is playwright installed?): ${err instanceof Error ? err.message : String(err)}`
            );
        }

        try {
            const page = await browser.newPage();

            const ua = pickRandom(config.userAgents ?? []);
            if (ua) {
                await page.setExtraHTTPHeaders({ "User-Agent": ua });
            }

            if (Object.keys(config.headers).length > 0) {
                await page.setExtraHTTPHeaders(config.headers);
            }

            await page.goto(config.url, {
                timeout,
                waitUntil: opts.waitFor ?? "domcontentloaded",
            });

            if (opts.waitForSelector) {
                await page.waitForSelector(opts.waitForSelector, { timeout });
            }

            return await page.content();
        } catch (err) {
            if (err instanceof FetchError) throw err;
            throw new FetchError(
                `Browser fetch error for ${config.url}: ${err instanceof Error ? err.message : String(err)}`
            );
        } finally {
            await browser.close();
        }
    }

    async screenshot(config: WatchConfig): Promise<Buffer> {
        const chromium = await this.loadChromium();
        const opts     = config.browserOptions ?? {};
        const browser  = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.goto(config.url, {
                timeout:   config.timeout,
                waitUntil: opts.waitFor ?? "domcontentloaded",
            });
            if (opts.waitForSelector) {
                await page.waitForSelector(opts.waitForSelector, { timeout: config.timeout });
            }
            return await page.screenshot({ type: "png", fullPage: true });
        } finally {
            await browser.close();
        }
    }

    private async loadChromium(): Promise<ChromiumType> {
        try {
            const pw = await import("playwright") as unknown as { chromium: ChromiumType };
            return pw.chromium;
        } catch {
            throw new FetchError(
                "Playwright is not installed. Run: npm install playwright && npx playwright install chromium"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(pool: T[]): T | undefined {
    if (pool.length === 0) return undefined;
    return pool[Math.floor(Math.random() * pool.length)];
}
