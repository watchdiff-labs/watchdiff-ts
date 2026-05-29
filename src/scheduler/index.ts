/**
 * Scheduler - drives the periodic check loop.
 *
 * Uses setInterval under the hood. Each WatchConfig gets its own timer
 * so independent intervals are fully supported.
 *
 * Full pipeline per check:
 *   Fetcher/BrowserFetcher - Cleaner - Parser - DiffEngine - Store - Notifier
 */

import { Cleaner } from "../cleaner/index.js";
import { DiffEngine } from "../diff/index.js";
import { FetchError, Fetcher } from "../fetcher/index.js";
import { BrowserFetcher } from "../fetcher/browser.js";
import {
    reportHasChanges,
    reportSummary,
    type DiffReport,
    type IStore,
    type SilenceInfo,
    type WatchConfig,
    type WatcherStatus,
} from "../models.js";
import { Notifier } from "../notifier/index.js";
import { ParserError, Parser } from "../parser/index.js";

export type GlobalCallback = (report: DiffReport) => void | Promise<void>;

// Per-URL runtime state
interface UrlState {
    lastCheckAt:    Date | null;
    nextCheckAt:    Date | null;
    lastChangeAt:   Date | null;
    checksCount:    number;
    changesCount:   number;
    paused:         boolean;
    // Tracks last alert timestamp for cooldown enforcement
    lastAlertAt:    number;
    // Tracks last silence alert timestamp to avoid repeated silence alerts
    lastSilenceAt:  number;
}

const NUMBERS_PATTERN = /\b\d+(\.\d+)?\b/g;

export class Scheduler {
    private readonly fetcher                                    = new Fetcher();
    private readonly browserFetcher                            = new BrowserFetcher();
    private readonly parser                                     = new Parser();
    private readonly engine                                     = new DiffEngine();
    private readonly notifier                                   = new Notifier();
    private readonly globalCallbacks: GlobalCallback[]          = [];
    private readonly timers: ReturnType<typeof setInterval>[]   = [];
    private readonly urlStates                                  = new Map<string, UrlState>();
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
                checksCount:  state.checksCount,
                changesCount: state.changesCount,
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
            lastCheckAt:   null,
            nextCheckAt:   null,
            lastChangeAt:  null,
            checksCount:   0,
            changesCount:  0,
            paused:        false,
            lastAlertAt:   0,
            lastSilenceAt: 0,
        };
    }

    private getState(config: WatchConfig): UrlState {
        return this.urlStates.get(config.url) ?? this.makeEmptyState();
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

        // 1. Fetch (static or browser-rendered)
        let html: string;
        try {
            html = config.browser
                ? await this.browserFetcher.fetch(config)
                : await this.fetcher.fetch(config);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (config.onError) {
                config.onError(error, config);
            } else {
                console.error(`[${config.label}] Fetch failed:`, error.message);
            }
            state.lastCheckAt = new Date();
            return null;
        }

        // 2. Clean (with optional ignoreNumbers)
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
        let snapshot;
        try {
            snapshot = this.parser.extract($, config);
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (config.onError) {
                config.onError(error, config);
            } else {
                console.error(`[${config.label}] Parse failed:`, error.message);
            }
            state.lastCheckAt = new Date();
            return null;
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
