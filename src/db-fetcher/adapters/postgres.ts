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

export async function fetchPostgres(config: DbWatchConfig): Promise<DbFetchResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Pool: new (opts: { connectionString: string }) => any;
    try {
        const mod = await import("pg");
        const pkg = (mod.default ?? mod) as Record<string, unknown>;
        Pool      = (pkg["Pool"] ?? pkg) as typeof Pool;
    } catch {
        throw new Error("pg is required for PostgreSQL monitoring. Run: npm install pg");
    }

    const pool = new Pool({ connectionString: config.connectionString });
    try {
        const sql    = config.query ?? `SELECT * FROM ${quote(config.table)}`;
        if (config.query) assertSelectOnly(sql);
        const result = (await pool.query(sql)) as { rows: Row[] };
        const rows   = result.rows;

        let schema: ColumnDef[] | undefined;
        if (config.diffMode === "schema") {
            const cols = (await pool.query(
                `SELECT column_name, data_type, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_name = $1
                 ORDER BY ordinal_position`,
                [config.table]
            )) as { rows: Row[] };

            const pks = (await pool.query(
                `SELECT kcu.column_name
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name
                 WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
                [config.table]
            )) as { rows: Row[] };

            const pkSet = new Set((pks.rows as Row[]).map((r) => String(r["column_name"])));

            schema = (cols.rows as Row[]).map((col) => ({
                name:         String(col["column_name"]),
                type:         String(col["data_type"]),
                nullable:     col["is_nullable"] === "YES",
                primaryKey:   pkSet.has(String(col["column_name"])),
                defaultValue: col["column_default"] != null ? String(col["column_default"]) : undefined,
            } satisfies ColumnDef));
        }

        return { rows, schema };
    } finally {
        await pool.end();
    }
}

function quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}
