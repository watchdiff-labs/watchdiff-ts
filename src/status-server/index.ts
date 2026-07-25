/**
 * StatusServer - lightweight HTTP server using Node.js built-in `http` module.
 *
 * Endpoints:
 *   GET /health   - {"status":"ok"}
 *   GET /status   - JSON array of WatcherStatus objects
 *   GET /metrics  - Prometheus text exposition format
 */

import { createServer, type Server } from "node:http";
import type { WatcherStatus } from "../models.js";

type StatusProvider = () => WatcherStatus[];

export class StatusServer {
    private server: Server | null = null;

    start(port: number, getStatuses: StatusProvider): void {
        this.server = createServer((req, res) => {
            const url = req.url ?? "/";

            if (url === "/health") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ok" }));
                return;
            }

            if (url === "/status") {
                const statuses = getStatuses();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(statuses, dateReplacer, 2));
                return;
            }

            if (url === "/metrics") {
                const statuses = getStatuses();
                res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
                res.end(buildPrometheusMetrics(statuses));
                return;
            }

            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        });

        this.server.listen(port, () => {
            console.info(`[watchdiff] Status server listening on http://0.0.0.0:${port}`);
        });

        this.server.unref();
    }

    stop(): void {
        this.server?.close();
        this.server = null;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    return value;
}

function labelEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function buildPrometheusMetrics(statuses: WatcherStatus[]): string {
    const lines: string[] = [];

    const metric = (name: string, help: string, type: string, rows: string[]) => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(...rows);
    };

    metric(
        "watchdiff_checks_total",
        "Total number of checks performed per URL.",
        "counter",
        statuses.map((s) => `watchdiff_checks_total{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.checksCount}`)
    );

    metric(
        "watchdiff_changes_total",
        "Total number of checks that produced at least one change.",
        "counter",
        statuses.map((s) => `watchdiff_changes_total{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.changesCount}`)
    );

    metric(
        "watchdiff_errors_total",
        "Total number of fetch or parse errors.",
        "counter",
        statuses.map((s) => `watchdiff_errors_total{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.errorsCount}`)
    );

    metric(
        "watchdiff_paused",
        "1 if the watcher is currently paused, 0 otherwise.",
        "gauge",
        statuses.map((s) => `watchdiff_paused{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.paused ? 1 : 0}`)
    );

    metric(
        "watchdiff_interval_seconds",
        "Configured check interval in seconds.",
        "gauge",
        statuses.map((s) => `watchdiff_interval_seconds{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.interval}`)
    );

    metric(
        "watchdiff_last_change_timestamp_seconds",
        "Unix timestamp of the last detected change (0 if never).",
        "gauge",
        statuses.map((s) => {
            const ts = s.lastChangeAt ? Math.floor(s.lastChangeAt.getTime() / 1000) : 0;
            return `watchdiff_last_change_timestamp_seconds{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${ts}`;
        })
    );

    metric(
        "watchdiff_last_check_timestamp_seconds",
        "Unix timestamp of the last completed check (0 if never).",
        "gauge",
        statuses.map((s) => {
            const ts = s.lastCheckAt ? Math.floor(s.lastCheckAt.getTime() / 1000) : 0;
            return `watchdiff_last_check_timestamp_seconds{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${ts}`;
        })
    );

    metric(
        "watchdiff_last_http_status",
        "Last known HTTP status code (0 = unknown / unreachable).",
        "gauge",
        statuses.map((s) => `watchdiff_last_http_status{url="${labelEscape(s.url)}",label="${labelEscape(s.label)}"} ${s.lastStatusCode}`)
    );

    lines.push("");
    return lines.join("\n");
}
