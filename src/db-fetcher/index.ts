import type { ColumnDef, DbWatchConfig, Row } from "../db-models.js";

export interface DbFetchResult {
    rows:    Row[];
    schema?: ColumnDef[];
}

export class DbFetcher {
    async fetch(config: DbWatchConfig): Promise<DbFetchResult> {
        switch (config.driver) {
            case "sqlite": {
                const { fetchSqlite } = await import("./adapters/sqlite.js");
                return fetchSqlite(config);
            }
            case "postgres": {
                const { fetchPostgres } = await import("./adapters/postgres.js");
                return fetchPostgres(config);
            }
            case "mysql": {
                const { fetchMysql } = await import("./adapters/mysql.js");
                return fetchMysql(config);
            }
            default:
                throw new Error(`Unsupported DB driver: ${String(config.driver)}`);
        }
    }
}
