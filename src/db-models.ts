import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Enums / primitives
// ---------------------------------------------------------------------------

export type DbDiffMode = "row" | "schema" | "aggregate" | "value";
export type DbDriver   = "sqlite" | "postgres" | "mysql";

export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface ColumnDef {
    name:          string;
    type:          string;
    nullable:      boolean;
    primaryKey:    boolean;
    defaultValue?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DbWatchConfig {
    connectionString: string;
    driver:           DbDriver;
    table:            string;
    /** Custom SELECT query -> overrides the default `SELECT * FROM <table>`. */
    query?:           string;
    /** Column(s) used to identify a row across snapshots (default: first column). */
    primaryKey?:      string[];
    /** Columns to exclude from comparison. */
    ignoreColumns?:   string[];
    diffMode:         DbDiffMode;
    interval:         number;
    label:            string;
    dryRun?:          boolean;
    cooldown?:        number;
    maxSnapshots?:    number;
    alertOnInsert?:   boolean;
    alertOnDelete?:   boolean;
    alertOnUpdate?:   boolean;
    /** For aggregate mode: alert when value changes by more than this % (0 = any change). */
    threshold?:       number;
    webhooks?:        string[];
    webhookRetries?:  number;
    onChange?:        (report: DbDiffReport) => void | Promise<void>;
    onError?:         (err: Error, config: DbWatchConfig) => void;
    onSchemaChange?:  (info: SchemaChangeInfo) => void;
    onThreshold?:     (info: ThresholdInfo) => void;
    /** Generate an AI-powered summary of detected DB changes. */
    aiSummary?:       boolean;
    /** AI provider - auto-detected from env vars when omitted. */
    aiProvider?:      import("./ai-summarizer/index.js").AiProvider;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface DbSnapshot {
    connectionString: string;
    table:            string;
    rows:             Row[];
    schema?:          ColumnDef[];
    capturedAt:       Date;
    checksum:         string;
    rowCount:         number;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DbChangeKind =
    | "inserted"
    | "deleted"
    | "updated"
    | "schema_changed"
    | "threshold_exceeded"
    | "value_changed";

export interface RowModification {
    column: string;
    before: unknown;
    after:  unknown;
}

export interface DbChange {
    kind:           DbChangeKind;
    /** Primary-key values for the affected row, serialized as JSON. */
    rowKey?:        string;
    /** Full row content (for inserted / deleted). */
    row?:           Row;
    /** Per-column diffs (for updated). */
    modifications?: RowModification[];
    /** Affected column name (for schema_changed). */
    column?:        string;
    before?:        unknown;
    after?:         unknown;
    context?:       string;
}

export interface DbDiffReport {
    connectionString: string;
    table:            string;
    label:            string;
    before:           DbSnapshot;
    after:            DbSnapshot;
    changes:          DbChange[];
    diffMode:         DbDiffMode;
    comparedAt:       Date;
    /** AI-generated summary (populated when aiSummary is enabled on the config). */
    aiSummary?:       string;
}

// ---------------------------------------------------------------------------
// Callback info types
// ---------------------------------------------------------------------------

export interface SchemaChangeInfo {
    connectionString: string;
    table:            string;
    label:            string;
    changes:          DbChange[];
}

export interface ThresholdInfo {
    connectionString: string;
    table:            string;
    label:            string;
    previousValue:    number;
    currentValue:     number;
    changePercent:    number;
    threshold:        number;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function makeDbWatchConfig(
    connectionString: string,
    table: string,
    opts: Partial<Omit<DbWatchConfig, "connectionString" | "table" | "driver">> = {}
): DbWatchConfig {
    const driver: DbDriver =
        connectionString.startsWith("sqlite://")                                    ? "sqlite"
        : connectionString.startsWith("postgresql://") || connectionString.startsWith("postgres://") ? "postgres"
        : connectionString.startsWith("mysql://")                                   ? "mysql"
        : "sqlite";

    const label = opts.label ?? `${table} @ ${connectionString.split("@").pop() ?? connectionString}`;

    return {
        connectionString,
        driver,
        table,
        query:          opts.query,
        primaryKey:     opts.primaryKey,
        ignoreColumns:  opts.ignoreColumns ?? [],
        diffMode:       opts.diffMode ?? "row",
        interval:       opts.interval ?? 300,
        label,
        dryRun:         opts.dryRun,
        cooldown:       opts.cooldown,
        maxSnapshots:   opts.maxSnapshots,
        alertOnInsert:  opts.alertOnInsert ?? true,
        alertOnDelete:  opts.alertOnDelete ?? true,
        alertOnUpdate:  opts.alertOnUpdate ?? true,
        threshold:      opts.threshold,
        webhooks:       opts.webhooks,
        webhookRetries: opts.webhookRetries,
        onChange:       opts.onChange,
        onError:        opts.onError,
        onSchemaChange: opts.onSchemaChange,
        onThreshold:    opts.onThreshold,
        aiSummary:      opts.aiSummary,
        aiProvider:     opts.aiProvider,
    };
}

export function makeDbSnapshot(
    connectionString: string,
    table: string,
    rows: Row[],
    schema?: ColumnDef[]
): DbSnapshot {
    const checksum = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    return { connectionString, table, rows, schema, capturedAt: new Date(), checksum, rowCount: rows.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable storage key for IStore -> encodes connection + table without leaking credentials. */
export function dbSnapshotKey(connectionString: string, table: string): string {
    const hash = createHash("sha256")
        .update(`${connectionString}::${table}`)
        .digest("hex")
        .slice(0, 12);
    return `db::${hash}::${table}`;
}

export function dbHasChanges(report: DbDiffReport): boolean {
    return report.changes.length > 0;
}

export function dbReportSummary(report: DbDiffReport): string {
    if (!dbHasChanges(report)) return `[${report.label}] No changes detected.`;
    const inserted = report.changes.filter((c) => c.kind === "inserted").length;
    const deleted  = report.changes.filter((c) => c.kind === "deleted").length;
    const updated  = report.changes.filter((c) => c.kind === "updated").length;
    const parts: string[] = [];
    if (inserted) parts.push(`${inserted} inserted`);
    if (deleted)  parts.push(`${deleted} deleted`);
    if (updated)  parts.push(`${updated} updated`);
    const ts = report.comparedAt.toISOString().replace("T", " ").slice(0, 19);
    return `[${report.label}] ${parts.join(", ")} - ${ts} UTC`;
}
