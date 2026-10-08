/**
 * Exporter - export snapshot history and diff reports to CSV or XLSX.
 *
 * CSV is built natively (no extra dependency).
 * XLSX requires exceljs (optional peer dependency).
 * Install: npm install exceljs
 */

import type { IStore, Snapshot } from "../models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "csv" | "xlsx" | "json";
export type ExportType   = "reports" | "snapshots";

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

export class Exporter {
    constructor(private readonly store: IStore) {}

    // ------------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------------

    /**
     * Export diff reports to CSV string.
     * One row per change entry (url, label, comparedAt, kind, before, after).
     */
    reportsToCsv(url: string, target?: string, limit = 100): string {
        const rows  = this.store.loadReports(url, target, limit);
        const lines = [csvRow(["url", "label", "comparedAt", "kind", "before", "after"])];

        for (const rep of rows) {
            const changes = rep["changes"] as Array<{ kind: string; before?: string; after?: string }>;
            for (const c of changes ?? []) {
                lines.push(csvRow([
                    String(rep["url"] ?? ""),
                    String(rep["label"] ?? ""),
                    String(rep["comparedAt"] ?? ""),
                    c.kind,
                    c.before ?? "",
                    c.after  ?? "",
                ]));
            }
        }

        return lines.join("\n");
    }

    /**
     * Export snapshot history to CSV string.
     * One row per snapshot (url, target, capturedAt, checksum, contentPreview).
     */
    snapshotsToCsv(url: string, target?: string, limit = 100): string {
        const snaps = this.store.loadHistory(url, target, limit);
        const lines = [csvRow(["url", "target", "capturedAt", "checksum", "contentPreview"])];

        for (const snap of snaps) {
            lines.push(csvRow([
                snap.url,
                snap.target ?? "",
                snap.capturedAt.toISOString(),
                snap.checksum,
                snap.content.slice(0, 200).replace(/\n/g, " "),
            ]));
        }

        return lines.join("\n");
    }

    // ------------------------------------------------------------------
    // JSON
    // ------------------------------------------------------------------

    /**
     * Export diff reports to a formatted JSON string.
     */
    exportReportsJson(url: string, target?: string, limit = 100): string {
        const rows = this.store.loadReports(url, target, limit);
        return JSON.stringify(rows, null, 2);
    }

    /**
     * Export snapshot history to a formatted JSON string.
     */
    exportSnapshotsJson(url: string, target?: string, limit = 100): string {
        const snaps = this.store.loadHistory(url, target, limit);
        const data = snaps.map((s) => ({
            url:            s.url,
            target:         s.target,
            capturedAt:     s.capturedAt.toISOString(),
            checksum:       s.checksum,
            content:        s.content,
        }));
        return JSON.stringify(data, null, 2);
    }

    // ------------------------------------------------------------------
    // XLSX
    // ------------------------------------------------------------------

    /**
     * Export diff reports to an XLSX Buffer.
     * Requires: npm install exceljs
     */
    async reportsToXlsx(url: string, target?: string, limit = 100): Promise<Buffer> {
        const rows = this.store.loadReports(url, target, limit);

        const ExcelJS = await loadExcelJS();
        const wb      = new ExcelJS.Workbook();
        const ws      = wb.addWorksheet("Reports");

        ws.columns = [
            { header: "url",         key: "url",         width: 40 },
            { header: "label",       key: "label",       width: 20 },
            { header: "comparedAt",  key: "comparedAt",  width: 22 },
            { header: "kind",        key: "kind",        width: 10 },
            { header: "before",      key: "before",      width: 40 },
            { header: "after",       key: "after",       width: 40 },
        ];

        for (const rep of rows) {
            const changes = rep["changes"] as Array<{ kind: string; before?: string; after?: string }>;
            for (const c of changes ?? []) {
                ws.addRow({
                    url:        rep["url"],
                    label:      rep["label"],
                    comparedAt: rep["comparedAt"],
                    kind:       c.kind,
                    before:     c.before ?? "",
                    after:      c.after  ?? "",
                });
            }
        }

        return wb.xlsx.writeBuffer() as Promise<Buffer>;
    }

    /**
     * Export snapshot history to an XLSX Buffer.
     * Requires: npm install exceljs
     */
    async snapshotsToXlsx(url: string, target?: string, limit = 100): Promise<Buffer> {
        const snaps = this.store.loadHistory(url, target, limit);

        const ExcelJS = await loadExcelJS();
        const wb      = new ExcelJS.Workbook();
        const ws      = wb.addWorksheet("Snapshots");

        ws.columns = [
            { header: "url",            key: "url",            width: 40 },
            { header: "target",         key: "target",         width: 20 },
            { header: "capturedAt",     key: "capturedAt",     width: 22 },
            { header: "checksum",       key: "checksum",       width: 20 },
            { header: "contentPreview", key: "contentPreview", width: 60 },
        ];

        for (const snap of snaps) {
            ws.addRow({
                url:            snap.url,
                target:         snap.target ?? "",
                capturedAt:     snap.capturedAt.toISOString(),
                checksum:       snap.checksum,
                contentPreview: snap.content.slice(0, 300).replace(/\n/g, " "),
            });
        }

        return wb.xlsx.writeBuffer() as Promise<Buffer>;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a CSV cell value (RFC 4180). */
function csvCell(value: string): string {
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function csvRow(cells: string[]): string {
    return cells.map(csvCell).join(",");
}

type ExcelJSModule = {
    Workbook: new () => {
        addWorksheet(name: string): {
            columns: Array<{ header: string; key: string; width: number }>;
            addRow(data: Record<string, unknown>): void;
        };
        xlsx: { writeBuffer(): Promise<Buffer> };
    };
};

async function loadExcelJS(): Promise<ExcelJSModule> {
    try {
        const mod = await import("exceljs") as { default: ExcelJSModule } | ExcelJSModule;
        return ("default" in mod ? mod.default : mod) as ExcelJSModule;
    } catch {
        throw new Error(
            "exceljs is not installed.\n" +
            "Run: npm install exceljs"
        );
    }
}
