import type { ColumnDef, DbWatchConfig, Row } from "../../db-models.js";
import type { DbFetchResult } from "../index.js";

function assertSelectOnly(query: string): void {
    if (!/^\s*SELECT\b/i.test(query.trimStart())) {
        throw new Error(`watchdiff: custom queries must be SELECT statements. Got: ${query.slice(0, 80)}`);
    }
    // Block multi-statement injection
    if (/;\s*\S/.test(query)) {
        throw new Error("watchdiff: custom queries must not contain multiple statements.");
    }
}

export async function fetchSqlite(config: DbWatchConfig): Promise<DbFetchResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Database: new (path: string, opts?: Record<string, unknown>) => any;
    try {
        const mod = await import("better-sqlite3");
        Database  = (mod.default ?? mod) as typeof Database;
    } catch {
        throw new Error("better-sqlite3 is required for SQLite monitoring. Run: npm install better-sqlite3");
    }

    const filePath = config.connectionString.replace(/^sqlite:\/\//, "");
    const db       = new Database(filePath, { readonly: true });

    try {
        const sql  = config.query ?? `SELECT * FROM ${quote(config.table)}`;
        if (config.query) assertSelectOnly(sql);
        const rows = db.prepare(sql).all() as Row[];

        let schema: ColumnDef[] | undefined;
        if (config.diffMode === "schema") {
            schema = (db.prepare(`PRAGMA table_info(${quote(config.table)})`).all() as Record<string, unknown>[])
                .map((col) => ({
                    name:         String(col["name"]),
                    type:         String(col["type"]),
                    nullable:     col["notnull"] === 0,
                    primaryKey:   (col["pk"] as number) !== 0,
                    defaultValue: col["dflt_value"] != null ? String(col["dflt_value"]) : undefined,
                } satisfies ColumnDef));
        }

        return { rows, schema };
    } finally {
        db.close();
    }
}

function quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}
