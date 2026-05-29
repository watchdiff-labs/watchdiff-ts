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

export type DiffMode = "line" | "semantic" | "word" | "json";

export interface BrowserOptions {
    /** Navigation event to wait for before extracting content (default: "domcontentloaded"). */
    waitFor?: "load" | "domcontentloaded" | "networkidle";
    /** Additional CSS selector to wait for after navigation. */
    waitForSelector?: string;
    /** Browser executable path override. */
    executablePath?: string;
}

export interface AlertConfig {
    /** Callbacks invoked with a DiffReport on each change. */
    onChange: Array<(report: DiffReport) => void | Promise<void>>;
    /** Webhook URLs - Discord, Slack, Telegram, Teams, ntfy.sh or custom HTTP endpoints. */
    webhooks: string[];
    /** Minimum number of changes required to trigger an alert. */
    minChanges: number;
}

export interface SilenceInfo {
    url: string;
    label: string;
    /** Seconds elapsed since the last detected change (or since monitoring started). */
    secondsSinceLastChange: number;
}

export interface WatchConfig {
    url: string;
    /** CSS selector or XPath expression to narrow monitoring. undefined = full page. */
    target?: string;
    /** Seconds between checks (default 300). */
    interval: number;
    /** Human-readable label shown in logs and reports. */
    label: string;
    /** Extra HTTP headers for this URL. */
    headers: Record<string, string>;
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
    alert?: AlertConfig;
}

export function makeWatchConfig(
    url: string,
    opts: Partial<Omit<WatchConfig, "url">> = {}
): WatchConfig {
    return {
        url,
        target:                 opts.target,
        interval:               opts.interval ?? 300,
        label:                  opts.label ?? url,
        headers:                opts.headers ?? {},
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
        alert:                  opts.alert,
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
    label: string;
    target: string | undefined;
    interval: number;
    paused: boolean;
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
}
