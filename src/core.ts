/**
 * WatchDiff - high-level public facade.
 *
 * Usage:
 *   import { WatchDiff } from "watchdiff-core";
 *
 *   const wd = new WatchDiff();
 *   wd.watch("https://example.com/product", { target: ".price", interval: 60 });
 *   wd.onChange((report) => console.log(report));
 *   wd.start();
 */

import {
    makeWatchConfig,
    reportSummary,
    type ActiveBetween,
    type AlertConfig,
    type BrowserOptions,
    type DiffMode,
    type DiffReport,
    type FailurePolicy,
    type IStore,
    type MaintenanceWindow,
    type SilenceInfo,
    type SpikeInfo,
    type StatusChangeInfo,
    type Snapshot,
    type WatchConfig,
    type WatcherStatus,
} from "./models.js";
import {
    makeDbWatchConfig,
    type DbDiffMode,
    type DbDiffReport,
    type DbWatchConfig,
    type SchemaChangeInfo,
    type ThresholdInfo,
} from "./db-models.js";
import {
    makeCertWatchConfig,
    type CertExpiryInfo,
    type CertChangeInfo,
    type CertWatchConfig,
    type CertWatcherStatus,
} from "./cert-models.js";
import {
    type SitemapDiffReport,
    type SitemapEntry,
    type SitemapWatchConfig,
} from "./sitemap-models.js";
import { Scheduler }      from "./scheduler/index.js";
import { DbScheduler, type DbWatcherStatus } from "./db-scheduler/index.js";
import { CertScheduler }  from "./cert-scheduler/index.js";
import { SitemapScheduler, type SitemapWatcherStatus } from "./sitemap-scheduler/index.js";
import { Store }          from "./store/index.js";
import { Exporter }       from "./exporter/index.js";
import { StatusServer }   from "./status-server/index.js";

export interface WatchOptions {
    /** Stable watcher identity key. Allows multiple watchers on the same URL and targeted pause/resume. */
    id?: string;
    /** CSS selector or XPath expression - undefined = full page. */
    target?: string;
    /** Seconds between checks (default 300). */
    interval?: number;
    /** Human-readable label. */
    label?: string;
    /** Extra HTTP headers. */
    headers?: Record<string, string>;
    /** Cookies to send with every request (merged into the Cookie header). */
    cookies?: Record<string, string>;
    /** HTTP timeout in milliseconds (default 15000). */
    timeout?: number;
    /** CSS selectors to strip before diffing. */
    ignoreSelectors?: string[];
    /** Regex patterns to strip from text before diffing. */
    ignorePatterns?: RegExp[];
    /** Use a headless browser (Playwright) for JS-heavy pages. */
    browser?: boolean;
    /** Options for the headless browser. */
    browserOptions?: BrowserOptions;
    /** List of proxy URLs to rotate through. */
    proxies?: string[];
    /** List of User-Agent strings to rotate through. */
    userAgents?: string[];
    /** Diff granularity: "line" (default), "semantic", "word", or "json". */
    diffMode?: DiffMode;
    /** Callback(s) invoked with a DiffReport on each change. */
    onChange?: ((report: DiffReport) => void | Promise<void>) | Array<(report: DiffReport) => void | Promise<void>>;
    /** Webhook URLs (Discord / Slack / Telegram / Teams / ntfy.sh / custom). */
    webhooks?: string[];
    /** Minimum changes required to trigger an alert. */
    minChanges?: number;
    /** Minimum seconds between two consecutive alerts for this URL (anti-spam). */
    cooldown?: number;
    /** Number of fetch retries on error before giving up (default 0). */
    retries?: number;
    /** Base delay in milliseconds between retries - doubles on each attempt (default 1000). */
    retryDelay?: number;
    /** Interval randomisation factor 0-1. 0.2 = ±20% variance (default 0). */
    jitter?: number;
    /** When true: fetch and diff but do not save snapshots or fire alerts. */
    dryRun?: boolean;
    /** Keep only the last N snapshots per URL (undefined = keep all). */
    maxSnapshots?: number;
    /** Minimum fraction 0-1 of content that must change before alerting (default 0). */
    changeThreshold?: number;
    /** Strip standalone numbers from text before diffing to ignore counter/date noise. */
    ignoreNumbers?: boolean;
    /** Fire onSilence after this many seconds without a detected change (undefined = disabled). */
    alertIfNoChangeAfter?: number;
    /** Called on every fetch or parse error. */
    onError?: (err: Error, config: WatchConfig) => void;
    /** Called when alertIfNoChangeAfter seconds have elapsed without a detected change. */
    onSilence?: (info: SilenceInfo) => void;
    /** Number of retry attempts for failed webhook deliveries (default 3, 0 = no retry). */
    webhookRetries?: number;
    /** Save the full-page HTML to disk whenever a change is detected. */
    archiveHtml?: boolean;
    /** Capture a PNG screenshot on change (requires browser: true). */
    screenshotOnChange?: boolean;
    /** Spike detection: time window in seconds to count changes. */
    changeSpikeWindow?: number;
    /** Spike detection: alert when this many changes occur inside changeSpikeWindow. */
    changeSpikeThreshold?: number;
    /** Called when a change spike is detected. */
    onSpike?: (info: SpikeInfo) => void;
    /** Alert when the HTTP status code changes (e.g. 200 → 503 or 503 → 200). */
    alertOnStatusChange?: boolean;
    /** Called when the HTTP status code changes. */
    onStatusChange?: (info: StatusChangeInfo) => void;
    /** Only fire alerts when this custom condition returns true. */
    alertIf?: (report: DiffReport) => boolean;
    /** Generate an AI-powered natural language summary of detected changes. */
    aiSummary?: boolean;
    /**
     * AI provider for summary generation.
     * When omitted, auto-detected from ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY env vars.
     * Use type "custom" with a callAi function for any other provider or local model.
     */
    aiProvider?: import("./ai-summarizer/index.js").AiProvider;
    /** Expected HTTP status code - fire onError when actual status differs. */
    expectedStatus?: number;
    /** Record HTTP response time on every check (stored in DiffReport). */
    trackResponseTime?: boolean;
    /** Cron expression (5-field) that overrides interval-based scheduling. */
    schedule?: string;
    /** Seconds to wait before confirming a change is real (flapping detection). */
    confirmAfter?: number;
    /** JSON path to extract a sub-value before diffing (e.g. "$.data.price"). */
    jsonPath?: string;
    /** Custom prompt sent to the AI instead of the default template. */
    aiPrompt?: string | ((report: DiffReport) => string | Promise<string>);
    /** Time windows during which checks are skipped entirely. */
    maintenanceWindows?: MaintenanceWindow[];
    /** Restrict monitoring to specific hours/days of the week. */
    activeBetween?: ActiveBetween;
    /** Policy controlling consecutive failures/recoveries before alerting. */
    failurePolicy?: FailurePolicy;
    /** Called when a watcher recovers after a consecutive-failure streak. */
    onRecovery?: (config: WatchConfig) => void;
    /** Cap on exponential backoff delay in ms (default: Infinity). */
    maxRetryDelay?: number;
    /** Fire onChange on the very first snapshot capture (default false). */
    alertOnFirstCheck?: boolean;
    /** Extra headers merged into every outgoing webhook POST. */
    webhookHeaders?: Record<string, string>;
    /** Auto-delete snapshots older than N days after each save. */
    retentionDays?: number;
    /** HTTP Basic Auth credentials - adds an Authorization: Basic header. */
    auth?: { user: string; pass: string };
    /** Async callback fired before every fetch tick. A thrown error logs a warning but does not skip the check. */
    onBeforeCheck?: (config: WatchConfig) => void | Promise<void>;
    /** When set, switches the fetcher to POST. String bodies are sent as-is; objects are JSON-serialised. */
    requestBody?: string | Record<string, unknown>;
    /** Tags for grouping watchers (e.g. ["prod", "prices"]). Use wd.pause("prod") to pause by group. */
    tags?: string[];
    /** Minimum seconds between two consecutive checks (floor on interval/jitter). */
    minInterval?: number;
    /** When true, skip SSRF checks for URLs pointing to private/loopback addresses (for internal monitoring). */
    allowPrivateUrls?: boolean;
    /** Maximum response body size in bytes (default: 10MB). */
    maxResponseSize?: number;
}

export interface WatchFileOptions {
    interval?:        number;
    label?:           string;
    diffMode?:        DiffMode;
    ignorePatterns?:  RegExp[];
    cooldown?:        number;
    dryRun?:          boolean;
    maxSnapshots?:    number;
    changeThreshold?: number;
    ignoreNumbers?:   boolean;
    onChange?:        ((report: DiffReport) => void | Promise<void>) | Array<(report: DiffReport) => void | Promise<void>>;
    webhooks?:        string[];
    webhookRetries?:  number;
    alertIf?:         (report: DiffReport) => boolean;
    aiSummary?:       boolean;
    aiProvider?:      import("./ai-summarizer/index.js").AiProvider;
    aiPrompt?:        string | ((report: DiffReport) => string | Promise<string>);
    onError?:         (err: Error, config: WatchConfig) => void;
    schedule?:        string;
    confirmAfter?:    number;
    jsonPath?:        string;
}

export interface WatchApiOptions extends WatchOptions {
    /** Expected HTTP status code - alert when response differs (default 200). */
    expectedStatus?:     number;
    /** Record and expose HTTP response time in DiffReport. */
    trackResponseTime?:  boolean;
}

export interface WatchCertOptions {
    port?:                number;
    interval?:            number;
    label?:               string;
    warnDaysBeforeExpiry?: number;
    alertOnExpiry?:       boolean;
    alertOnChange?:       boolean;
    cooldown?:            number;
    dryRun?:              boolean;
    webhooks?:            string[];
    webhookRetries?:      number;
    onExpiry?:            (info: CertExpiryInfo)  => void | Promise<void>;
    onChange?:            (info: CertChangeInfo)  => void | Promise<void>;
    onError?:             (err: Error, config: CertWatchConfig) => void;
}

export interface WatchSitemapOptions {
    label?:      string;
    interval?:   number;
    onAdded?:    (entries: SitemapEntry[]) => void;
    onRemoved?:  (entries: SitemapEntry[]) => void;
    onChange?:   (report: SitemapDiffReport) => void;
    onError?:    (err: Error) => void;
}

export interface DbWatchOptions {
    /** Custom SELECT query : overrides the default `SELECT * FROM <table>`. */
    query?:          string;
    /** Column(s) that uniquely identify a row (default: first column). */
    primaryKey?:     string[];
    /** Columns to exclude from comparison. */
    ignoreColumns?:  string[];
    /** Diff strategy: "row" (default), "schema", "aggregate", or "value". */
    diffMode?:       DbDiffMode;
    /** Seconds between checks (default 300). */
    interval?:       number;
    /** Human-readable label. */
    label?:          string;
    dryRun?:         boolean;
    cooldown?:       number;
    maxSnapshots?:   number;
    alertOnInsert?:  boolean;
    alertOnDelete?:  boolean;
    alertOnUpdate?:  boolean;
    /** Alert threshold % for aggregate mode (0 = any change). */
    threshold?:      number;
    webhooks?:       string[];
    webhookRetries?: number;
    onChange?:       (report: DbDiffReport) => void | Promise<void>;
    onError?:        (err: Error, config: DbWatchConfig) => void;
    onSchemaChange?: (info: SchemaChangeInfo) => void;
    onThreshold?:    (info: ThresholdInfo) => void;
    /** Generate an AI-powered summary of detected DB changes. */
    aiSummary?:      boolean;
    /** AI provider - auto-detected from env vars when omitted. */
    aiProvider?:     import("./ai-summarizer/index.js").AiProvider;
}

export interface WatchDiffOptions {
    /** Directory for JSON storage (default ".watchdiff"). Ignored when a custom store is provided. */
    storageDir?: string;
    /** Custom store (e.g. SqliteStore). Overrides storageDir. */
    store?: IStore;
    /** Maximum number of simultaneous in-flight checks (default: unlimited). */
    concurrency?: number;
    /** Global floor on minimum seconds between checks. Applied to all watchers that don't set their own minInterval. */
    minInterval?: number;
    /** Maximum number of watchers allowed. Throws when exceeded (default: no limit). Recommended max: 1000. */
    maxWatchers?: number;
}

export class WatchDiff {
    private readonly store: IStore;
    private readonly concurrency: number | undefined;
    private readonly minInterval: number;
    private readonly maxWatchers: number | undefined;
    private readonly configs: WatchConfig[]                                                = [];
    private readonly dbConfigs: DbWatchConfig[]                                           = [];
    private readonly certConfigs: CertWatchConfig[]                                       = [];
    private readonly sitemapConfigs: SitemapWatchConfig[]                                 = [];
    private readonly globalCallbacks: Array<(report: DiffReport) => void | Promise<void>> = [];
    private scheduler:        Scheduler        | null = null;
    private dbScheduler:      DbScheduler      | null = null;
    private certScheduler:    CertScheduler    | null = null;
    private sitemapScheduler: SitemapScheduler | null = null;
    private stopFn:           (() => void)     | null = null;
    private dbStopFn:         (() => void)     | null = null;
    private certStopFn:       (() => void)     | null = null;
    private sitemapStopFn:    (() => void)     | null = null;
    private statusServer:     StatusServer     | null = null;

    /**
     * @param optsOrStorageDir - WatchDiffOptions object, or storage dir string for backward compat.
     * @param store            - Custom store (e.g. SqliteStore). Only used when first arg is a string.
     *
     * @example
     *   new WatchDiff()                              // defaults
     *   new WatchDiff(".watchdiff")                  // backward-compat string
     *   new WatchDiff({ concurrency: 10 })           // options object
     *   new WatchDiff({ storageDir: ".wd", store })  // full options
     */
    constructor(optsOrStorageDir: WatchDiffOptions | string = ".watchdiff", store?: IStore) {
        if (typeof optsOrStorageDir === "string") {
            this.store       = store ?? new Store(optsOrStorageDir);
            this.concurrency = undefined;
            this.minInterval = 0;
            this.maxWatchers = undefined;
        } else {
            const opts       = optsOrStorageDir;
            this.store       = opts.store ?? new Store(opts.storageDir ?? ".watchdiff");
            this.concurrency = opts.concurrency;
            this.minInterval = opts.minInterval ?? 0;
            this.maxWatchers = opts.maxWatchers;
        }
    }

    // ------------------------------------------------------------------
    // Configuration API
    // ------------------------------------------------------------------

    /**
     * Register a URL to monitor. Returns `this` for chaining.
     */
    watch(url: string, opts: WatchOptions = {}): this {
        // L-1: Enforce maxWatchers limit
        if (this.maxWatchers && this.configs.length >= this.maxWatchers) {
            throw new Error(`watchdiff: maxWatchers limit (${this.maxWatchers}) reached`);
        }

        const callbacks = opts.onChange
            ? Array.isArray(opts.onChange)
                ? opts.onChange
                : [opts.onChange]
            : [];

        const alert: AlertConfig | undefined =
            callbacks.length > 0 || (opts.webhooks?.length ?? 0) > 0
                ? {
                    onChange:       callbacks,
                    webhooks:       opts.webhooks ?? [],
                    minChanges:     opts.minChanges ?? 1,
                    webhookRetries: opts.webhookRetries,
                }
                : undefined;

        this.configs.push(
            makeWatchConfig(url, {
                id:                   opts.id,
                target:               opts.target,
                interval:             opts.interval,
                label:                opts.label,
                headers:              opts.headers,
                cookies:              opts.cookies,
                timeout:              opts.timeout,
                ignoreSelectors:      opts.ignoreSelectors,
                ignorePatterns:       opts.ignorePatterns,
                browser:              opts.browser,
                browserOptions:       opts.browserOptions,
                proxies:              opts.proxies,
                userAgents:           opts.userAgents,
                diffMode:             opts.diffMode,
                cooldown:             opts.cooldown,
                retries:              opts.retries,
                retryDelay:           opts.retryDelay,
                jitter:               opts.jitter,
                dryRun:               opts.dryRun,
                maxSnapshots:         opts.maxSnapshots,
                changeThreshold:      opts.changeThreshold,
                ignoreNumbers:        opts.ignoreNumbers,
                alertIfNoChangeAfter: opts.alertIfNoChangeAfter,
                onError:              opts.onError,
                onSilence:            opts.onSilence,
                archiveHtml:          opts.archiveHtml,
                screenshotOnChange:   opts.screenshotOnChange,
                changeSpikeWindow:    opts.changeSpikeWindow,
                changeSpikeThreshold: opts.changeSpikeThreshold,
                onSpike:              opts.onSpike,
                alertOnStatusChange:  opts.alertOnStatusChange,
                onStatusChange:       opts.onStatusChange,
                alertIf:              opts.alertIf,
                aiSummary:            opts.aiSummary,
                aiProvider:           opts.aiProvider,
                aiPrompt:             opts.aiPrompt,
                expectedStatus:       opts.expectedStatus,
                trackResponseTime:    opts.trackResponseTime,
                schedule:             opts.schedule,
                confirmAfter:         opts.confirmAfter,
                jsonPath:             opts.jsonPath,
                maintenanceWindows:   opts.maintenanceWindows,
                activeBetween:        opts.activeBetween,
                failurePolicy:        opts.failurePolicy,
                onRecovery:           opts.onRecovery,
                maxRetryDelay:        opts.maxRetryDelay,
                alertOnFirstCheck:    opts.alertOnFirstCheck,
                webhookHeaders:       opts.webhookHeaders,
                retentionDays:        opts.retentionDays,
                auth:                 opts.auth,
                onBeforeCheck:        opts.onBeforeCheck,
                requestBody:          opts.requestBody,
                tags:                 opts.tags,
                minInterval:          opts.minInterval,
                allowPrivateUrls:     opts.allowPrivateUrls,
                maxResponseSize:      opts.maxResponseSize,
                alert,
            })
        );

        return this;
    }

    /**
     * Register a local file or directory to monitor for changes. Returns `this` for chaining.
     * Uses `file://` prefix internally; no HTTP request is made.
     */
    watchFile(path: string, opts: WatchFileOptions = {}): this {
        const callbacks = opts.onChange
            ? Array.isArray(opts.onChange) ? opts.onChange : [opts.onChange]
            : [];

        const alert: AlertConfig | undefined =
            callbacks.length > 0 || (opts.webhooks?.length ?? 0) > 0
                ? { onChange: callbacks, webhooks: opts.webhooks ?? [], minChanges: 1, webhookRetries: opts.webhookRetries }
                : undefined;

        this.configs.push(
            makeWatchConfig(`file://${path}`, {
                label:            opts.label ?? path,
                interval:         opts.interval,
                diffMode:         opts.diffMode,
                ignorePatterns:   opts.ignorePatterns,
                cooldown:         opts.cooldown,
                dryRun:           opts.dryRun,
                maxSnapshots:     opts.maxSnapshots,
                changeThreshold:  opts.changeThreshold,
                ignoreNumbers:    opts.ignoreNumbers,
                alertIf:          opts.alertIf,
                aiSummary:        opts.aiSummary,
                aiProvider:       opts.aiProvider,
                aiPrompt:         opts.aiPrompt,
                onError:          opts.onError,
                isFile:           true,
                schedule:         opts.schedule,
                confirmAfter:     opts.confirmAfter,
                jsonPath:         opts.jsonPath,
                alert,
            })
        );

        return this;
    }

    /**
     * Register a REST/JSON API endpoint to monitor. Returns `this` for chaining.
     * Defaults to JSON diff mode, tracks response time, and validates expected HTTP status.
     */
    watchApi(url: string, opts: WatchApiOptions = {}): this {
        return this.watch(url, {
            diffMode:          "json",
            trackResponseTime: opts.trackResponseTime ?? true,
            ...opts,
        });
    }

    /**
     * Register an SSL/TLS certificate to monitor. Returns `this` for chaining.
     * Alerts when the certificate is about to expire or when the fingerprint changes.
     */
    watchCert(hostname: string, opts: WatchCertOptions = {}): this {
        this.certConfigs.push(makeCertWatchConfig(hostname, opts));
        return this;
    }

    /**
     * Register a sitemap URL to monitor for added/removed URLs. Returns `this` for chaining.
     */
    watchSitemap(url: string, options: WatchSitemapOptions = {}): this {
        this.sitemapConfigs.push({
            url,
            label:      options.label     ?? url,
            interval:   options.interval  ?? 3600,
            onAdded:    options.onAdded,
            onRemoved:  options.onRemoved,
            onChange:   options.onChange,
            onError:    options.onError,
        });
        return this;
    }

    /**
     * Register a database table to monitor for changes. Returns `this` for chaining.
     *
     * Supported connection strings:
     *   sqlite://./path/to/db.sqlite
     *   postgresql://user:pass@host:5432/dbname
     *   mysql://user:pass@host:3306/dbname
     */
    watchDb(connectionString: string, table: string, opts: DbWatchOptions = {}): this {
        this.dbConfigs.push(makeDbWatchConfig(connectionString, table, opts));
        return this;
    }

    /**
     * Register a global callback fired whenever ANY watched URL changes.
     * Returns `this` for chaining.
     */
    onChange(callback: (report: DiffReport) => void | Promise<void>): this {
        this.globalCallbacks.push(callback);
        return this;
    }

    // ------------------------------------------------------------------
    // Run API
    // ------------------------------------------------------------------

    /**
     * Start continuous monitoring.
     *
     * Returns a `stop()` function. The process will keep running until
     * `stop()` is called or the process is killed.
     */
    start(): () => void {
        if (
            this.configs.length === 0 &&
            this.dbConfigs.length === 0 &&
            this.certConfigs.length === 0 &&
            this.sitemapConfigs.length === 0
        ) {
            console.warn("[watchdiff] No watchers registered. Call .watch(), .watchFile(), .watchApi(), .watchDb(), .watchCert(), or .watchSitemap() first.");
            return () => { };
        }

        if (this.configs.length > 0) {
            this.scheduler = new Scheduler(this.store, this.concurrency, this.minInterval);
            for (const cb of this.globalCallbacks) {
                this.scheduler.addGlobalCallback(cb);
            }
            this.stopFn = this.scheduler.start(this.configs);
        }

        if (this.dbConfigs.length > 0) {
            this.dbScheduler = new DbScheduler(this.store);
            this.dbStopFn    = this.dbScheduler.start(this.dbConfigs);
        }

        if (this.certConfigs.length > 0) {
            this.certScheduler = new CertScheduler();
            this.certStopFn    = this.certScheduler.start(this.certConfigs);
        }

        if (this.sitemapConfigs.length > 0) {
            this.sitemapScheduler = new SitemapScheduler();
            this.sitemapStopFn   = this.sitemapScheduler.start(this.sitemapConfigs);
        }

        return () => this.stop();
    }

    /**
     * Stop all watchers.
     */
    stop(): void {
        this.stopFn?.();
        this.stopFn = null;
        this.dbStopFn?.();
        this.dbStopFn = null;
        this.certStopFn?.();
        this.certStopFn = null;
        this.sitemapStopFn?.();
        this.sitemapStopFn = null;
    }

    /**
     * Run a single immediate check for a registered URL.
     *
     * @throws Error if the URL is not registered.
     */
    async checkOnce(url: string): Promise<DiffReport | null> {
        const config = this.findConfig(url);
        const sched  = new Scheduler(this.store);
        return sched.checkOnce(config);
    }

    // ------------------------------------------------------------------
    // Pause / Resume
    // ------------------------------------------------------------------

    /**
     * Pause a watcher by URL, stable ID, or tag.
     * When the argument matches a tag, all watchers with that tag are paused.
     * No-op if monitoring has not started yet.
     */
    pause(urlOrIdOrTag: string): void {
        this.scheduler?.pause(urlOrIdOrTag);
    }

    /**
     * Resume a previously paused watcher by URL, stable ID, or tag.
     * When the argument matches a tag, all watchers with that tag are resumed.
     */
    resume(urlOrIdOrTag: string): void {
        this.scheduler?.resume(urlOrIdOrTag);
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    /**
     * Return runtime status for all registered watchers.
     */
    status(): WatcherStatus[] {
        if (!this.scheduler) {
            return this.configs.map((c) => ({
                url:            c.url,
                id:             c.id,
                label:          c.label,
                target:         c.target,
                interval:       c.interval,
                paused:         false,
                inMaintenance:  false,
                lastCheckAt:    null,
                nextCheckAt:    null,
                lastChangeAt:   null,
                checksCount:    0,
                changesCount:   0,
                errorsCount:    0,
                lastStatusCode: 0,
            }));
        }
        return this.scheduler.getStatuses(this.configs);
    }

    /**
     * Return runtime status for all registered DB watchers.
     */
    getDbStatuses(): DbWatcherStatus[] {
        return this.dbScheduler?.getStatuses() ?? [];
    }

    /**
     * Return runtime status for all registered certificate watchers.
     */
    getCertStatuses(): CertWatcherStatus[] {
        return this.certScheduler?.getStatuses(this.certConfigs) ?? [];
    }

    /**
     * Return runtime status for all registered sitemap watchers.
     */
    getSitemapStatuses(): SitemapWatcherStatus[] {
        return this.sitemapScheduler?.getStatuses(this.sitemapConfigs) ?? [];
    }

    // ------------------------------------------------------------------
    // History / audit API
    // ------------------------------------------------------------------

    history(url: string, limit = 20): Snapshot[] {
        const config = this.findConfig(url);
        return this.store.loadHistory(config.url, config.target, limit);
    }

    reports(url: string, limit = 20): Record<string, unknown>[] {
        const config = this.findConfig(url);
        return this.store.loadReports(config.url, config.target, limit);
    }

    clear(url: string): void {
        const config = this.findConfig(url);
        this.store.clearHistory(config.url, config.target);
    }

    // ------------------------------------------------------------------
    // Export API
    // ------------------------------------------------------------------

    /**
     * Export diff reports for a URL to CSV string.
     */
    exportReportsCsv(url: string, limit = 100): string {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.reportsToCsv(config.url, config.target, limit);
    }

    /**
     * Export snapshot history for a URL to CSV string.
     */
    exportSnapshotsCsv(url: string, limit = 100): string {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.snapshotsToCsv(config.url, config.target, limit);
    }

    /**
     * Export diff reports for a URL as a JSON string.
     */
    exportReportsJson(url: string, limit = 100): string {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.exportReportsJson(config.url, config.target, limit);
    }

    /**
     * Export snapshot history for a URL as a JSON string.
     */
    exportSnapshotsJson(url: string, limit = 100): string {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.exportSnapshotsJson(config.url, config.target, limit);
    }

    /**
     * Export diff reports for a URL to an XLSX Buffer.
     * Requires: npm install exceljs
     */
    async exportReportsXlsx(url: string, limit = 100): Promise<Buffer> {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.reportsToXlsx(config.url, config.target, limit);
    }

    /**
     * Export snapshot history for a URL to an XLSX Buffer.
     * Requires: npm install exceljs
     */
    async exportSnapshotsXlsx(url: string, limit = 100): Promise<Buffer> {
        const config   = this.findConfig(url);
        const exporter = new Exporter(this.store);
        return exporter.snapshotsToXlsx(config.url, config.target, limit);
    }

    // ------------------------------------------------------------------
    // Status server
    // ------------------------------------------------------------------

    /**
     * Start a built-in HTTP status server.
     * Endpoints: GET /health, /status, /metrics (Prometheus).
     */
    startStatusServer(port = 9090, bindHost?: string): void {
        if (this.statusServer) {
            console.warn("[watchdiff] Status server already running.");
            return;
        }
        this.statusServer = new StatusServer(bindHost);
        this.statusServer.start(port, () => this.status());
    }

    stopStatusServer(): void {
        this.statusServer?.stop();
        this.statusServer = null;
    }

    // ------------------------------------------------------------------
    // Compare two URLs (one-shot)
    // ------------------------------------------------------------------

    /**
     * Fetch and diff two arbitrary URLs without any persistent storage.
     * Uses dynamic imports to load internal modules lazily.
     */
    async compareUrls(urlA: string, urlB: string, opts: WatchOptions = {}): Promise<DiffReport> {
        const { Fetcher }     = await import("./fetcher/index.js");
        const { BrowserFetcher } = await import("./fetcher/browser.js");
        const { Cleaner }     = await import("./cleaner/index.js");
        const { Parser }      = await import("./parser/index.js");
        const { DiffEngine }  = await import("./diff/index.js");

        const configA = makeWatchConfig(urlA, opts as Partial<Omit<WatchConfig, "url">>);
        const configB = makeWatchConfig(urlB, opts as Partial<Omit<WatchConfig, "url">>);

        const fetcher        = configA.browser ? new BrowserFetcher() : new Fetcher();
        const cleaner        = new Cleaner({ extraSelectors: configA.ignoreSelectors, extraPatterns: configA.ignorePatterns });
        const parser         = new Parser();
        const engine         = new DiffEngine();

        const htmlA = await (fetcher as { fetch(c: WatchConfig): Promise<string> }).fetch(configA);
        const htmlB = await (fetcher as { fetch(c: WatchConfig): Promise<string> }).fetch(configB);

        const $A = cleaner.clean(htmlA);
        const $B = cleaner.clean(htmlB);

        const snapA = parser.extract($A, configA);
        const snapB = parser.extract($B, configB);

        return engine.compare(snapA, snapB, configA);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    private findConfig(url: string): WatchConfig {
        const config = this.configs.find((c) => c.url === url);
        if (!config) {
            throw new Error(`URL not registered: ${JSON.stringify(url)}. Call .watch() first.`);
        }
        return config;
    }
}
