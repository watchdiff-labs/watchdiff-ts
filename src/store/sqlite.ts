/**
 * SqliteStore - SQLite-backed storage via better-sqlite3.
 *
 * Drop-in replacement for Store. Use for high-volume monitoring where a
 * single SQLite file is more efficient than many small JSON files.
 *
 * better-sqlite3 is an optional peer dependency.
 * Install: npm install better-sqlite3
 * (Requires native compilation - node-gyp must be available.)
 */

import { createRequire } from "node:module";
import { makeSnapshot, reportAsDict, type DiffReport, type IStore, type Snapshot } from "../models.js";

// ---------------------------------------------------------------------------
// Lazy loader - better-sqlite3 is an optional peer dep
// ---------------------------------------------------------------------------

type BetterSqlite3Database = {
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): {
        run(...args: unknown[]): { lastInsertRowid: number };
        get(...args: unknown[]): T | undefined;
        all(...args: unknown[]): T[];
    };
};

function loadDatabase(dbPath: string): BetterSqlite3Database {
    const req = createRequire(import.meta.url);
    let Database: (path: string, opts?: unknown) => BetterSqlite3Database;
    try {
        // any: better-sqlite3 types accessed via dynamic require
        Database = req("better-sqlite3") as typeof Database;
    } catch {
        throw new Error(
            "better-sqlite3 is not installed.\n" +
            "Run: npm install better-sqlite3\n" +
            "Note: requires native compilation (node-gyp)."
        );
    }
    return Database(dbPath);
}

// ---------------------------------------------------------------------------
// SqliteStore
// ---------------------------------------------------------------------------

interface SnapshotRow {
    url: string;
    target: string | null;
    content: string;
    raw_html: string;
    captured_at: string;
    checksum: string;
}

interface ReportRow {
    data: string;
}

export class SqliteStore implements IStore {
    private readonly db: BetterSqlite3Database;

    constructor(dbPath = ".watchdiff.db") {
        this.db = loadDatabase(dbPath);
        this.init();
    }

    // ------------------------------------------------------------------
    // Schema
    // ------------------------------------------------------------------

    private init(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS snapshots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                url         TEXT    NOT NULL,
                target      TEXT,
                content     TEXT    NOT NULL,
                raw_html    TEXT    NOT NULL DEFAULT '',
                captured_at TEXT    NOT NULL,
                checksum    TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_snap_url ON snapshots (url, target);

            CREATE TABLE IF NOT EXISTS reports (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                url         TEXT    NOT NULL,
                target      TEXT,
                compared_at TEXT    NOT NULL,
                data        TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rep_url ON reports (url, target);
        `);
    }

    // ------------------------------------------------------------------
    // Snapshots
    // ------------------------------------------------------------------

    saveSnapshot(snapshot: Snapshot): void {
        this.db.prepare(`
            INSERT INTO snapshots (url, target, content, raw_html, captured_at, checksum)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            snapshot.url,
            snapshot.target ?? null,
            snapshot.content,
            snapshot.rawHtml,
            snapshot.capturedAt.toISOString(),
            snapshot.checksum
        );
    }

    loadLatest(url: string, target: string | undefined): Snapshot | null {
        const row = this.db.prepare<SnapshotRow>(`
            SELECT * FROM snapshots WHERE url = ? AND target IS ?
            ORDER BY id DESC LIMIT 1
        `).get(url, target ?? null);
        return row ? rowToSnapshot(row) : null;
    }

    loadHistory(url: string, target: string | undefined, limit = 50): Snapshot[] {
        const rows = this.db.prepare<SnapshotRow>(`
            SELECT * FROM (
                SELECT * FROM snapshots WHERE url = ? AND target IS ?
                ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        `).all(url, target ?? null, limit);
        return rows.map(rowToSnapshot);
    }

    clearHistory(url: string, target: string | undefined): void {
        this.db.prepare(`
            DELETE FROM snapshots WHERE url = ? AND target IS ?
        `).run(url, target ?? null);
        this.db.prepare(`
            DELETE FROM reports WHERE url = ? AND target IS ?
        `).run(url, target ?? null);
    }

    pruneSnapshots(url: string, target: string | undefined, max: number): void {
        this.db.prepare(`
            DELETE FROM snapshots
            WHERE url = ? AND target IS ?
              AND id NOT IN (
                SELECT id FROM snapshots
                WHERE url = ? AND target IS ?
                ORDER BY id DESC LIMIT ?
              )
        `).run(url, target ?? null, url, target ?? null, max);
    }

    // ------------------------------------------------------------------
    // Reports
    // ------------------------------------------------------------------

    saveReport(report: DiffReport): void {
        this.db.prepare(`
            INSERT INTO reports (url, target, compared_at, data)
            VALUES (?, ?, ?, ?)
        `).run(
            report.url,
            report.target ?? null,
            report.comparedAt.toISOString(),
            JSON.stringify(reportAsDict(report))
        );
    }

    loadReports(url: string, target: string | undefined, limit = 50): Record<string, unknown>[] {
        const rows = this.db.prepare<ReportRow>(`
            SELECT * FROM (
                SELECT * FROM reports WHERE url = ? AND target IS ?
                ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        `).all(url, target ?? null, limit);
        return rows.map((r) => JSON.parse(r.data) as Record<string, unknown>);
    }
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function rowToSnapshot(row: SnapshotRow): Snapshot {
    const snap = makeSnapshot(row.url, row.target ?? undefined, row.content, row.raw_html);
    (snap as { capturedAt: Date }).capturedAt   = new Date(row.captured_at);
    (snap as { checksum: string }).checksum     = row.checksum;
    return snap;
}
