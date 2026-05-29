/**
 * Store - persists snapshots and diff reports to disk (JSON).
 *
 * One JSON file per watched URL+target combo, stored in a configurable
 * directory. Same zero-dependency philosophy as the Python port.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
    makeSnapshot,
    reportAsDict,
    type DiffReport,
    type IStore,
    type Snapshot,
} from "../models.js";

export class Store implements IStore {
    private readonly dir: string;

    constructor(directory = ".watchdiff") {
        this.dir = directory;
        mkdirSync(this.dir, { recursive: true });
    }

    // ------------------------------------------------------------------
    // Snapshots
    // ------------------------------------------------------------------

    saveSnapshot(snapshot: Snapshot): void {
        const path      = this.snapshotPath(snapshot.url, snapshot.target);
        const history   = this.loadRaw(path);
        history.push(snapshotToDict(snapshot));
        this.saveRaw(path, history);
    }

    loadLatest(url: string, target: string | undefined): Snapshot | null {
        const path      = this.snapshotPath(url, target);
        const history   = this.loadRaw(path);
        if (history.length === 0) return null;
        return dictToSnapshot(history[history.length - 1]!);
    }

    loadHistory(url: string, target: string | undefined, limit = 50): Snapshot[] {
        const path      = this.snapshotPath(url, target);
        const history   = this.loadRaw(path);
        return history.slice(-limit).map(dictToSnapshot);
    }

    clearHistory(url: string, target: string | undefined): void {
        const path = this.snapshotPath(url, target);
        if (existsSync(path)) unlinkSync(path);
    }

    pruneSnapshots(url: string, target: string | undefined, max: number): void {
        const path    = this.snapshotPath(url, target);
        const history = this.loadRaw(path);
        if (history.length > max) {
            this.saveRaw(path, history.slice(-max));
        }
    }

    // ------------------------------------------------------------------
    // Reports
    // ------------------------------------------------------------------

    saveReport(report: DiffReport): void {
        const path      = this.reportPath(report.url, report.target);
        const reports   = this.loadRaw(path);
        reports.push(reportAsDict(report));
        this.saveRaw(path, reports);
    }

    loadReports(url: string, target: string | undefined, limit = 50): Record<string, unknown>[] {
        const path = this.reportPath(url, target);
        return this.loadRaw(path).slice(-limit) as Record<string, unknown>[];
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    private key(url: string, target: string | undefined): string {
        const raw = `${url}::${target ?? ""}`;
        return createHash("md5").update(raw).digest("hex").slice(0, 12);
    }

    private snapshotPath(url: string, target: string | undefined): string {
        return join(this.dir, `snap_${this.key(url, target)}.json`);
    }

    private reportPath(url: string, target: string | undefined): string {
        return join(this.dir, `report_${this.key(url, target)}.json`);
    }

    private loadRaw(path: string): unknown[] {
        if (!existsSync(path)) return [];
        try {
            return JSON.parse(readFileSync(path, "utf-8")) as unknown[];
        } catch {
            return [];
        }
    }

    private saveRaw(path: string, data: unknown[]): void {
        writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    }
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

interface SnapshotDict {
    url: string;
    target: string | undefined;
    content: string;
    rawHtml: string;
    capturedAt: string;
    checksum: string;
}

function snapshotToDict(s: Snapshot): SnapshotDict {
    return {
        url: s.url,
        target: s.target,
        content: s.content,
        rawHtml: s.rawHtml,
        capturedAt: s.capturedAt.toISOString(),
        checksum: s.checksum,
    };
}

function dictToSnapshot(d: unknown): Snapshot {
    const s         = d as SnapshotDict;
    const snap      = makeSnapshot(s.url, s.target, s.content, s.rawHtml ?? "");
    // Override auto-computed capturedAt and checksum with stored values
    (snap as { capturedAt: Date }).capturedAt = new Date(s.capturedAt);
    (snap as { checksum: string }).checksum = s.checksum;
    return snap;
}
