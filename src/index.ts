/**
 * WatchDiff - Lightweight web change monitoring.
 *
 * Quick start:
 *   import { WatchDiff } from "watchdiff-core";
 *
 *   const wd = new WatchDiff();
 *   wd.watch("https://example.com", { target: ".price", interval: 60 });
 *   wd.onChange((report) => console.log(report));
 *   wd.start();
 */

export { WatchDiff } from "./core.js";
export type { WatchOptions } from "./core.js";

export {
    makeWatchConfig,
    makeSnapshot,
    snapshotsIdentical,
    changeHuman,
    reportHasChanges,
    reportSummary,
    reportAsDict,
} from "./models.js";

export type {
    ChangeType,
    DiffMode,
    BrowserOptions,
    AlertConfig,
    IStore,
    WatchConfig,
    Snapshot,
    Change,
    DiffReport,
    SilenceInfo,
    WatcherStatus,
} from "./models.js";

export { Fetcher, FetchError } from "./fetcher/index.js";
export { BrowserFetcher } from "./fetcher/browser.js";
export { Cleaner } from "./cleaner/index.js";
export { Parser, ParserError, isXPath } from "./parser/index.js";
export { DiffEngine } from "./diff/index.js";
export { Store } from "./store/index.js";
export { SqliteStore } from "./store/sqlite.js";
export { Notifier } from "./notifier/index.js";
export { Scheduler } from "./scheduler/index.js";
export { Exporter } from "./exporter/index.js";
export type { ExportFormat, ExportType } from "./exporter/index.js";
