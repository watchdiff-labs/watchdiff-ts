/**
 * Scheduler - drives the periodic check loop.
 *
 * Uses setInterval under the hood. Each WatchConfig gets its own timer
 * so independent intervals are fully supported.
 *
 * Full pipeline per check:
 *   Fetcher/BrowserFetcher - Cleaner - Parser - DiffEngine - Store - Notifier
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Cleaner } from "../cleaner/index.js";
import { DiffEngine } from "../diff/index.js";
import { FetchError, Fetcher } from "../fetcher/index.js";
import { BrowserFetcher } from "../fetcher/browser.js";
import { FileFetcher, filePathFromUrl } from "../file-fetcher/index.js";
import { generateAiSummary, aiSummaryEnabled, getProvider, AiError } from "../ai-summarizer/index.js";
import {
    reportHasChanges,
    reportSummary,
    type DiffReport,
    type IStore,
    type SilenceInfo,
    type SpikeInfo,
    type StatusChangeInfo,
    type WatchConfig,
    type WatcherStatus,
} from "../models.js";
import { Notifier } from "../notifier/index.js";
import { ParserError, Parser } from "../parser/index.js";

export type GlobalCallback = (report: DiffReport) => void | Promise<void>;

// Per-URL runtime state
interface UrlState {
    lastCheckAt:       Date | null;
    nextCheckAt:       Date | null;
    lastChangeAt:      Date | null;
    checksCount:       number;
    changesCount:      number;
    errorsCount:       number;
    paused:            boolean;
    lastAlertAt:       number;
    lastSilenceAt:     number;
    recentChangeTimes: number[];
    lastSpikeAt:       number;
    lastStatusCode:    number;
}

const NUMBERS_PATTERN = /\b\d+(\.\d+)?\b/g;

export class Scheduler {
    private readonly fetcher                                    = new Fetcher();
    private readonly browserFetcher                            = new BrowserFetcher();
    private readonly fileFetcher                               = new FileFetcher();
    private readonly parser                                     = new Parser();
    private readonly engine                                     = new DiffEngine();
    private readonly notifier                                   = new Notifier();
    private readonly globalCallbacks: GlobalCallback[]          = [];
    private readonly timers: ReturnType<typeof setInterval>[]   = [];
    private readonly urlStates                                  = new Map<string, UrlState>();
    /** URLs where AI was permanently disabled (invalid key / bad model). */
    private readonly aiDisabled                                 = new Set<string>();
    private configs: WatchConfig[]                              = [];

    constructor(private readonly store: IStore) { }

    addGlobalCallback(cb: GlobalCallback): void {
        this.globalCallbacks.push(cb);
    }

    /**
     * Start monitoring all configs.
     *
     * Each config runs an immediate first check, then repeats every
     * `config.interval` seconds (± jitter).
     *
     * Returns a `stop()` function.
     */
    start(configs: WatchConfig[]): () => void {
        this.configs = configs;
        for (const config of configs) {
            this.initState(config);
            console.info(`[watchdiff] Starting watcher for ${config.label} (interval=${config.interval}s)`);

            void this.check(config);
            const timer = setInterval(() => {
                if (!this.getState(config).paused) {
                    void this.check(config);
                }
            }, this.effectiveInterval(config) * 1000);

            if (typeof timer === "object" && "unref" in timer) {
                (timer as NodeJS.Timeout).unref();
            }
            this.timers.push(timer);
        }

        return () => this.stop();
    }

    stop(): void {
        for (const timer of this.timers) {
            clearInterval(timer);
        }
        this.timers.length = 0;
        console.info("[watchdiff] All watchers stopped.");
    }

    /** Run a single check and return the DiffReport (or null on first run / error). */
    async checkOnce(config: WatchConfig): Promise<DiffReport | null> {
        this.initState(config);
        return this.check(config);
    }

    // ------------------------------------------------------------------
    // Pause / Resume
    // ------------------------------------------------------------------

    pause(url: string): void {
        const state = this.urlStates.get(url);
        if (state) {
            state.paused = true;
            console.info(`[watchdiff] Paused watcher for ${url}`);
        }
    }

    resume(url: string): void {
        const state = this.urlStates.get(url);
        if (state) {
            state.paused = false;
            console.info(`[watchdiff] Resumed watcher for ${url}`);
        }
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    getStatuses(configs: WatchConfig[]): WatcherStatus[] {
        return configs.map((config) => {
            const state = this.urlStates.get(config.url) ?? this.makeEmptyState();
            return {
                url:          config.url,
                label:        config.label,
                target:       config.target,
                interval:     config.interval,
                paused:       state.paused,
                lastCheckAt:  state.lastCheckAt,
                nextCheckAt:  state.nextCheckAt,
                lastChangeAt: state.lastChangeAt,
                checksCount:    state.checksCount,
                changesCount:   state.changesCount,
                errorsCount:    state.errorsCount,
                lastStatusCode: state.lastStatusCode,
            };
        });
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    private initState(config: WatchConfig): void {
        if (!this.urlStates.has(config.url)) {
            this.urlStates.set(config.url, this.makeEmptyState());
        }
    }

    private makeEmptyState(): UrlState {
        return {
            lastCheckAt:       null,
            nextCheckAt:       null,
            lastChangeAt:      null,
            checksCount:       0,
            changesCount:      0,
            errorsCount:       0,
            paused:            false,
            lastAlertAt:       0,
            lastSilenceAt:     0,
            recentChangeTimes: [],
            lastSpikeAt:       0,
            lastStatusCode:    0,
        };
    }

    private getState(config: WatchConfig): UrlState {
        return this.urlStates.get(config.url) ?? this.makeEmptyState();
    }

    private async handleStatusChange(state: UrlState, currentStatus: number, config: WatchConfig, now: number): Promise<void> {
        const prev = state.lastStatusCode;
        state.lastStatusCode = currentStatus;

        if (!config.alertOnStatusChange || prev === 0 || prev === currentStatus) return;

        const info: StatusChangeInfo = {
            url:            config.url,
            label:          config.label,
            previousStatus: prev,
            currentStatus,
        };

        const label = currentStatus === 200
            ? `recovered (${prev} → 200)`
            : `${prev} → ${currentStatus || "unreachable"}`;

        console.warn(`[${config.label}] HTTP status changed: ${label}`);

        if (config.onStatusChange) {
            try { config.onStatusChange(info); } catch (err) {
                console.warn("[watchdiff] onStatusChange callback error:", err);
            }
        }

        if (!config.dryRun && config.alert) {
            const fakeReport = {
                url:        config.url,
                target:     config.target,
                label:      config.label,
                changes:    [{ kind: "modified" as const, before: String(prev), after: String(currentStatus || "unreachable"), context: "http_status" }],
                comparedAt: new Date(now),
                before:     { url: config.url, target: config.target, content: "", rawHtml: "", capturedAt: new Date(now), checksum: "" },
                after:      { url: config.url, target: config.target, content: "", rawHtml: "", capturedAt: new Date(now), checksum: "" },
            };
            await this.notifier.notify(fakeReport, config.alert);
        }
    }

    /** Compute interval with optional ±jitter. */
    private effectiveInterval(config: WatchConfig): number {
        const base   = config.interval;
        const jitter = config.jitter ?? 0;
        if (jitter <= 0) return base;
        const variance = base * jitter * (Math.random() * 2 - 1);
        return Math.max(1, Math.round(base + variance));
    }

    private async check(config: WatchConfig): Promise<DiffReport | null> {
        const state     = this.getState(config);
        const now       = Date.now();
        state.checksCount++;

        // Schedule next check time
        state.nextCheckAt = new Date(now + this.effectiveInterval(config) * 1000);

        // 1. Fetch (file, browser-rendered, or static HTTP)
        let html: string;
        let responseTimeMs: number | undefined;
        try {
            if (config.isFile) {
                const t0   = Date.now();
                const res  = await this.fileFetcher.fetch(filePathFromUrl(config.url));
                responseTimeMs = Date.now() - t0;
                html = res.content;
            } else {
                const t0 = Date.now();
                html = config.browser
                    ? await this.browserFetcher.fetch(config)
                    : await this.fetcher.fetch(config);
                responseTimeMs = Date.now() - t0;

                await this.handleStatusChange(state, 200, config, now);

                // expectedStatus check
                if (config.expectedStatus !== undefined && config.expectedStatus !== 200) {
                    const err = new Error(
                        `[${config.label}] Unexpected status: expected ${config.expectedStatus}, got 200`,
                    );
                    if (config.onError) config.onError(err, config);
                    else console.warn(err.message);
                }
            }
        } catch (err) {
            state.errorsCount++;
            const fetchErr      = err instanceof FetchError ? err : null;
            const currentStatus = fetchErr?.statusCode ?? 0;

            if (!config.isFile) {
                await this.handleStatusChange(state, currentStatus, config, now);

                if (config.expectedStatus !== undefined && currentStatus === config.expectedStatus) {
                    // status matches expected even on error path - no extra warning
                } else if (fetchErr && config.expectedStatus !== undefined && currentStatus !== config.expectedStatus) {
                    const mismatch = new Error(
                        `[${config.label}] Unexpected status: expected ${config.expectedStatus}, got ${currentStatus || "unreachable"}`,
                    );
                    if (config.onError) config.onError(mismatch, config);
                }
            }

            const error = err instanceof Error ? err : new Error(String(err));
            if (config.onError) {
                try { config.onError(error, config); } catch (cbErr) {
                    console.error(`[${config.label}] onError callback threw:`, cbErr);
                }
            } else {
                console.error(`[${config.label}] Fetch failed:`, error.message);
            }
            state.lastCheckAt = new Date();
            return null;
        }

        // 2. For file watchers: skip HTML cleaning and parsing, use content directly
        let snapshot;
        if (config.isFile) {
            const { makeSnapshot } = await import("../models.js");
            snapshot = makeSnapshot(config.url, config.target, html, html);
        } else {
            // Clean (with optional ignoreNumbers)
            const extraPatterns: RegExp[] = [...config.ignorePatterns];
            if (config.ignoreNumbers) {
                extraPatterns.push(NUMBERS_PATTERN);
            }
            const cleaner = new Cleaner({
                extraSelectors: config.ignoreSelectors,
                extraPatterns,
            });
            const $ = cleaner.clean(html);

            // 3. Parse (CSS or XPath)
            try {
                snapshot = this.parser.extract($, config);
            } catch (err) {
                state.errorsCount++;
                const error = err instanceof Error ? err : new Error(String(err));
                if (config.onError) {
                    try { config.onError(error, config); } catch (cbErr) {
                        console.error(`[${config.label}] onError callback threw:`, cbErr);
                    }
                } else {
                    console.error(`[${config.label}] Parse failed:`, error.message);
                }
                state.lastCheckAt = new Date();
                return null;
            }
        }

        // 4. Compare
        const previous = this.store.loadLatest(config.url, config.target);
        state.lastCheckAt = new Date();

        if (previous === null) {
            if (!config.dryRun) {
                this.store.saveSnapshot(snapshot);
                if (config.maxSnapshots) {
                    this.store.pruneSnapshots?.(config.url, config.target, config.maxSnapshots);
                }
            }
            console.info(`[${config.label}] First snapshot captured.`);
            return null;
        }

        const report = this.engine.compare(previous, snapshot, config);
        if (config.trackResponseTime && responseTimeMs !== undefined) {
            report.responseTimeMs = responseTimeMs;
        }

        if (!config.dryRun) {
            this.store.saveSnapshot(snapshot);
            if (config.maxSnapshots) {
                this.store.pruneSnapshots?.(config.url, config.target, config.maxSnapshots);
            }
        }

        if (reportHasChanges(report)) {
            state.changesCount++;
            state.lastChangeAt = new Date();

            if (!config.dryRun) {
                this.store.saveReport(report);
            }

            console.info(`[${config.label}] ${reportSummary(report)}`);

            // changeThreshold - require a minimum fraction of content to change
            if (config.changeThreshold && config.changeThreshold > 0) {
                const totalLen   = Math.max(previous.content.length, 1);
                const changedLen = report.changes.reduce(
                    (s, c) => s + Math.max(c.before?.length ?? 0, c.after?.length ?? 0),
                    0
                );
                if (changedLen / totalLen < config.changeThreshold) {
                    console.debug(`[${config.label}] Change below threshold (${(changedLen / totalLen * 100).toFixed(1)}% < ${(config.changeThreshold * 100).toFixed(1)}%) - suppressed.`);
                    return report;
                }
            }

            // Spike detection
            if (config.changeSpikeWindow && config.changeSpikeThreshold) {
                const windowMs = config.changeSpikeWindow * 1000;
                state.recentChangeTimes = state.recentChangeTimes.filter((t) => now - t < windowMs);
                state.recentChangeTimes.push(now);
                if (
                    state.recentChangeTimes.length >= config.changeSpikeThreshold &&
                    now - state.lastSpikeAt > windowMs
                ) {
                    state.lastSpikeAt = now;
                    const info: SpikeInfo = {
                        url:              config.url,
                        label:            config.label,
                        changesInWindow:  state.recentChangeTimes.length,
                        windowSeconds:    config.changeSpikeWindow,
                    };
                    console.warn(`[${config.label}] Change spike: ${info.changesInWindow} changes in ${info.windowSeconds}s`);
                    if (config.onSpike) {
                        try { config.onSpike(info); } catch (err) {
                            console.warn("[watchdiff] onSpike callback error:", err);
                        }
                    }
                }
            }

            // HTML archive
            if (config.archiveHtml && !config.dryRun) {
                const storeDir   = this.store.getDirectory?.() ?? ".watchdiff";
                const archiveDir = join(storeDir, "archive");
                mkdirSync(archiveDir, { recursive: true });
                const urlHash    = createHash("md5").update(config.url).digest("hex").slice(0, 8);
                const ts         = new Date().toISOString().replace(/[:.]/g, "-");
                const archivePath = join(archiveDir, `${urlHash}_${ts}.html`);
                writeFileSync(archivePath, snapshot.rawHtml || html, "utf-8");
                console.debug(`[${config.label}] HTML archived: ${archivePath}`);
            }

            // Screenshot on change
            if (config.screenshotOnChange && config.browser && !config.dryRun) {
                try {
                    const storeDir      = this.store.getDirectory?.() ?? ".watchdiff";
                    const archiveDir    = join(storeDir, "archive");
                    mkdirSync(archiveDir, { recursive: true });
                    const urlHash       = createHash("md5").update(config.url).digest("hex").slice(0, 8);
                    const ts            = new Date().toISOString().replace(/[:.]/g, "-");
                    const screenshotPath = join(archiveDir, `${urlHash}_${ts}.png`);
                    const buf = await this.browserFetcher.screenshot(config);
                    writeFileSync(screenshotPath, buf);
                    console.debug(`[${config.label}] Screenshot saved: ${screenshotPath}`);
                } catch (err) {
                    console.warn(`[${config.label}] Screenshot failed:`, err instanceof Error ? err.message : String(err));
                }
            }

            // alertIf - custom condition gate
            if (config.alertIf && !config.alertIf(report)) {
                console.debug(`[${config.label}] alertIf returned false - alert suppressed.`);
                return report;
            }

            // AI summary - smart error handling: skip permanently on auth errors, silently on quota
            if (aiSummaryEnabled(config) && !this.aiDisabled.has(config.url)) {
                try {
                    report.aiSummary = await generateAiSummary(report, getProvider(config) ?? undefined, config.aiPrompt) ?? undefined;
                    if (report.aiSummary) {
                        console.debug(`[${config.label}] AI summary: ${report.aiSummary}`);
                    }
                } catch (err) {
                    if (err instanceof AiError) {
                        if (err.isPermanent) {
                            this.aiDisabled.add(config.url);
                            console.warn(
                                `[${config.label}] AI summaries disabled - ${err.kind}: ${err.message}. ` +
                                `Check your API key or model name.`,
                            );
                        } else if (err.kind === "quota_exceeded") {
                            console.warn(`[${config.label}] AI quota exceeded - skipping this check, will retry next interval.`);
                        } else {
                            console.warn(`[${config.label}] AI summary skipped (${err.kind}): ${err.message}`);
                        }
                    } else {
                        console.warn(`[${config.label}] AI summary error:`, err instanceof Error ? err.message : String(err));
                    }
                }
            }

            // Cooldown check
            const cooldownMs    = (config.cooldown ?? 0) * 1000;
            const cooldownReady = now - state.lastAlertAt >= cooldownMs;

            if (!cooldownReady) {
                const remaining = Math.ceil((cooldownMs - (now - state.lastAlertAt)) / 1000);
                console.debug(`[${config.label}] Alert suppressed - cooldown active (${remaining}s remaining).`);
            } else if (!config.dryRun) {
                state.lastAlertAt = now;

                for (const cb of this.globalCallbacks) {
                    try { await cb(report); } catch (err) {
                        console.warn("[watchdiff] Global callback error:", err);
                    }
                }

                if (config.alert) {
                    await this.notifier.notify(report, config.alert);
                }
            }
        } else {
            console.debug(`[${config.label}] No changes.`);

            // alertIfNoChangeAfter
            if (config.alertIfNoChangeAfter && !config.dryRun) {
                const sinceLastChange = state.lastChangeAt
                    ? (now - state.lastChangeAt.getTime()) / 1000
                    : (state.lastCheckAt
                        ? (now - state.lastCheckAt.getTime()) / 1000
                        : 0);

                const silenceElapsed = now - state.lastSilenceAt;
                const silenceCooldownMs = config.alertIfNoChangeAfter * 1000;

                if (sinceLastChange >= config.alertIfNoChangeAfter && silenceElapsed >= silenceCooldownMs) {
                    state.lastSilenceAt = now;
                    const info: SilenceInfo = {
                        url:                    config.url,
                        label:                  config.label,
                        secondsSinceLastChange: Math.floor(sinceLastChange),
                    };
                    console.warn(`[${config.label}] Silence detected - no change for ${info.secondsSinceLastChange}s`);
                    if (config.onSilence) {
                        try { config.onSilence(info); } catch (err) {
                            console.warn("[watchdiff] onSilence callback error:", err);
                        }
                    }
                }
            }
        }

        return report;
    }
}
