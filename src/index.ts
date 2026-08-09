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
export type { WatchOptions, WatchFileOptions, WatchApiOptions, WatchCertOptions, DbWatchOptions } from "./core.js";

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
    SpikeInfo,
    StatusChangeInfo,
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
export { Scheduler }   from "./scheduler/index.js";
export { DbScheduler } from "./db-scheduler/index.js";
export type { DbWatcherStatus } from "./db-scheduler/index.js";
export { DbFetcher }   from "./db-fetcher/index.js";
export type { DbFetchResult } from "./db-fetcher/index.js";
export { DbDiffEngine } from "./db-diff/index.js";
export { Exporter }    from "./exporter/index.js";
export type { ExportFormat, ExportType } from "./exporter/index.js";
export { StatusServer } from "./status-server/index.js";

export { CertScheduler } from "./cert-scheduler/index.js";
export { FileFetcher, filePathFromUrl } from "./file-fetcher/index.js";
export { generateAiSummary, aiSummaryEnabled, resolveProvider, getProvider, callProvider, AiError } from "./ai-summarizer/index.js";
export type { AiProvider, AiProviderType, AiErrorKind } from "./ai-summarizer/index.js";

export {
    makeCertWatchConfig,
} from "./cert-models.js";

export type {
    CertWatchConfig,
    CertSnapshot,
    CertReport,
    CertExpiryInfo,
    CertChangeInfo,
    CertWatcherStatus,
} from "./cert-models.js";

export {
    makeDbWatchConfig,
    makeDbSnapshot,
    dbSnapshotKey,
    dbHasChanges,
    dbReportSummary,
} from "./db-models.js";

export type {
    DbDiffMode,
    DbDriver,
    Row,
    ColumnDef,
    DbWatchConfig,
    DbSnapshot,
    DbChangeKind,
    RowModification,
    DbChange,
    DbDiffReport,
    SchemaChangeInfo,
    ThresholdInfo,
} from "./db-models.js";
