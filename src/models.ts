/**
 * WatchDiff models - shared types used across all modules.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ChangeType = "added" | "removed" | "modified" | "unchanged";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type DiffMode = "line" | "semantic" | "word" | "json" | "rss";

export interface BrowserOptions {
    /** Navigation event to wait for before extracting content (default: "domcontentloaded"). */
    waitFor?: "load" | "domcontentloaded" | "networkidle";
    /** Additional CSS selector to wait for after navigation. */
    waitForSelector?: string;
    /** Browser executable path override. */
    executablePath?: string;
}

export interface SmtpConfig {
    host:    string;
    port:    number;
    /** TLS (default true when port=465). */
    secure?: boolean;
    user:    string;
    pass:    string;
}

export interface EmailConfig {
    to:       string | string[];
    /** Defaults to user@host from smtp config. */
    from?:    string;
    /** Defaults to "[WatchDiff] Change detected: {label}". */
    subject?: string;
    smtp:     SmtpConfig;
}

export interface AlertConfig {
    /** Callbacks invoked with a DiffReport on each change. */
    onChange: Array<(report: DiffReport) => void | Promise<void>>;
    /** Webhook URLs - Discord, Slack, Telegram, Teams, ntfy.sh or custom HTTP endpoints. */
    webhooks: string[];
    /** Minimum number of changes required to trigger an alert. */
    minChanges: number;
    /** Number of retry attempts for failed webhook deliveries (default 3, 0 = no retry). */
    webhookRetries?: number;
    /** Email/SMTP alert configuration. */
    email?: EmailConfig;
}

export interface SilenceInfo {
    url: string;
    label: string;
    /** Seconds elapsed since the last detected change (or since monitoring started). */
    secondsSinceLastChange: number;
}

export interface StatusChangeInfo {
    url:            string;
    label:          string;
    previousStatus: number;
    currentStatus:  number;
}

export interface SpikeInfo {
    url: string;
    label: string;
    /** Number of changes detected inside the spike window. */
    changesInWindow: number;
    /** Width of the spike detection window in seconds. */
    windowSeconds: number;
}

// ---------------------------------------------------------------------------
// Maintenance windows
// ---------------------------------------------------------------------------

export interface MaintenanceWindow {
    /** ISO string or Date marking start of maintenance window. */
    from: string | Date;
    /** ISO string or Date marking end of maintenance window. */
    to:   string | Date;
}

// ---------------------------------------------------------------------------
// Active hours
// ---------------------------------------------------------------------------

export interface ActiveBetween {
    /** IANA timezone (e.g. "Europe/Paris"). Defaults to UTC. */
    timezone?: string;
    /** Days of week active. Defaults to all days. */
    days?: Array<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday">;
    /** HH:MM start of active window (e.g. "09:00") */
    from: string;
    /** HH:MM end of active window (e.g. "18:00") */
    to: string;
}

// ---------------------------------------------------------------------------
// Failure policy
// ---------------------------------------------------------------------------

export interface FailurePolicy {
    /** Number of consecutive fetch errors before firing onError/alerts (default 1 = immediate). */
    consecutiveFailures?: number;
    /** Number of consecutive successes required after failures before re-enabling alerts (default 1). */
    recoveryChecks?: number;
    /** Honour the Retry-After header on 429/503 responses (default false). */
    respectRetryAfter?: boolean;
}

export interface WatchConfig {
    url: string;
    /** Stable watcher identity key. When set, storage keys and pause/resume use this instead of URL. */
    id?: string;
    /** CSS selector or XPath expression to narrow monitoring. undefined = full page. */
    target?: string;
    /** Seconds between checks (default 300). */
    interval: number;
    /** Human-readable label shown in logs and reports. */
    label: string;
    /** Extra HTTP headers for this URL. */
    headers: Record<string, string>;
    /** Cookies to send with every request (merged into the Cookie header). */
    cookies?: Record<string, string>;
    /** HTTP timeout in milliseconds (default 15000). */
    timeout: number;
    /** CSS selectors to strip before diffing. */
    ignoreSelectors: string[];
    /** Regex patterns to strip from text before diffing. */
    ignorePatterns: RegExp[];
    /** Use a headless browser (Playwright) to render JS-heavy pages. */
    browser?: boolean;
    /** Options passed to the headless browser. */
    browserOptions?: BrowserOptions;
    /** List of proxy URLs to rotate through (e.g. "http://user:pass@host:port"). */
    proxies?: string[];
    /** List of User-Agent strings to rotate through on each request. */
    userAgents?: string[];
    /** "line" = line-by-line diff (default), "semantic" = diff by semantic blocks,
     *  "word" = word-level diff, "json" = structured JSON diff. */
    diffMode?: DiffMode;
    /** Minimum seconds between two consecutive alerts for this URL (anti-spam). */
    cooldown?: number;
    /** Number of fetch retries on error before giving up (default 0). */
    retries?: number;
    /** Base delay in milliseconds between retries - doubles on each attempt (default 1000). */
    retryDelay?: number;
    /** Interval randomisation factor 0-1. 0.2 = ±20% variance (default 0 = no jitter). */
    jitter?: number;
    /** When true: fetch and diff but do not save snapshots or fire alerts. */
    dryRun?: boolean;
    /** Keep only the last N snapshots per URL (undefined = keep all). */
    maxSnapshots?: number;
    /** Minimum fraction 0-1 of content that must change before alerting (default 0 = any change). */
    changeThreshold?: number;
    /** Strip standalone numbers from text before diffing to ignore counter/date noise. */
    ignoreNumbers?: boolean;
    /** Fire onSilence after this many seconds without a detected change (undefined = disabled). */
    alertIfNoChangeAfter?: number;
    /** Called on every fetch or parse error instead of just logging to console. */
    onError?: (err: Error, config: WatchConfig) => void;
    /** Called when alertIfNoChangeAfter seconds have elapsed without a detected change. */
    onSilence?: (info: SilenceInfo) => void;
    /** Number of retry attempts for failed webhook deliveries (default 3). */
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
    alert?: AlertConfig;
    /** Custom condition: only alert when this function returns true. */
    alertIf?: (report: DiffReport) => boolean;
    /** Generate an AI-powered natural language summary of detected changes. */
    aiSummary?: boolean;
    /**
     * AI provider for summary generation.
     * When omitted, auto-detected from ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY env vars.
     */
    aiProvider?: import("./ai-summarizer/index.js").AiProvider;
    /**
     * Custom prompt sent to the AI instead of the default template.
     * Pass a string for a static prompt, or a function that receives the DiffReport and returns a prompt string.
     * The prompt is sent as-is to the provider - you control the full instruction.
     */
    aiPrompt?: string | ((report: DiffReport) => string | Promise<string>);
    /** Internal flag set by watchFile() - skip HTTP fetch and use FileFetcher. */
    isFile?: boolean;
    /** Expected HTTP status code - fire onError when actual status differs. */
    expectedStatus?: number;
    /** Record HTTP response time on every check (stored in DiffReport). */
    trackResponseTime?: boolean;
    /** Cron expression (5-field) that overrides interval-based scheduling. */
    schedule?: string;
    /** Seconds to wait before confirming a change is real (flapping detection). */
    confirmAfter?: number;
    /** JSON path expression to extract a sub-value before diffing (e.g. "$.data.price"). */
    jsonPath?: string;
    /** Time windows during which checks are skipped entirely. */
    maintenanceWindows?: MaintenanceWindow[];
    /** Restrict monitoring to specific hours/days of the week. */
    activeBetween?: ActiveBetween;
    /** Policy controlling how many consecutive failures are needed before alerting. */
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
}

export function makeWatchConfig(
    url: string,
    opts: Partial<Omit<WatchConfig, "url">> = {}
): WatchConfig {
    return {
        url,
        id:                     opts.id,
        target:                 opts.target,
        interval:               opts.interval ?? 300,
        label:                  opts.label ?? url,
        headers:                opts.headers ?? {},
        cookies:                opts.cookies,
        timeout:                opts.timeout ?? 15_000,
        ignoreSelectors:        opts.ignoreSelectors ?? [],
        ignorePatterns:         opts.ignorePatterns ?? [],
        browser:                opts.browser,
        browserOptions:         opts.browserOptions,
        proxies:                opts.proxies,
        userAgents:             opts.userAgents,
        diffMode:               opts.diffMode,
        cooldown:               opts.cooldown,
        retries:                opts.retries,
        retryDelay:             opts.retryDelay,
        jitter:                 opts.jitter,
        dryRun:                 opts.dryRun,
        maxSnapshots:           opts.maxSnapshots,
        changeThreshold:        opts.changeThreshold,
        ignoreNumbers:          opts.ignoreNumbers,
        alertIfNoChangeAfter:   opts.alertIfNoChangeAfter,
        onError:                opts.onError,
        onSilence:              opts.onSilence,
        webhookRetries:         opts.webhookRetries,
        archiveHtml:            opts.archiveHtml,
        screenshotOnChange:     opts.screenshotOnChange,
        changeSpikeWindow:      opts.changeSpikeWindow,
        changeSpikeThreshold:   opts.changeSpikeThreshold,
        onSpike:                opts.onSpike,
        alertOnStatusChange:    opts.alertOnStatusChange,
        onStatusChange:         opts.onStatusChange,
        alert:                  opts.alert,
        alertIf:                opts.alertIf,
        aiSummary:              opts.aiSummary,
        aiProvider:             opts.aiProvider,
        aiPrompt:               opts.aiPrompt,
        isFile:                 opts.isFile,
        expectedStatus:         opts.expectedStatus,
        trackResponseTime:      opts.trackResponseTime,
        schedule:               opts.schedule,
        confirmAfter:           opts.confirmAfter,
        jsonPath:               opts.jsonPath,
        maintenanceWindows:     opts.maintenanceWindows,
        activeBetween:          opts.activeBetween,
        failurePolicy:          opts.failurePolicy,
        onRecovery:             opts.onRecovery,
        maxRetryDelay:          opts.maxRetryDelay,
        alertOnFirstCheck:      opts.alertOnFirstCheck,
        webhookHeaders:         opts.webhookHeaders,
        retentionDays:          opts.retentionDays,
    };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface Snapshot {
    url: string;
    target: string | undefined;
    /** Cleaned, normalised plain-text content. */
    content: string;
    /** Raw HTML of the extracted zone (before text conversion). */
    rawHtml: string;
    capturedAt: Date;
    checksum: string;
}

export function makeSnapshot(
    url: string,
    target: string | undefined,
    content: string,
    rawHtml: string
): Snapshot {
    const checksum = createHash("sha256").update(content).digest("hex");
    return { url, target, content, rawHtml, capturedAt: new Date(), checksum };
}

export function snapshotsIdentical(a: Snapshot, b: Snapshot): boolean {
    return a.checksum === b.checksum;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface Change {
    kind: ChangeType;
    before?: string;
    after?: string;
    /** Surrounding text hint for context (also used as JSON key path in "json" mode). */
    context?: string;
}

export function changeHuman(change: Change): string {
    const ctx = change.context ? ` (${change.context})` : "";
    switch (change.kind) {
        case "added":
            return `[+] Added${ctx}: ${JSON.stringify(change.after)}`;
        case "removed":
            return `[-] Removed${ctx}: ${JSON.stringify(change.before)}`;
        case "modified":
            return `[~] Changed${ctx}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`;
        default:
            return "[=] Unchanged";
    }
}

export interface DiffReport {
    url: string;
    target: string | undefined;
    label: string;
    before: Snapshot;
    after: Snapshot;
    changes: Change[];
    comparedAt: Date;
    /** AI-generated natural language summary (populated when aiSummary is enabled). */
    aiSummary?: string;
    /** HTTP response time in ms (populated when trackResponseTime is enabled). */
    responseTimeMs?: number;
}

export function reportHasChanges(report: DiffReport): boolean {
    return report.changes.length > 0;
}

export function reportSummary(report: DiffReport): string {
    if (!reportHasChanges(report)) {
        return `[${report.label}] No changes detected.`;
    }
    const added             = report.changes.filter((c) => c.kind === "added").length;
    const removed           = report.changes.filter((c) => c.kind === "removed").length;
    const modified          = report.changes.filter((c) => c.kind === "modified").length;
    const parts: string[]   = [];
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    if (modified) parts.push(`${modified} modified`);
    const ts = report.comparedAt.toISOString().replace("T", " ").slice(0, 19);
    return `[${report.label}] ${parts.join(", ")} - ${ts} UTC`;
}

export function reportAsDict(report: DiffReport): Record<string, unknown> {
    return {
        url: report.url,
        target: report.target,
        label: report.label,
        comparedAt: report.comparedAt.toISOString(),
        changes: report.changes.map((c) => ({
            kind: c.kind,
            before: c.before,
            after: c.after,
            context: c.context,
        })),
    };
}

// ---------------------------------------------------------------------------
// Watcher status
// ---------------------------------------------------------------------------

export interface WatcherStatus {
    url: string;
    /** Stable watcher ID (set via WatchOptions.id). Undefined when not configured. */
    id?: string;
    label: string;
    target: string | undefined;
    interval: number;
    paused: boolean;
    /** Whether the watcher is currently inside a maintenance window. */
    inMaintenance: boolean;
    /** Timestamp of the last completed check (null = never checked). */
    lastCheckAt: Date | null;
    /** Estimated timestamp of the next scheduled check. */
    nextCheckAt: Date | null;
    /** Timestamp of the last detected change (null = no change seen yet). */
    lastChangeAt: Date | null;
    /** Total number of checks performed since start. */
    checksCount: number;
    /** Total number of checks that produced at least one change. */
    changesCount: number;
    /** Total number of fetch or parse errors since start. */
    errorsCount: number;
    /** Last known HTTP status code (0 = unknown / unreachable, 200 = ok). */
    lastStatusCode: number;
}

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

/** Common interface implemented by both Store (JSON) and SqliteStore. */
export interface IStore {
    saveSnapshot(snapshot: Snapshot): void;
    loadLatest(url: string, target: string | undefined): Snapshot | null;
    loadHistory(url: string, target: string | undefined, limit?: number): Snapshot[];
    clearHistory(url: string, target: string | undefined): void;
    saveReport(report: DiffReport): void;
    loadReports(url: string, target: string | undefined, limit?: number): Record<string, unknown>[];
    /** Optional: prune oldest snapshots, keeping only the last `max` entries. */
    pruneSnapshots?(url: string, target: string | undefined, max: number): void;
    /** Optional: return the base storage directory (used for HTML/screenshot archiving). */
    getDirectory?(): string;
}
