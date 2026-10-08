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
    type ActiveBetween,
    type DiffReport,
    type IStore,
    type MaintenanceWindow,
    type SilenceInfo,
    type SpikeInfo,
    type StatusChangeInfo,
    type WatchConfig,
    type WatcherStatus,
} from "../models.js";
import { Notifier } from "../notifier/index.js";
import { ParserError, Parser } from "../parser/index.js";
import { nextCronRun } from "../cron-parser/index.js";
import { extractJsonPath } from "../json-path/index.js";

export type GlobalCallback = (report: DiffReport) => void | Promise<void>;

// Per-URL runtime state
interface UrlState {
    lastCheckAt:              Date | null;
    nextCheckAt:              Date | null;
    lastChangeAt:             Date | null;
    checksCount:              number;
    changesCount:             number;
    errorsCount:              number;
    paused:                   boolean;
    lastAlertAt:              number;
    lastSilenceAt:            number;
    recentChangeTimes:        number[];
    lastSpikeAt:              number;
    lastStatusCode:           number;
    /** Consecutive fetch/parse error count (for failurePolicy). */
    consecutiveFailureCount:  number;
    /** Consecutive success count after a failure period (for failurePolicy recovery). */
    consecutiveSuccessCount:  number;
    /** Whether alerts are suppressed due to failure policy (waiting for recovery). */
    alertsSuppressedByPolicy: boolean;
    /** Timestamp (ms) after which the next check may proceed (for Retry-After). */
    retryAfterUntil:          number;
    /** Whether currently inside a maintenance window. */
    inMaintenance:            boolean;
}

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

class Semaphore {
    private running = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly limit: number) {}

    async acquire(): Promise<void> {
        if (this.running < this.limit) {
            this.running++;
            return;
        }
        await new Promise<void>((resolve) => this.queue.push(resolve));
        this.running++;
    }

    release(): void {
        this.running--;
        const next = this.queue.shift();
        if (next) next();
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// ---------------------------------------------------------------------------
// Active-hours helpers
// ---------------------------------------------------------------------------

function isInActiveBetween(activeBetween: ActiveBetween): boolean {
    const tz       = activeBetween.timezone ?? "UTC";
    const now      = new Date();

    // Get local time parts using Intl.DateTimeFormat
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour:     "2-digit",
        minute:   "2-digit",
        hour12:   false,
        weekday:  "long",
    }).formatToParts(now);

    const hourPart   = parts.find((p) => p.type === "hour")?.value   ?? "00";
    const minutePart = parts.find((p) => p.type === "minute")?.value ?? "00";
    const weekday    = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase() as
        "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

    const currentTime = `${hourPart.padStart(2, "0")}:${minutePart.padStart(2, "0")}`;

    // Check day of week
    if (activeBetween.days && activeBetween.days.length > 0) {
        if (!activeBetween.days.includes(weekday)) return false;
    }

    // Check time window
    const from = activeBetween.from;
    const to   = activeBetween.to;

    if (from <= to) {
        // Normal window: e.g. 09:00 - 18:00
        return currentTime >= from && currentTime <= to;
    } else {
        // Overnight window: e.g. 22:00 - 06:00
        return currentTime >= from || currentTime <= to;
    }
}

function isInMaintenanceWindow(windows: MaintenanceWindow[]): boolean {
    const now = Date.now();
    return windows.some((w) => {
        const from = new Date(w.from).getTime();
        const to   = new Date(w.to).getTime();
        return now >= from && now <= to;
    });
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
    private readonly semaphore:   Semaphore | null;
    private configs: WatchConfig[]                              = [];

    constructor(private readonly store: IStore, concurrency?: number) {
        this.semaphore = concurrency !== undefined && concurrency > 0
            ? new Semaphore(concurrency)
            : null;
    }

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

            if (config.schedule) {
                console.info(`[watchdiff] Starting watcher for ${config.label} (schedule=${config.schedule})`);
                void this.runCheck(config);
                this.scheduleCron(config);
            } else {
                console.info(`[watchdiff] Starting watcher for ${config.label} (interval=${config.interval}s)`);
                void this.runCheck(config);
                const timer = setInterval(() => {
                    if (!this.getState(config).paused) {
                        void this.runCheck(config);
                    }
                }, this.effectiveInterval(config) * 1000);

                if (typeof timer === "object" && "unref" in timer) {
                    (timer as NodeJS.Timeout).unref();
                }
                this.timers.push(timer);
            }
        }

        return () => this.stop();
    }

    private scheduleCron(config: WatchConfig): void {
        const state  = this.getState(config);
        const next   = nextCronRun(config.schedule!);
        const delay  = Math.max(0, next.getTime() - Date.now());
        state.nextCheckAt = next;

        const timer = setTimeout(() => {
            if (!this.getState(config).paused) {
                void this.runCheck(config).then(() => {
                    this.scheduleCron(config);
                });
            } else {
                this.scheduleCron(config);
            }
        }, delay);

        if (typeof timer === "object" && "unref" in timer) {
            (timer as NodeJS.Timeout).unref();
        }
    }

    /** Wrapper that applies semaphore + maintenance/active-hours skip logic before check(). */
    private async runCheck(config: WatchConfig): Promise<DiffReport | null> {
        const state = this.getState(config);

        // Retry-After: skip if still within delay window
        if (state.retryAfterUntil > Date.now()) {
            const remainingSec = Math.ceil((state.retryAfterUntil - Date.now()) / 1000);
            console.debug(`[${config.label}] Skipping check - Retry-After delay active (${remainingSec}s remaining).`);
            return null;
        }

        // Maintenance window check
        if (config.maintenanceWindows && config.maintenanceWindows.length > 0) {
            const inMaintenance = isInMaintenanceWindow(config.maintenanceWindows);
            state.inMaintenance = inMaintenance;
            if (inMaintenance) {
                console.debug(`[${config.label}] Skipping check - inside maintenance window.`);
                return null;
            }
        } else {
            state.inMaintenance = false;
        }

        // Active-between check
        if (config.activeBetween) {
            if (!isInActiveBetween(config.activeBetween)) {
                console.debug(`[${config.label}] Skipping check - outside active hours.`);
                return null;
            }
        }

        if (this.semaphore) {
            return this.semaphore.run(() => this.check(config));
        }
        return this.check(config);
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
        return this.runCheck(config);
    }

    // ------------------------------------------------------------------
    // Pause / Resume
    // ------------------------------------------------------------------

    pause(urlOrId: string): void {
        const state = this.urlStates.get(urlOrId);
        if (state) {
            state.paused = true;
            console.info(`[watchdiff] Paused watcher for ${urlOrId}`);
        }
    }

    resume(urlOrId: string): void {
        const state = this.urlStates.get(urlOrId);
        if (state) {
            state.paused = false;
            console.info(`[watchdiff] Resumed watcher for ${urlOrId}`);
        }
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    getStatuses(configs: WatchConfig[]): WatcherStatus[] {
        return configs.map((config) => {
            const state = this.urlStates.get(this.stateKey(config)) ?? this.makeEmptyState();
            return {
                url:            config.url,
                id:             config.id,
                label:          config.label,
                target:         config.target,
                interval:       config.interval,
                paused:         state.paused,
                inMaintenance:  state.inMaintenance,
                lastCheckAt:    state.lastCheckAt,
                nextCheckAt:    state.nextCheckAt,
                lastChangeAt:   state.lastChangeAt,
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

    /** Returns the canonical identity key for a config (id takes priority over url). */
    private stateKey(config: WatchConfig): string {
        return config.id ?? config.url;
    }

    private initState(config: WatchConfig): void {
        const key = this.stateKey(config);
        if (!this.urlStates.has(key)) {
            this.urlStates.set(key, this.makeEmptyState());
        }
    }

    private makeEmptyState(): UrlState {
        return {
            lastCheckAt:              null,
            nextCheckAt:              null,
            lastChangeAt:             null,
            checksCount:              0,
            changesCount:             0,
            errorsCount:              0,
            paused:                   false,
            lastAlertAt:              0,
            lastSilenceAt:            0,
            recentChangeTimes:        [],
            lastSpikeAt:              0,
            lastStatusCode:           0,
            consecutiveFailureCount:  0,
            consecutiveSuccessCount:  0,
            alertsSuppressedByPolicy: false,
            retryAfterUntil:          0,
            inMaintenance:            false,
        };
    }

    private getState(config: WatchConfig): UrlState {
        return this.urlStates.get(this.stateKey(config)) ?? this.makeEmptyState();
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
            await this.notifier.notify(fakeReport, config.alert, config.webhookHeaders);
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
            state.consecutiveFailureCount++;
            state.consecutiveSuccessCount = 0;
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

            // Failure policy: Retry-After header support
            if (
                config.failurePolicy?.respectRetryAfter &&
                fetchErr &&
                (currentStatus === 429 || currentStatus === 503) &&
                fetchErr.retryAfter
            ) {
                const delaySec = parseRetryAfter(fetchErr.retryAfter);
                if (delaySec > 0) {
                    state.retryAfterUntil = Date.now() + delaySec * 1000;
                    console.debug(`[${config.label}] Retry-After: waiting ${delaySec}s before next check.`);
                }
            }

            // Failure policy: only fire onError after consecutiveFailures threshold
            const threshold = config.failurePolicy?.consecutiveFailures ?? 1;
            if (state.consecutiveFailureCount >= threshold) {
                const error = err instanceof Error ? err : new Error(String(err));
                if (config.onError) {
                    try { config.onError(error, config); } catch (cbErr) {
                        console.error(`[${config.label}] onError callback threw:`, cbErr);
                    }
                } else {
                    console.error(`[${config.label}] Fetch failed:`, error.message);
                }
                // Suppress further alerts until recovery
                if (state.consecutiveFailureCount === threshold) {
                    state.alertsSuppressedByPolicy = true;
                }
            } else {
                console.debug(`[${config.label}] Fetch failed (failure ${state.consecutiveFailureCount}/${threshold} before alert).`);
            }
            state.lastCheckAt = new Date();
            return null;
        }

        // 2. For file watchers: skip HTML cleaning and parsing, use content directly
        let snapshot;
        if (config.isFile) {
            let content = html;
            if (config.jsonPath) {
                try {
                    content = extractJsonPath(html, config.jsonPath);
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    if (config.onError) {
                        try { config.onError(error, config); } catch (cbErr) {
                            console.error(`[${config.label}] onError callback threw:`, cbErr);
                        }
                    } else {
                        console.warn(`[${config.label}] jsonPath extraction failed: ${error.message}`);
                    }
                    state.lastCheckAt = new Date();
                    return null;
                }
            }
            const { makeSnapshot } = await import("../models.js");
            snapshot = makeSnapshot(config.url, config.target, content, content);
        } else {
            // Apply jsonPath extraction before HTML cleaning when content looks like JSON
            if (config.jsonPath && html.trimStart().startsWith("{") || config.jsonPath && html.trimStart().startsWith("[")) {
                try {
                    html = extractJsonPath(html, config.jsonPath);
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    if (config.onError) {
                        try { config.onError(error, config); } catch (cbErr) {
                            console.error(`[${config.label}] onError callback threw:`, cbErr);
                        }
                    } else {
                        console.warn(`[${config.label}] jsonPath extraction failed: ${error.message}`);
                    }
                    state.lastCheckAt = new Date();
                    return null;
                }
            }

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

        // 4. Failure policy - track recovery after errors
        if (state.consecutiveFailureCount > 0) {
            state.consecutiveSuccessCount++;
            const requiredSuccesses = config.failurePolicy?.recoveryChecks ?? 1;
            if (state.consecutiveSuccessCount >= requiredSuccesses) {
                state.consecutiveFailureCount  = 0;
                state.consecutiveSuccessCount  = 0;
                state.alertsSuppressedByPolicy = false;
                console.info(`[${config.label}] Recovered after failures - alerts re-enabled.`);
                if (config.onRecovery) {
                    try { config.onRecovery(config); } catch (err) {
                        console.warn("[watchdiff] onRecovery callback error:", err);
                    }
                }
            } else {
                console.debug(
                    `[${config.label}] Recovery check ${state.consecutiveSuccessCount}/${requiredSuccesses} - alerts still suppressed.`
                );
            }
        }

        // 5. Compare
        const previous = this.store.loadLatest(config.url, config.target);
        state.lastCheckAt = new Date();

        if (previous === null) {
            if (!config.dryRun) {
                this.store.saveSnapshot(snapshot);
                if (config.maxSnapshots) {
                    this.store.pruneSnapshots?.(config.url, config.target, config.maxSnapshots);
                }
                if (config.retentionDays) {
                    this.pruneByRetention(config);
                }
            }
            console.info(`[${config.label}] First snapshot captured.`);

            // alertOnFirstCheck: synthesise a DiffReport with all content as "added"
            if (config.alertOnFirstCheck && !config.dryRun) {
                const { makeSnapshot: mk } = await import("../models.js");
                const emptyBefore = mk(config.url, config.target, "", "");
                const firstReport = this.engine.compare(emptyBefore, snapshot, config);
                if (firstReport.changes.length > 0) {
                    for (const cb of this.globalCallbacks) {
                        try { await cb(firstReport); } catch (err) {
                            console.warn("[watchdiff] Global callback error:", err);
                        }
                    }
                    if (config.alert) {
                        await this.notifier.notify(firstReport, config.alert, config.webhookHeaders);
                    }
                }
                return firstReport;
            }

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
            if (config.retentionDays) {
                this.pruneByRetention(config);
            }
        }

        if (reportHasChanges(report)) {
            // Flapping detection: wait confirmAfter seconds and re-check before alerting
            if (config.confirmAfter && config.confirmAfter > 0) {
                console.debug(`[${config.label}] Change detected - confirming in ${config.confirmAfter}s.`);
                setTimeout(async () => {
                    try {
                        const confirmed = await this.checkConfirm(config, snapshot.content);
                        if (confirmed) {
                            await this.dispatchChange(report, config, state, snapshot, html);
                        } else {
                            console.debug(`[${config.label}] Change reverted before confirmation - suppressed.`);
                        }
                    } catch (err) {
                        console.warn(`[${config.label}] Confirm check failed:`, err instanceof Error ? err.message : String(err));
                    }
                }, config.confirmAfter * 1000).unref?.();
                return report;
            }

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

            // Failure policy: suppress alerts during recovery period
            if (state.alertsSuppressedByPolicy) {
                console.debug(`[${config.label}] Alert suppressed - waiting for failure policy recovery.`);
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
                    await this.notifier.notify(report, config.alert, config.webhookHeaders);
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

    /**
     * Re-fetch and compare content against `expectedContent` to confirm a change is stable.
     * Returns true if the change persists, false if the content reverted.
     */
    private async checkConfirm(config: WatchConfig, expectedContent: string): Promise<boolean> {
        try {
            let html: string;
            if (config.isFile) {
                const res = await this.fileFetcher.fetch(filePathFromUrl(config.url));
                html = res.content;
            } else {
                html = config.browser
                    ? await this.browserFetcher.fetch(config)
                    : await this.fetcher.fetch(config);
            }

            if (config.jsonPath) {
                const trimmed = html.trimStart();
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    try { html = extractJsonPath(html, config.jsonPath); } catch { /* ignore */ }
                }
            }

            let content: string;
            if (config.isFile) {
                content = html;
            } else {
                const extraPatterns: RegExp[] = [...config.ignorePatterns];
                if (config.ignoreNumbers) extraPatterns.push(NUMBERS_PATTERN);
                const cleaner = new Cleaner({ extraSelectors: config.ignoreSelectors, extraPatterns });
                const $ = cleaner.clean(html);
                const snap = this.parser.extract($, config);
                content = snap.content;
            }

            return content === expectedContent;
        } catch {
            return false;
        }
    }

    /** Fire all alerts and side-effects for a confirmed change. */
    private async dispatchChange(
        report:   DiffReport,
        config:   WatchConfig,
        state:    UrlState,
        snapshot: { rawHtml: string },
        html:     string,
    ): Promise<void> {
        const now = Date.now();

        state.changesCount++;
        state.lastChangeAt = new Date();

        if (!config.dryRun) {
            this.store.saveReport(report);
        }

        console.info(`[${config.label}] ${reportSummary(report)}`);

        if (config.changeThreshold && config.changeThreshold > 0) {
            const previous = this.store.loadLatest(config.url, config.target);
            if (previous) {
                const totalLen   = Math.max(previous.content.length, 1);
                const changedLen = report.changes.reduce(
                    (s, c) => s + Math.max(c.before?.length ?? 0, c.after?.length ?? 0),
                    0,
                );
                if (changedLen / totalLen < config.changeThreshold) {
                    console.debug(`[${config.label}] Change below threshold - suppressed.`);
                    return;
                }
            }
        }

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
                    url:             config.url,
                    label:           config.label,
                    changesInWindow: state.recentChangeTimes.length,
                    windowSeconds:   config.changeSpikeWindow,
                };
                console.warn(`[${config.label}] Change spike: ${info.changesInWindow} changes in ${info.windowSeconds}s`);
                if (config.onSpike) {
                    try { config.onSpike(info); } catch (err) {
                        console.warn("[watchdiff] onSpike callback error:", err);
                    }
                }
            }
        }

        if (config.archiveHtml && !config.dryRun) {
            const storeDir    = this.store.getDirectory?.() ?? ".watchdiff";
            const archiveDir  = join(storeDir, "archive");
            mkdirSync(archiveDir, { recursive: true });
            const urlHash     = createHash("md5").update(config.url).digest("hex").slice(0, 8);
            const ts          = new Date().toISOString().replace(/[:.]/g, "-");
            writeFileSync(join(archiveDir, `${urlHash}_${ts}.html`), snapshot.rawHtml || html, "utf-8");
        }

        if (config.screenshotOnChange && config.browser && !config.dryRun) {
            try {
                const storeDir   = this.store.getDirectory?.() ?? ".watchdiff";
                const archiveDir = join(storeDir, "archive");
                mkdirSync(archiveDir, { recursive: true });
                const urlHash    = createHash("md5").update(config.url).digest("hex").slice(0, 8);
                const ts         = new Date().toISOString().replace(/[:.]/g, "-");
                const buf        = await this.browserFetcher.screenshot(config);
                writeFileSync(join(archiveDir, `${urlHash}_${ts}.png`), buf);
            } catch (err) {
                console.warn(`[${config.label}] Screenshot failed:`, err instanceof Error ? err.message : String(err));
            }
        }

        if (config.alertIf && !config.alertIf(report)) {
            console.debug(`[${config.label}] alertIf returned false - alert suppressed.`);
            return;
        }

        // Failure policy: suppress alerts during recovery period
        if (state.alertsSuppressedByPolicy) {
            console.debug(`[${config.label}] Alert suppressed - waiting for failure policy recovery.`);
            return;
        }

        if (aiSummaryEnabled(config) && !this.aiDisabled.has(config.url)) {
            try {
                report.aiSummary = await generateAiSummary(report, getProvider(config) ?? undefined, config.aiPrompt) ?? undefined;
            } catch (err) {
                if (err instanceof AiError && err.isPermanent) {
                    this.aiDisabled.add(config.url);
                }
            }
        }

        const cooldownMs    = (config.cooldown ?? 0) * 1000;
        const cooldownReady = now - state.lastAlertAt >= cooldownMs;

        if (!cooldownReady) {
            const remaining = Math.ceil((cooldownMs - (now - state.lastAlertAt)) / 1000);
            console.debug(`[${config.label}] Alert suppressed - cooldown active (${remaining}s remaining).`);
            return;
        }

        if (!config.dryRun) {
            state.lastAlertAt = now;

            for (const cb of this.globalCallbacks) {
                try { await cb(report); } catch (err) {
                    console.warn("[watchdiff] Global callback error:", err);
                }
            }

            if (config.alert) {
                await this.notifier.notify(report, config.alert, config.webhookHeaders);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Retention pruning
    // ---------------------------------------------------------------------------

    private pruneByRetention(config: WatchConfig): void {
        if (!config.retentionDays) return;
        const cutoff = Date.now() - config.retentionDays * 86_400_000;
        try {
            const history = this.store.loadHistory(config.url, config.target);
            const retained = history.filter((s) => s.capturedAt.getTime() >= cutoff);
            if (retained.length < history.length) {
                // Re-save only retained snapshots by clearing and re-saving
                this.store.clearHistory(config.url, config.target);
                for (const snap of retained) {
                    this.store.saveSnapshot(snap);
                }
                console.debug(`[${config.label}] Retention pruning: removed ${history.length - retained.length} old snapshot(s).`);
            }
        } catch (err) {
            console.warn(`[${config.label}] Retention pruning error:`, err instanceof Error ? err.message : String(err));
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Retry-After header value.
 * Accepts either a delta-seconds integer or an HTTP-date string.
 * Returns delay in seconds (0 if unparseable).
 */
function parseRetryAfter(value: string): number {
    const trimmed = value.trim();
    const asNum   = Number(trimmed);
    if (!isNaN(asNum) && asNum >= 0) return asNum;

    // Try HTTP-date parsing
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
        return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
    }
    return 0;
}
