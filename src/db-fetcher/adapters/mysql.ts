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

export async function fetchMysql(config: DbWatchConfig): Promise<DbFetchResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let createPool: (opts: { uri: string }) => any;
    try {
        const mod = await import("mysql2/promise");
        const pkg = (mod.default ?? mod) as Record<string, unknown>;
        createPool = pkg["createPool"] as typeof createPool;
    } catch {
        throw new Error("mysql2 is required for MySQL monitoring. Run: npm install mysql2");
    }

    const pool = createPool({ uri: config.connectionString });
    try {
        const sql        = config.query ?? `SELECT * FROM ${quote(config.table)}`;
        if (config.query) assertSelectOnly(sql);
        const [rows]     = (await pool.query(sql)) as [Row[], unknown];

        let schema: ColumnDef[] | undefined;
        if (config.diffMode === "schema") {
            const [schemaRows] = (await pool.query(
                `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                 ORDER BY ORDINAL_POSITION`,
                [config.table]
            )) as [Row[], unknown];

            schema = (schemaRows as Row[]).map((col) => ({
                name:         String(col["COLUMN_NAME"]),
                type:         String(col["COLUMN_TYPE"]),
                nullable:     col["IS_NULLABLE"] === "YES",
                primaryKey:   col["COLUMN_KEY"] === "PRI",
                defaultValue: col["COLUMN_DEFAULT"] != null ? String(col["COLUMN_DEFAULT"]) : undefined,
            } satisfies ColumnDef));
        }

        return { rows, schema };
    } finally {
        await pool.end();
    }
}

function quote(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
}
