import { describe, it, expect } from "vitest";
import {
    makeDbWatchConfig,
    makeDbSnapshot,
    dbSnapshotKey,
    dbHasChanges,
    dbReportSummary,
} from "./db-models.js";
import { DbDiffEngine } from "./db-diff/index.js";
import { WatchDiff } from "./core.js";

// ---------------------------------------------------------------------------
// WatchDiff.watchDb / getDbStatuses
// ---------------------------------------------------------------------------

describe("WatchDiff.watchDb", () => {
    it("is chainable", () => {
        const wd = new WatchDiff();
        expect(wd.watchDb("sqlite:///test.db", "t")).toBe(wd);
    });

    it("getDbStatuses returns [] before start", () => {
        const wd = new WatchDiff();
        wd.watchDb("sqlite:///test.db", "t");
        expect(wd.getDbStatuses()).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// makeDbWatchConfig
// ---------------------------------------------------------------------------

describe("makeDbWatchConfig", () => {
    it("detects sqlite driver", () => {
        const cfg = makeDbWatchConfig("sqlite://./test.db", "products");
        expect(cfg.driver).toBe("sqlite");
        expect(cfg.table).toBe("products");
        expect(cfg.diffMode).toBe("row");
        expect(cfg.interval).toBe(300);
        expect(cfg.alertOnInsert).toBe(true);
        expect(cfg.alertOnDelete).toBe(true);
        expect(cfg.alertOnUpdate).toBe(true);
    });

    it("detects postgres driver", () => {
        const cfg = makeDbWatchConfig("postgresql://user:pw@localhost/mydb", "orders");
        expect(cfg.driver).toBe("postgres");
    });

    it("detects postgres:// alias", () => {
        const cfg = makeDbWatchConfig("postgres://user:pw@localhost/mydb", "orders");
        expect(cfg.driver).toBe("postgres");
    });

    it("detects mysql driver", () => {
        const cfg = makeDbWatchConfig("mysql://user:pw@localhost/mydb", "users");
        expect(cfg.driver).toBe("mysql");
    });

    it("accepts overrides", () => {
        const cfg = makeDbWatchConfig("sqlite://./a.db", "t", {
            interval:      60,
            diffMode:      "schema",
            primaryKey:    ["id"],
            ignoreColumns: ["updated_at"],
            label:         "My Table",
        });
        expect(cfg.interval).toBe(60);
        expect(cfg.diffMode).toBe("schema");
        expect(cfg.primaryKey).toEqual(["id"]);
        expect(cfg.ignoreColumns).toEqual(["updated_at"]);
        expect(cfg.label).toBe("My Table");
    });
});

// ---------------------------------------------------------------------------
// dbSnapshotKey
// ---------------------------------------------------------------------------

describe("dbSnapshotKey", () => {
    it("produces a stable key", () => {
        const k1 = dbSnapshotKey("sqlite://./test.db", "products");
        const k2 = dbSnapshotKey("sqlite://./test.db", "products");
        expect(k1).toBe(k2);
        expect(k1).toMatch(/^db::[a-f0-9]{12}::products$/);
    });

    it("is different for different tables", () => {
        const k1 = dbSnapshotKey("sqlite://./test.db", "products");
        const k2 = dbSnapshotKey("sqlite://./test.db", "orders");
        expect(k1).not.toBe(k2);
    });
});

// ---------------------------------------------------------------------------
// makeDbSnapshot
// ---------------------------------------------------------------------------

describe("makeDbSnapshot", () => {
    it("computes checksum and rowCount", () => {
        const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
        const snap = makeDbSnapshot("sqlite://./t.db", "users", rows);
        expect(snap.rowCount).toBe(2);
        expect(snap.checksum).toHaveLength(64);
        expect(snap.rows).toEqual(rows);
    });

    it("same rows produce same checksum", () => {
        const rows = [{ id: 1 }];
        const a = makeDbSnapshot("sqlite://./t.db", "t", rows);
        const b = makeDbSnapshot("sqlite://./t.db", "t", rows);
        expect(a.checksum).toBe(b.checksum);
    });
});

// ---------------------------------------------------------------------------
// DbDiffEngine : row mode
// ---------------------------------------------------------------------------

describe("DbDiffEngine / row mode", () => {
    const engine = new DbDiffEngine();
    const conn   = "sqlite://./t.db";
    const table  = "products";

    function config(overrides = {}) {
        return makeDbWatchConfig(conn, table, { diffMode: "row", primaryKey: ["id"], ...overrides });
    }

    it("detects an inserted row", () => {
        const before = makeDbSnapshot(conn, table, [{ id: 1, name: "A" }]);
        const after  = makeDbSnapshot(conn, table, [{ id: 1, name: "A" }, { id: 2, name: "B" }]);
        const report = engine.compare(before, after, config());
        expect(dbHasChanges(report)).toBe(true);
        expect(report.changes).toHaveLength(1);
        expect(report.changes[0]!.kind).toBe("inserted");
        expect(report.changes[0]!.rowKey).toBe("[2]");
    });

    it("detects a deleted row", () => {
        const before = makeDbSnapshot(conn, table, [{ id: 1 }, { id: 2 }]);
        const after  = makeDbSnapshot(conn, table, [{ id: 1 }]);
        const report = engine.compare(before, after, config());
        expect(report.changes[0]!.kind).toBe("deleted");
    });

    it("detects an updated row", () => {
        const before = makeDbSnapshot(conn, table, [{ id: 1, price: 10 }]);
        const after  = makeDbSnapshot(conn, table, [{ id: 1, price: 20 }]);
        const report = engine.compare(before, after, config());
        expect(report.changes[0]!.kind).toBe("updated");
        expect(report.changes[0]!.modifications![0]!.column).toBe("price");
        expect(report.changes[0]!.modifications![0]!.before).toBe(10);
        expect(report.changes[0]!.modifications![0]!.after).toBe(20);
    });

    it("ignores specified columns", () => {
        const before = makeDbSnapshot(conn, table, [{ id: 1, updated_at: "2024-01-01" }]);
        const after  = makeDbSnapshot(conn, table, [{ id: 1, updated_at: "2024-06-01" }]);
        const report = engine.compare(before, after, config({ ignoreColumns: ["updated_at"] }));
        expect(dbHasChanges(report)).toBe(false);
    });

    it("suppresses insert alerts when alertOnInsert=false", () => {
        const before = makeDbSnapshot(conn, table, []);
        const after  = makeDbSnapshot(conn, table, [{ id: 1 }]);
        const report = engine.compare(before, after, config({ alertOnInsert: false }));
        expect(dbHasChanges(report)).toBe(false);
    });

    it("suppresses delete alerts when alertOnDelete=false", () => {
        const before = makeDbSnapshot(conn, table, [{ id: 1 }]);
        const after  = makeDbSnapshot(conn, table, []);
        const report = engine.compare(before, after, config({ alertOnDelete: false }));
        expect(dbHasChanges(report)).toBe(false);
    });

    it("reports no changes when rows are identical", () => {
        const rows   = [{ id: 1, name: "A" }];
        const before = makeDbSnapshot(conn, table, rows);
        const after  = makeDbSnapshot(conn, table, rows);
        const report = engine.compare(before, after, config());
        expect(dbHasChanges(report)).toBe(false);
    });

    it("works without a primary key (set comparison)", () => {
        const before = makeDbSnapshot(conn, table, [{ name: "A" }]);
        const after  = makeDbSnapshot(conn, table, [{ name: "A" }, { name: "B" }]);
        const report = engine.compare(before, after, makeDbWatchConfig(conn, table, { diffMode: "row" }));
        expect(report.changes[0]!.kind).toBe("inserted");
    });
});

// ---------------------------------------------------------------------------
// DbDiffEngine : schema mode
// ---------------------------------------------------------------------------

describe("DbDiffEngine / schema mode", () => {
    const engine = new DbDiffEngine();
    const conn   = "sqlite://./t.db";
    const table  = "users";

    function snap(schema: { name: string; type: string; nullable: boolean; primaryKey: boolean }[]) {
        const s = makeDbSnapshot(conn, table, []);
        s.schema = schema.map((c) => ({ ...c, defaultValue: undefined }));
        return s;
    }

    it("detects an added column", () => {
        const before = snap([{ name: "id", type: "INTEGER", nullable: false, primaryKey: true }]);
        const after  = snap([
            { name: "id",    type: "INTEGER", nullable: false, primaryKey: true },
            { name: "email", type: "TEXT",    nullable: true,  primaryKey: false },
        ]);
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "schema" });
        const report = engine.compare(before, after, cfg);
        expect(report.changes[0]!.kind).toBe("schema_changed");
        expect(report.changes[0]!.context).toBe("column added");
        expect(report.changes[0]!.column).toBe("email");
    });

    it("detects a removed column", () => {
        const before = snap([
            { name: "id",   type: "INTEGER", nullable: false, primaryKey: true },
            { name: "name", type: "TEXT",    nullable: true,  primaryKey: false },
        ]);
        const after  = snap([{ name: "id", type: "INTEGER", nullable: false, primaryKey: true }]);
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "schema" });
        const report = engine.compare(before, after, cfg);
        expect(report.changes[0]!.context).toBe("column removed");
    });

    it("detects a type change", () => {
        const before = snap([{ name: "age", type: "INTEGER", nullable: true, primaryKey: false }]);
        const after  = snap([{ name: "age", type: "REAL",    nullable: true, primaryKey: false }]);
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "schema" });
        const report = engine.compare(before, after, cfg);
        expect(report.changes[0]!.context).toBe("type changed");
    });
});

// ---------------------------------------------------------------------------
// DbDiffEngine : aggregate mode
// ---------------------------------------------------------------------------

describe("DbDiffEngine / aggregate mode", () => {
    const engine = new DbDiffEngine();
    const conn   = "sqlite://./t.db";
    const table  = "orders";

    function cfg(threshold = 0) {
        return makeDbWatchConfig(conn, table, { diffMode: "aggregate", threshold });
    }

    function snap(value: number) {
        return makeDbSnapshot(conn, table, [{ count: value }]);
    }

    it("fires when value changes beyond threshold", () => {
        const report = engine.compare(snap(100), snap(120), cfg(10));
        expect(report.changes[0]!.kind).toBe("threshold_exceeded");
        expect(report.changes[0]!.before).toBe(100);
        expect(report.changes[0]!.after).toBe(120);
    });

    it("does not fire when change is below threshold", () => {
        const report = engine.compare(snap(100), snap(105), cfg(10));
        expect(dbHasChanges(report)).toBe(false);
    });

    it("fires on any change when threshold=0", () => {
        const report = engine.compare(snap(100), snap(101), cfg(0));
        expect(dbHasChanges(report)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// DbDiffEngine : value mode
// ---------------------------------------------------------------------------

describe("DbDiffEngine / value mode", () => {
    const engine = new DbDiffEngine();
    const conn   = "sqlite://./t.db";
    const table  = "config";

    function snap(val: unknown) {
        return makeDbSnapshot(conn, table, [{ value: val }]);
    }

    it("fires when value changes", () => {
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "value" });
        const report = engine.compare(snap("v1"), snap("v2"), cfg);
        expect(report.changes[0]!.kind).toBe("value_changed");
        expect(report.changes[0]!.before).toBe("v1");
        expect(report.changes[0]!.after).toBe("v2");
    });

    it("is silent when value is the same", () => {
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "value" });
        const report = engine.compare(snap("v1"), snap("v1"), cfg);
        expect(dbHasChanges(report)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// dbReportSummary
// ---------------------------------------------------------------------------

describe("dbReportSummary", () => {
    const engine = new DbDiffEngine();
    const conn   = "sqlite://./t.db";
    const table  = "items";

    it("summarises inserted/deleted/updated counts", () => {
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "row", primaryKey: ["id"] });
        const before = makeDbSnapshot(conn, table, [{ id: 1 }, { id: 2 }]);
        const after  = makeDbSnapshot(conn, table, [{ id: 1, x: 1 }, { id: 3 }]);
        const report = engine.compare(before, after, cfg);
        const text   = dbReportSummary(report);
        expect(text).toContain("inserted");
        expect(text).toContain("deleted");
    });

    it("says no changes when empty", () => {
        const cfg    = makeDbWatchConfig(conn, table, { diffMode: "row" });
        const rows   = [{ id: 1 }];
        const snap   = makeDbSnapshot(conn, table, rows);
        const report = engine.compare(snap, makeDbSnapshot(conn, table, rows), cfg);
        expect(dbReportSummary(report)).toContain("No changes detected");
    });
});
