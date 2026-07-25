import type {
    ColumnDef,
    DbChange,
    DbDiffReport,
    DbSnapshot,
    DbWatchConfig,
    Row,
    RowModification,
} from "../db-models.js";

export class DbDiffEngine {
    compare(before: DbSnapshot, after: DbSnapshot, config: DbWatchConfig): DbDiffReport {
        const changes = this.computeChanges(before, after, config);
        return {
            connectionString: config.connectionString,
            table:            config.table,
            label:            config.label,
            before,
            after,
            changes,
            diffMode:         config.diffMode,
            comparedAt:       new Date(),
        };
    }

    private computeChanges(before: DbSnapshot, after: DbSnapshot, config: DbWatchConfig): DbChange[] {
        switch (config.diffMode) {
            case "row":       return this.diffRows(before.rows, after.rows, config);
            case "schema":    return this.diffSchema(before.schema ?? [], after.schema ?? []);
            case "aggregate": return this.diffAggregate(before.rows, after.rows, config);
            case "value":     return this.diffValue(before.rows, after.rows, config);
        }
    }

    // ------------------------------------------------------------------
    // row mode
    // ------------------------------------------------------------------

    private diffRows(before: Row[], after: Row[], config: DbWatchConfig): DbChange[] {
        const pk     = config.primaryKey ?? [];
        const ignore = new Set(config.ignoreColumns ?? []);
        const changes: DbChange[] = [];

        if (pk.length === 0) {
            // No PK: compare by full-row serialization
            const beforeKeys = new Map<string, Row>();
            for (const row of before) {
                beforeKeys.set(JSON.stringify(this.filterRow(row, ignore)), row);
            }
            const afterKeys = new Set<string>();
            for (const row of after) {
                const key = JSON.stringify(this.filterRow(row, ignore));
                afterKeys.add(key);
                if (!beforeKeys.has(key) && (config.alertOnInsert ?? true)) {
                    changes.push({ kind: "inserted", row, rowKey: key });
                }
            }
            for (const [key, row] of beforeKeys) {
                if (!afterKeys.has(key) && (config.alertOnDelete ?? true)) {
                    changes.push({ kind: "deleted", row, rowKey: key });
                }
            }
            return changes;
        }

        const beforeMap = new Map<string, Row>();
        for (const row of before) beforeMap.set(this.rowKey(row, pk), row);

        const afterMap = new Map<string, Row>();
        for (const row of after) afterMap.set(this.rowKey(row, pk), row);

        for (const [key, row] of afterMap) {
            if (!beforeMap.has(key) && (config.alertOnInsert ?? true)) {
                changes.push({ kind: "inserted", rowKey: key, row });
            }
        }
        for (const [key, row] of beforeMap) {
            if (!afterMap.has(key) && (config.alertOnDelete ?? true)) {
                changes.push({ kind: "deleted", rowKey: key, row });
            }
        }
        if (config.alertOnUpdate ?? true) {
            for (const [key, afterRow] of afterMap) {
                const beforeRow = beforeMap.get(key);
                if (!beforeRow) continue;
                const mods = this.diffSingleRow(beforeRow, afterRow, ignore);
                if (mods.length > 0) {
                    changes.push({ kind: "updated", rowKey: key, modifications: mods });
                }
            }
        }

        return changes;
    }

    private rowKey(row: Row, pk: string[]): string {
        return JSON.stringify(pk.map((k) => row[k]));
    }

    private filterRow(row: Row, ignore: Set<string>): Row {
        const out: Row = {};
        for (const [k, v] of Object.entries(row)) {
            if (!ignore.has(k)) out[k] = v;
        }
        return out;
    }

    private diffSingleRow(before: Row, after: Row, ignore: Set<string>): RowModification[] {
        const mods: RowModification[] = [];
        const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const col of allKeys) {
            if (ignore.has(col)) continue;
            if (JSON.stringify(before[col]) !== JSON.stringify(after[col])) {
                mods.push({ column: col, before: before[col], after: after[col] });
            }
        }
        return mods;
    }

    // ------------------------------------------------------------------
    // schema mode
    // ------------------------------------------------------------------

    private diffSchema(before: ColumnDef[], after: ColumnDef[]): DbChange[] {
        const changes: DbChange[] = [];
        const beforeMap = new Map(before.map((c) => [c.name, c]));
        const afterMap  = new Map(after.map((c)  => [c.name, c]));

        for (const [name, col] of afterMap) {
            if (!beforeMap.has(name)) {
                changes.push({ kind: "schema_changed", column: name, before: undefined, after: col, context: "column added" });
            }
        }
        for (const [name, col] of beforeMap) {
            if (!afterMap.has(name)) {
                changes.push({ kind: "schema_changed", column: name, before: col, after: undefined, context: "column removed" });
            }
        }
        for (const [name, afterCol] of afterMap) {
            const beforeCol = beforeMap.get(name);
            if (!beforeCol) continue;
            if (beforeCol.type !== afterCol.type) {
                changes.push({ kind: "schema_changed", column: name, before: beforeCol.type, after: afterCol.type, context: "type changed" });
            }
            if (beforeCol.nullable !== afterCol.nullable) {
                changes.push({ kind: "schema_changed", column: name, before: beforeCol.nullable, after: afterCol.nullable, context: "nullability changed" });
            }
        }

        return changes;
    }

    // ------------------------------------------------------------------
    // aggregate mode
    // ------------------------------------------------------------------

    private diffAggregate(before: Row[], after: Row[], config: DbWatchConfig): DbChange[] {
        const bVal = this.extractScalar(before);
        const aVal = this.extractScalar(after);
        if (bVal === null || aVal === null || bVal === aVal) return [];

        const changePercent = bVal !== 0 ? Math.abs((aVal - bVal) / bVal) * 100 : 100;
        const threshold     = config.threshold ?? 0;

        if (changePercent < threshold) return [];

        return [{
            kind:    "threshold_exceeded",
            before:  bVal,
            after:   aVal,
            context: `${changePercent.toFixed(2)}% change (threshold: ${threshold}%)`,
        }];
    }

    private extractScalar(rows: Row[]): number | null {
        if (rows.length === 0) return null;
        const val = Object.values(rows[0]!)[0];
        const num = Number(val);
        return isNaN(num) ? null : num;
    }

    // ------------------------------------------------------------------
    // value mode
    // ------------------------------------------------------------------

    private diffValue(before: Row[], after: Row[], config: DbWatchConfig): DbChange[] {
        const bVal = before[0] ? Object.values(before[0])[0] : null;
        const aVal = after[0]  ? Object.values(after[0])[0]  : null;
        if (JSON.stringify(bVal) === JSON.stringify(aVal)) return [];
        return [{ kind: "value_changed", before: bVal, after: aVal, context: config.table }];
    }
}
