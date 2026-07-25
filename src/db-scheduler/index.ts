import type { IStore, Snapshot } from "../models.js";
import {
    dbHasChanges,
    dbSnapshotKey,
    makeDbSnapshot,
    type ColumnDef,
    type DbDiffReport,
    type DbSnapshot,
    type DbWatchConfig,
    type Row,
} from "../db-models.js";
import { DbFetcher }    from "../db-fetcher/index.js";
import { DbDiffEngine } from "../db-diff/index.js";

const RETRY_BASE_MS = 500;

interface DbState {
    config:         DbWatchConfig;
    timer:          ReturnType<typeof setInterval> | null;
    lastCheckAt:    Date | null;
    lastChangeAt:   Date | null;
    nextCheckAt:    Date | null;
    checksCount:    number;
    changesCount:   number;
    errorsCount:    number;
    lastCooldownAt: number;
    paused:         boolean;
}

export interface DbWatcherStatus {
    connectionString: string;
    table:            string;
    label:            string;
    diffMode:         string;
    interval:         number;
    paused:           boolean;
    lastCheckAt:      Date | null;
    nextCheckAt:      Date | null;
    lastChangeAt:     Date | null;
    checksCount:      number;
    changesCount:     number;
    errorsCount:      number;
}

export class DbScheduler {
    private readonly store:   IStore;
    private readonly fetcher: DbFetcher    = new DbFetcher();
    private readonly engine:  DbDiffEngine = new DbDiffEngine();
    private readonly states:  Map<string, DbState> = new Map();

    constructor(store: IStore) {
        this.store = store;
    }

    start(configs: DbWatchConfig[]): () => void {
        for (const config of configs) {
            this.register(config);
        }
        return () => this.stop();
    }

    private register(config: DbWatchConfig): void {
        const key: string = dbSnapshotKey(config.connectionString, config.table);
        const state: DbState = {
            config,
            timer:          null,
            lastCheckAt:    null,
            lastChangeAt:   null,
            nextCheckAt:    null,
            checksCount:    0,
            changesCount:   0,
            errorsCount:    0,
            lastCooldownAt: 0,
            paused:         false,
        };
        this.states.set(key, state);

        void this.check(key, state);
        const ms    = config.interval * 1000;
        state.timer = setInterval(() => { void this.check(key, state); }, ms);
        state.nextCheckAt = new Date(Date.now() + ms);
    }

    private async check(key: string, state: DbState): Promise<void> {
        if (state.paused) return;

        state.lastCheckAt  = new Date();
        state.checksCount += 1;

        try {
            const result = await this.fetcher.fetch(state.config);
            const after  = makeDbSnapshot(
                state.config.connectionString,
                state.config.table,
                result.rows,
                result.schema
            );

            const stored = this.store.loadLatest(key, undefined);
            const before = stored ? this.deserialize(stored.content, state.config) : null;

            if (!before) {
                if (!state.config.dryRun) {
                    this.store.saveSnapshot(this.serialize(after, key));
                    if (state.config.maxSnapshots) {
                        this.store.pruneSnapshots?.(key, undefined, state.config.maxSnapshots);
                    }
                }
                return;
            }

            const report = this.engine.compare(before, after, state.config);

            if (!state.config.dryRun) {
                this.store.saveSnapshot(this.serialize(after, key));
                if (state.config.maxSnapshots) {
                    this.store.pruneSnapshots?.(key, undefined, state.config.maxSnapshots);
                }
            }

            if (!dbHasChanges(report)) return;

            if (state.config.cooldown) {
                const now = Date.now();
                if (now - state.lastCooldownAt < state.config.cooldown * 1000) return;
                state.lastCooldownAt = now;
            }

            state.changesCount += 1;
            state.lastChangeAt  = new Date();

            await this.dispatch(report, state.config);
        } catch (err) {
            state.errorsCount += 1;
            const error = err instanceof Error ? err : new Error(String(err));
            if (state.config.onError) {
                state.config.onError(error, state.config);
            } else {
                console.error(`[watchdiff:db] ${state.config.label}: ${error.message}`);
            }
        } finally {
            state.nextCheckAt = new Date(Date.now() + state.config.interval * 1000);
        }
    }

    private async dispatch(report: DbDiffReport, config: DbWatchConfig): Promise<void> {
        const schemaChanges = report.changes.filter((c) => c.kind === "schema_changed");
        if (schemaChanges.length > 0 && config.onSchemaChange) {
            config.onSchemaChange({
                connectionString: config.connectionString,
                table:            config.table,
                label:            config.label,
                changes:          schemaChanges,
            });
        }

        for (const tc of report.changes.filter((c) => c.kind === "threshold_exceeded")) {
            if (config.onThreshold) {
                const prev = Number(tc.before);
                const curr = Number(tc.after);
                const pct  = prev !== 0 ? Math.abs((curr - prev) / prev) * 100 : 100;
                config.onThreshold({
                    connectionString: config.connectionString,
                    table:            config.table,
                    label:            config.label,
                    previousValue:    prev,
                    currentValue:     curr,
                    changePercent:    pct,
                    threshold:        config.threshold ?? 0,
                });
            }
        }

        if (config.onChange) {
            await config.onChange(report);
        }

        if (config.webhooks?.length) {
            await this.fireWebhooks(report, config);
        }
    }

    private async fireWebhooks(report: DbDiffReport, config: DbWatchConfig): Promise<void> {
        const payload = JSON.stringify({
            type:        "db_change",
            table:       report.table,
            label:       report.label,
            diffMode:    report.diffMode,
            changes:     report.changes,
            comparedAt:  report.comparedAt.toISOString(),
            rowsBefore:  report.before.rowCount,
            rowsAfter:   report.after.rowCount,
        });

        const maxAttempts = (config.webhookRetries ?? 3) + 1;

        await Promise.allSettled(
            (config.webhooks ?? []).map((url) => this.sendWithRetry(url, payload, maxAttempts))
        );
    }

    private async sendWithRetry(url: string, payload: string, maxAttempts: number): Promise<void> {
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const res = await globalThis.fetch(url, {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    payload,
                    signal:  AbortSignal.timeout(10_000),
                });
                if (res.ok) return;
                throw new Error(`HTTP ${res.status}`);
            } catch (err) {
                lastErr = err;
                if (attempt < maxAttempts) {
                    await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
                }
            }
        }
        console.warn(`[watchdiff:db] Webhook ${url} failed after ${maxAttempts} attempt(s):`, lastErr);
    }

    // ------------------------------------------------------------------
    // Serialization : DbSnapshot <-> IStore Snapshot
    // ------------------------------------------------------------------

    private serialize(snap: DbSnapshot, key: string): Snapshot {
        return {
            url:        key,
            target:     undefined,
            content:    JSON.stringify({ rows: snap.rows, schema: snap.schema }),
            rawHtml:    "",
            capturedAt: snap.capturedAt,
            checksum:   snap.checksum,
        };
    }

    private deserialize(content: string, config: DbWatchConfig): DbSnapshot {
        const data = JSON.parse(content) as { rows: Row[]; schema?: ColumnDef[] };
        return makeDbSnapshot(config.connectionString, config.table, data.rows, data.schema);
    }

    // ------------------------------------------------------------------
    // Control
    // ------------------------------------------------------------------

    stop(): void {
        for (const state of this.states.values()) {
            if (state.timer) clearInterval(state.timer);
        }
        this.states.clear();
    }

    pause(key: string): void {
        const state = this.states.get(key);
        if (state) state.paused = true;
    }

    resume(key: string): void {
        const state = this.states.get(key);
        if (state) state.paused = false;
    }

    getStatuses(): DbWatcherStatus[] {
        return [...this.states.values()].map((s) => ({
            connectionString: s.config.connectionString,
            table:            s.config.table,
            label:            s.config.label,
            diffMode:         s.config.diffMode,
            interval:         s.config.interval,
            paused:           s.paused,
            lastCheckAt:      s.lastCheckAt,
            nextCheckAt:      s.nextCheckAt,
            lastChangeAt:     s.lastChangeAt,
            checksCount:      s.checksCount,
            changesCount:     s.changesCount,
            errorsCount:      s.errorsCount,
        }));
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
