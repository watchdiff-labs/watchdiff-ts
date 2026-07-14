/**
 * WatchDiff TypeScript - unit tests (vitest)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cleaner } from "./cleaner/index.js";
import { Parser, ParserError } from "./parser/index.js";
import { DiffEngine } from "./diff/index.js";
import { Store } from "./store/index.js";
import { Notifier } from "./notifier/index.js";
import { Fetcher, FetchError } from "./fetcher/index.js";
import { Scheduler } from "./scheduler/index.js";
import {
    makeSnapshot,
    makeWatchConfig,
    reportHasChanges,
    reportSummary,
    type AlertConfig,
    type DiffReport,
    type IStore,
} from "./models.js";

// ---------------------------------------------------------------------------
// Cleaner
// ---------------------------------------------------------------------------

describe("Cleaner", () => {
    const cleaner = new Cleaner();

    it("strips script tags", () => {
        const html = "<html><body><script>alert(1)</script><p>Hello</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toContain("alert");
        expect(text).toContain("Hello");
    });

    it("strips style tags", () => {
        const html = "<html><body><style>body{color:red}</style><p>World</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toContain("color");
        expect(text).toContain("World");
    });

    it("strips extra CSS selectors", () => {
        const html = '<html><body><div class="ads">Buy now!</div><p>Content</p></body></html>';
        const text = new Cleaner({ extraSelectors: [".ads"] }).cleanToText(html);
        expect(text).not.toContain("Buy now");
        expect(text).toContain("Content");
    });

    it("normalises whitespace", () => {
        const html = "<html><body><p>Hello   World</p></body></html>";
        const text = cleaner.cleanToText(html);
        expect(text).not.toMatch(/  /);
    });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("Parser", () => {
    const parser    = new Parser();
    const cleaner   = new Cleaner();

    it("extracts full page when no target", () => {
        const html      = "<html><body><p>Hello World</p></body></html>";
        const $         = cleaner.clean(html);
        const snap      = parser.extract($, makeWatchConfig("https://example.com"));
        expect(snap.content).toContain("Hello World");
    });

    it("extracts targeted selector", () => {
        const html      = '<html><body><span class="price">19€</span><p>Other</p></body></html>';
        const $         = cleaner.clean(html);
        const snap      = parser.extract($, makeWatchConfig("https://example.com", { target: ".price" }));
        expect(snap.content).toContain("19€");
        expect(snap.content).not.toContain("Other");
    });

    it("throws ParserError for missing selector", () => {
        const html      = "<html><body><p>Hello</p></body></html>";
        const $         = cleaner.clean(html);
        expect(() =>
            parser.extract($, makeWatchConfig("https://example.com", { target: ".missing" }))
        ).toThrow(ParserError);
    });
});

// ---------------------------------------------------------------------------
// DiffEngine
// ---------------------------------------------------------------------------

describe("DiffEngine", () => {
    const engine = new DiffEngine();
    const config = makeWatchConfig("https://example.com", { label: "test" });

    it("returns no changes when content is identical", () => {
        const snap      = makeSnapshot("https://example.com", undefined, "Hello World", "");
        const report    = engine.compare(snap, snap, config);
        expect(reportHasChanges(report)).toBe(false);
    });

    it("detects added lines", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Hello", "");
        const after     = makeSnapshot("https://example.com", undefined, "Hello\nNew line here", "");
        const report    = engine.compare(before, after, config);
        expect(reportHasChanges(report)).toBe(true);
        expect(report.changes.some((c) => c.kind === "added")).toBe(true);
    });

    it("detects removed lines", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Hello\nGoodbye", "");
        const after     = makeSnapshot("https://example.com", undefined, "Hello", "");
        const report    = engine.compare(before, after, config);
        expect(report.changes.some((c) => c.kind === "removed")).toBe(true);
    });

    it("detects modifications", () => {
        const before    = makeSnapshot("https://example.com", undefined, "Price: 19€", "");
        const after     = makeSnapshot("https://example.com", undefined, "Price: 24€", "");
        const report    = engine.compare(before, after, config);
        expect(reportHasChanges(report)).toBe(true);
        const mod = report.changes.filter((c) => c.kind === "modified");
        expect(mod.length).toBeGreaterThan(0);
        expect(mod[0]?.before).toContain("19€");
        expect(mod[0]?.after).toContain("24€");
    });

    it("summary says no changes when identical", () => {
        const snap = makeSnapshot("https://example.com", undefined, "Same", "");
        const report = engine.compare(snap, snap, config);
        expect(reportSummary(report)).toContain("No changes");
    });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("Store", () => {
    let tmpDir: string;
    let store: Store;

    beforeEach(() => {
        tmpDir  = mkdtempSync(join(tmpdir(), "watchdiff-test-"));
        store   = new Store(tmpDir);
    });

    it("saves and loads latest snapshot", () => {
        const snap = makeSnapshot("https://example.com", undefined, "v1", "");
        store.saveSnapshot(snap);
        const loaded = store.loadLatest("https://example.com", undefined);
        expect(loaded).not.toBeNull();
        expect(loaded!.content).toBe("v1");
    });

    it("returns null when no snapshots exist", () => {
        expect(store.loadLatest("https://unknown.com", undefined)).toBeNull();
    });

    it("respects history limit", () => {
        for (let i = 0; i < 5; i++) {
            store.saveSnapshot(makeSnapshot("https://example.com", undefined, `v${i}`, ""));
        }
        const history = store.loadHistory("https://example.com", undefined, 3);
        expect(history).toHaveLength(3);
    });

    it("clears history", () => {
        store.saveSnapshot(makeSnapshot("https://example.com", undefined, "v1", ""));
        store.clearHistory("https://example.com", undefined);
        expect(store.loadLatest("https://example.com", undefined)).toBeNull();
    });

    it("saves and loads reports", () => {
        const before    = makeSnapshot("https://example.com", undefined, "A", "");
        const after     = makeSnapshot("https://example.com", undefined, "B", "");
        const config    = makeWatchConfig("https://example.com", { label: "test" });
        const engine    = new DiffEngine();
        const report    = engine.compare(before, after, config);
        store.saveReport(report);
        const reports = store.loadReports("https://example.com", undefined);
        expect(reports).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

function makeMockReport(): DiffReport {
    const engine = new DiffEngine();
    const before = makeSnapshot("https://example.com", undefined, "Hello", "");
    const after  = makeSnapshot("https://example.com", undefined, "Hello World", "");
    const config = makeWatchConfig("https://example.com", { label: "test" });
    return engine.compare(before, after, config);
}

describe("Notifier", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("invokes onChange callback when changes exist", async () => {
        const cb       = vi.fn();
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = { onChange: [cb], webhooks: [], minChanges: 1 };
        await notifier.notify(report, alert);
        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith(report);
    });

    it("does not invoke callback when no changes", async () => {
        const cb       = vi.fn();
        const notifier = new Notifier();
        const snap     = makeSnapshot("https://example.com", undefined, "Same", "");
        const config   = makeWatchConfig("https://example.com", { label: "test" });
        const engine   = new DiffEngine();
        const report   = engine.compare(snap, snap, config);
        const alert: AlertConfig = { onChange: [cb], webhooks: [], minChanges: 1 };
        await notifier.notify(report, alert);
        expect(cb).not.toHaveBeenCalled();
    });

    it("suppresses alert when below minChanges", async () => {
        const cb       = vi.fn();
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = { onChange: [cb], webhooks: [], minChanges: 999 };
        await notifier.notify(report, alert);
        expect(cb).not.toHaveBeenCalled();
    });

    it("sends Discord webhook with content field", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("ok", { status: 200 })
        );
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = {
            onChange:   [],
            webhooks:   ["https://discord.com/api/webhooks/123/abc"],
            minChanges: 1,
        };
        await notifier.notify(report, alert);
        expect(fetchSpy).toHaveBeenCalledOnce();
        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
        expect(body).toHaveProperty("content");
        expect(typeof body["content"]).toBe("string");
    });

    it("sends Slack webhook with text field", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("ok", { status: 200 })
        );
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = {
            onChange:   [],
            webhooks:   ["https://hooks.slack.com/services/T000/B000/xxxx"],
            minChanges: 1,
        };
        await notifier.notify(report, alert);
        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
        expect(body).toHaveProperty("text");
    });

    it("sends Telegram webhook with chat_id field", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("ok", { status: 200 })
        );
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = {
            onChange:   [],
            webhooks:   ["https://api.telegram.org/bot123:TOKEN/sendMessage?chat_id=456"],
            minChanges: 1,
        };
        await notifier.notify(report, alert);
        const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
        expect(body).toHaveProperty("chat_id", "456");
    });

    it("handles webhook HTTP error without throwing", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("server error", { status: 500 })
        );
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = {
            onChange:       [],
            webhooks:       ["https://example.com/webhook"],
            minChanges:     1,
            webhookRetries: 0,
        };
        await expect(notifier.notify(report, alert)).resolves.not.toThrow();
    });

    it("retries webhook on failure and succeeds on second attempt", async () => {
        let calls = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            calls++;
            if (calls === 1) return new Response("error", { status: 500 });
            return new Response("ok", { status: 200 });
        });
        const notifier = new Notifier();
        const report   = makeMockReport();
        const alert: AlertConfig = {
            onChange:       [],
            webhooks:       ["https://example.com/webhook"],
            minChanges:     1,
            webhookRetries: 1,
        };
        await notifier.notify(report, alert);
        expect(calls).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

describe("Fetcher", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns HTML on successful fetch", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("<html><body>Hello</body></html>", { status: 200 })
        );
        const fetcher = new Fetcher();
        const config  = makeWatchConfig("https://example.com");
        const result  = await fetcher.fetch(config);
        expect(result).toContain("Hello");
    });

    it("retries on 503 and succeeds on third attempt", async () => {
        let attempts = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            attempts++;
            if (attempts < 3) return new Response("error", { status: 503 });
            return new Response("<html>ok</html>", { status: 200 });
        });
        const fetcher = new Fetcher();
        const config  = makeWatchConfig("https://example.com", { retries: 2, retryDelay: 0 });
        const result  = await fetcher.fetch(config);
        expect(result).toContain("ok");
        expect(attempts).toBe(3);
    });

    it("does not retry on 403 (non-retryable)", async () => {
        let attempts = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            attempts++;
            return new Response("forbidden", { status: 403 });
        });
        const fetcher = new Fetcher();
        const config  = makeWatchConfig("https://example.com", { retries: 3 });
        await expect(fetcher.fetch(config)).rejects.toThrow(FetchError);
        expect(attempts).toBe(1);
    });

    it("throws FetchError after all retries exhausted", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("bad gateway", { status: 502 })
        );
        const fetcher = new Fetcher();
        const config  = makeWatchConfig("https://example.com", { retries: 2, retryDelay: 0 });
        await expect(fetcher.fetch(config)).rejects.toThrow(FetchError);
    });

    it("retries on 429 (rate limited)", async () => {
        let attempts = 0;
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
            attempts++;
            if (attempts === 1) return new Response("rate limited", { status: 429 });
            return new Response("<html>ok</html>", { status: 200 });
        });
        const fetcher = new Fetcher();
        const config  = makeWatchConfig("https://example.com", { retries: 1, retryDelay: 0 });
        const result  = await fetcher.fetch(config);
        expect(result).toContain("ok");
        expect(attempts).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function makeMockStore(): IStore {
    return {
        saveSnapshot: vi.fn(),
        loadLatest:   vi.fn().mockReturnValue(null),
        loadHistory:  vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
        saveReport:   vi.fn(),
        loadReports:  vi.fn().mockReturnValue([]),
    };
}

describe("Scheduler", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("getStatuses returns correct shape before any check", () => {
        const store     = makeMockStore();
        const scheduler = new Scheduler(store);
        const config    = makeWatchConfig("https://example.com", { label: "My Site", interval: 60 });
        const statuses  = scheduler.getStatuses([config]);

        expect(statuses).toHaveLength(1);
        expect(statuses[0]!.url).toBe("https://example.com");
        expect(statuses[0]!.label).toBe("My Site");
        expect(statuses[0]!.interval).toBe(60);
        expect(statuses[0]!.paused).toBe(false);
        expect(statuses[0]!.checksCount).toBe(0);
        expect(statuses[0]!.changesCount).toBe(0);
        expect(statuses[0]!.lastCheckAt).toBeNull();
    });

    it("pause and resume update watcher state", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("<html><body>content</body></html>", { status: 200 })
        );
        const store     = makeMockStore();
        const scheduler = new Scheduler(store);
        const config    = makeWatchConfig("https://example.com");

        await scheduler.checkOnce(config);

        scheduler.pause("https://example.com");
        expect(scheduler.getStatuses([config])[0]!.paused).toBe(true);

        scheduler.resume("https://example.com");
        expect(scheduler.getStatuses([config])[0]!.paused).toBe(false);
    });

    it("increments checksCount after a check", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("<html><body>hello</body></html>", { status: 200 })
        );
        const store     = makeMockStore();
        const scheduler = new Scheduler(store);
        const config    = makeWatchConfig("https://example.com");

        await scheduler.checkOnce(config);

        const status = scheduler.getStatuses([config])[0]!;
        expect(status.checksCount).toBe(1);
        expect(status.lastCheckAt).not.toBeNull();
    });

    it("increments changesCount when content changes", async () => {
        const firstSnap = makeSnapshot("https://example.com", undefined, "old content", "");
        const store     = makeMockStore();
        (store.loadLatest as ReturnType<typeof vi.fn>).mockReturnValue(firstSnap);

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("<html><body>new content</body></html>", { status: 200 })
        );

        const scheduler = new Scheduler(store);
        const config    = makeWatchConfig("https://example.com", { dryRun: true });

        await scheduler.checkOnce(config);

        const status = scheduler.getStatuses([config])[0]!;
        expect(status.changesCount).toBe(1);
    });
});