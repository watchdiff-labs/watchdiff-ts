import { program } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { WatchDiff } from "../index.js";
import { changeHuman, reportSummary } from "../models.js";
import { dbReportSummary } from "../db-models.js";
import type { WatchOptions, DbWatchOptions } from "../core.js";

program
    .name("watchdiff")
    .description("Lightweight web change monitoring - clean diffs, no AI required.")
    .version("0.2.0");

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

program
    .command("run [url]")
    .description("Start continuous monitoring (Ctrl+C to stop). Pass a URL or --config file.")
    .option("-t, --target <selector>",    "CSS selector or XPath expression to watch")
    .option("-i, --interval <seconds>",   "Seconds between checks (env: WATCHDIFF_INTERVAL)")
    .option("-w, --webhook <url>",        "Webhook URL to POST on change (env: WATCHDIFF_WEBHOOK)")
    .option("-s, --storage <dir>",        "Storage directory (env: WATCHDIFF_STORAGE)")
    .option("-c, --config <file>",        "JSON config file (watchdiff.config.json)")
    .option("--browser",                  "Use headless Playwright browser for JS-heavy pages (env: WATCHDIFF_BROWSER)")
    .option("--proxy <url>",              "Proxy URL (e.g. http://user:pass@host:port)")
    .option("--user-agent <ua>",          "Custom User-Agent string")
    .option("--diff-mode <mode>",         "Diff mode: 'line' (default), 'semantic', 'word', 'json', or 'rss' (env: WATCHDIFF_DIFF_MODE)")
    .option("--cooldown <seconds>",       "Minimum seconds between two alerts for the same URL (env: WATCHDIFF_COOLDOWN)")
    .option("--retries <n>",              "Number of fetch retries on error (env: WATCHDIFF_RETRIES)")
    .option("--jitter <factor>",          "Interval jitter 0-1, e.g. 0.2 = ±20% variance (env: WATCHDIFF_JITTER)")
    .option("--dry-run",                  "Fetch and diff without saving or alerting")
    .option("--max-snapshots <n>",        "Keep only the last N snapshots per URL")
    .option("--change-threshold <ratio>", "Minimum fraction 0-1 of content that must change to alert")
    .option("--ignore-numbers",           "Ignore standalone number changes (counters, dates)")
    .option("--alert-if-no-change <sec>", "Fire silence alert after N seconds without a change")
    .option("--archive-html",             "Save full-page HTML to disk on every change")
    .option("--screenshot",               "Capture PNG screenshot on change (requires --browser)")
    .option("--spike-window <sec>",       "Spike detection time window in seconds")
    .option("--spike-threshold <n>",      "Alert when N changes occur inside the spike window")
    .option("--status-port <port>",       "Start HTTP status server on this port (/health /status /metrics)")
    .option("--alert-on-status-change",   "Alert when the HTTP status code changes (e.g. 200 → 503)")
    .option("--log-format <format>",      "Log format: 'text' (default) or 'json' (env: WATCHDIFF_LOG_FORMAT)")
    .option("-q, --quiet",                "Suppress all output except errors")
    .option("-v, --verbose",              "Show debug output (no-change ticks, cooldown skips, etc.)")
    .action((url: string | undefined, opts: Record<string, string | boolean | undefined>) => {
        applyOutput(opts);
        const storage = (opts["storage"] as string | undefined) ?? process.env["WATCHDIFF_STORAGE"] ?? ".watchdiff";
        const wd      = new WatchDiff(storage);

        if (opts["config"]) {
            const cfg = loadConfig(opts["config"] as string);
            applyConfig(wd, cfg);
        } else if (url) {
            wd.watch(url, buildWatchOptions(opts));
        } else {
            const defaultCfg = "watchdiff.config.json";
            if (existsSync(defaultCfg)) {
                if (!opts["quiet"]) console.log(chalk.gray(`Using ${defaultCfg}`));
                applyConfig(wd, loadConfig(defaultCfg));
            } else {
                console.error(chalk.red("Provide a URL or --config file (or run watchdiff init)."));
                process.exit(1);
            }
        }

        if (!opts["quiet"]) {
            wd.onChange((report) => {
                console.log(chalk.yellow(`\n${reportSummary(report)}`));
                for (const change of report.changes) {
                    const line = "  " + changeHuman(change);
                    if (change.kind === "added")        console.log(chalk.green(line));
                    else if (change.kind === "removed")  console.log(chalk.red(line));
                    else                                 console.log(chalk.yellow(line));
                }
            });
        }

        const statusPort = opts["statusPort"] !== undefined ? parseInt(opts["statusPort"] as string, 10) : undefined;
        if (statusPort) {
            wd.startStatusServer(statusPort);
        }

        const stop = wd.start();

        process.on("SIGINT", () => {
            if (!opts["quiet"]) console.log(chalk.gray("\nStopping..."));
            wd.stopStatusServer();
            stop();
            process.exit(0);
        });
    });

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

program
    .command("compare <urlA> <urlB>")
    .description("Fetch and diff two URLs on the spot (no storage needed)")
    .option("-t, --target <selector>", "CSS selector or XPath expression")
    .option("--browser",               "Use headless Playwright browser")
    .option("--diff-mode <mode>",      "Diff mode: line, semantic, word, json, or rss")
    .option("--json",                  "Output raw JSON")
    .option("-q, --quiet",             "Suppress all output except errors")
    .action(async (urlA: string, urlB: string, opts: Record<string, string | boolean | undefined>) => {
        applyOutput(opts);
        const wd = new WatchDiff();
        try {
            const report = await wd.compareUrls(urlA, urlB, buildWatchOptions(opts));

            if (opts["json"]) {
                console.log(JSON.stringify(report, null, 2));
                return;
            }

            if (!opts["quiet"]) {
                if (report.changes.length === 0) {
                    console.log(chalk.green("No differences found."));
                } else {
                    console.log(chalk.bold(`\n${report.changes.length} difference(s) between the two URLs\n`));
                    for (const change of report.changes) {
                        const line = "  " + changeHuman(change);
                        if (change.kind === "added")        console.log(chalk.green(line));
                        else if (change.kind === "removed")  console.log(chalk.red(line));
                        else                                 console.log(chalk.yellow(line));
                    }
                }
            }
        } catch (err) {
            console.error(chalk.red(err instanceof Error ? err.message : String(err)));
            process.exit(1);
        }
    });

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

program
    .command("check <url>")
    .description("Run a single check and print the result")
    .option("-t, --target <selector>",   "CSS selector or XPath expression to watch")
    .option("-s, --storage <dir>",       "Storage directory", ".watchdiff")
    .option("--browser",                 "Use headless Playwright browser")
    .option("--diff-mode <mode>",        "Diff mode: 'line', 'semantic', 'word', or 'json'")
    .option("--retries <n>",             "Number of fetch retries on error")
    .option("--dry-run",                 "Fetch and diff without saving")
    .option("--json",                    "Output raw JSON")
    .option("--log-format <format>",     "Log format: 'text' (default) or 'json'")
    .option("-q, --quiet",               "Suppress all output except errors")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        applyOutput(opts);
        const wd = new WatchDiff((opts["storage"] as string | undefined) ?? ".watchdiff");
        wd.watch(url, buildWatchOptions(opts));

        const report = await wd.checkOnce(url);

        if (!report) {
            if (!opts["quiet"]) console.log(chalk.blue("First snapshot captured."));
            return;
        }

        if (opts["json"]) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        if (!opts["quiet"]) {
            console.log(reportSummary(report));
            for (const change of report.changes) {
                const line = "  " + changeHuman(change);
                if (change.kind === "added")        console.log(chalk.green(line));
                else if (change.kind === "removed")  console.log(chalk.red(line));
                else                                 console.log(chalk.yellow(line));
            }
        }
    });

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

program
    .command("status")
    .description("Show runtime status of all registered watchers (requires --config)")
    .option("-c, --config <file>",  "JSON config file (watchdiff.config.json)")
    .option("-s, --storage <dir>",  "Storage directory", ".watchdiff")
    .option("--json",               "Output raw JSON")
    .action((opts: Record<string, string | boolean | undefined>) => {
        const cfgPath = (opts["config"] as string | undefined) ?? "watchdiff.config.json";

        if (!existsSync(cfgPath)) {
            console.error(chalk.red(`Config file not found: ${cfgPath}. Run watchdiff init first.`));
            process.exit(1);
        }

        const cfg = loadConfig(cfgPath);
        const wd  = new WatchDiff((opts["storage"] as string | undefined) ?? cfg.storage ?? ".watchdiff");
        applyConfig(wd, cfg);

        const statuses = wd.status();

        if (opts["json"]) {
            console.log(JSON.stringify(statuses, null, 2));
            return;
        }

        console.log(chalk.bold("\nWatcher status\n"));
        for (const s of statuses) {
            const paused = s.paused ? chalk.yellow(" [PAUSED]") : "";
            console.log(`  ${chalk.cyan(s.label)}${paused}`);
            console.log(`    URL:          ${s.url}`);
            if (s.target) console.log(`    Target:       ${s.target}`);
            console.log(`    Interval:     ${s.interval}s`);
            console.log(`    Last check:   ${s.lastCheckAt ? fmtDate(s.lastCheckAt) : chalk.gray("never")}`);
            console.log(`    Next check:   ${s.nextCheckAt ? fmtDate(s.nextCheckAt) : chalk.gray("-")}`);
            console.log(`    Last change:  ${s.lastChangeAt ? fmtDate(s.lastChangeAt) : chalk.gray("none")}`);
            console.log(`    Checks:       ${s.checksCount}   Changes: ${s.changesCount}`);
            console.log();
        }
    });

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

program
    .command("diff <url>")
    .description("Show the last stored diff report for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .option("--json",                  "Output raw JSON")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] });

        const reps = wd.reports(url, 1);

        if (reps.length === 0) {
            console.log(chalk.gray("No diff reports found for this URL."));
            return;
        }

        const rep = reps[0]!;

        if (opts["json"]) {
            console.log(JSON.stringify(rep, null, 2));
            return;
        }

        const changes = rep["changes"] as Array<{ kind: string; before?: string; after?: string; context?: string }>;
        const date    = String(rep["comparedAt"]).slice(0, 19).replace("T", " ");

        console.log(chalk.bold(`\nLast diff for ${url}  (${date} UTC)\n`));
        for (const c of changes) {
            const ctx  = c.context ? chalk.gray(` (${c.context})`) : "";
            if (c.kind === "added")       console.log(chalk.green(`  [+] ${c.after ?? ""}`) + ctx);
            else if (c.kind === "removed") console.log(chalk.red(`  [-] ${c.before ?? ""}`) + ctx);
            else                           console.log(chalk.yellow(`  [~] ${c.before ?? ""} -> ${c.after ?? ""}`) + ctx);
        }
    });

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

program
    .command("history <url>")
    .description("Show snapshot history for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>",    "Number of entries to show", "10")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] });

        const snapshots = wd.history(url, parseInt(opts["limit"] ?? "10", 10));

        if (snapshots.length === 0) {
            console.log(chalk.gray("No history found."));
            return;
        }

        console.log(chalk.bold(`\nSnapshot history for ${url}\n`));
        for (const snap of snapshots) {
            const date     = snap.capturedAt.toISOString().replace("T", " ").slice(0, 19);
            const checksum = snap.checksum.slice(0, 8);
            const preview  = snap.content.slice(0, 60).replace(/\n/g, " ");
            console.log(`  ${chalk.gray(date)}  ${chalk.cyan(checksum)}  ${preview}`);
        }
    });

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

program
    .command("reports <url>")
    .description("Show diff reports for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-n, --limit <number>",    "Number of reports to show", "10")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .action((url: string, opts: Record<string, string | undefined>) => {
        const wd = new WatchDiff(opts["storage"] ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] });

        const reps = wd.reports(url, parseInt(opts["limit"] ?? "10", 10));

        if (reps.length === 0) {
            console.log(chalk.gray("No reports found."));
            return;
        }

        console.log(chalk.bold(`\nReports for ${url}\n`));
        for (const rep of reps) {
            const changes = rep["changes"] as Array<{ kind: string; before?: string; after?: string }>;
            const date    = String(rep["comparedAt"]).slice(0, 19).replace("T", " ");
            console.log(`  ${chalk.gray(date)}  ${changes.length} change(s)`);
            for (const c of changes) {
                if (c.kind === "added")        console.log(chalk.green(`    [+] ${c.after ?? ""}`));
                else if (c.kind === "removed")  console.log(chalk.red(`    [-] ${c.before ?? ""}`));
                else                            console.log(chalk.yellow(`    [~] ${c.before ?? ""} -> ${c.after ?? ""}`));
            }
        }
    });

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

program
    .command("clear <url>")
    .description("Delete all stored data for a URL")
    .option("-t, --target <selector>", "CSS selector")
    .option("-s, --storage <dir>",     "Storage directory", ".watchdiff")
    .option("-y, --yes",               "Skip confirmation prompt")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        if (!opts["yes"]) {
            const readline = await import("node:readline");
            const rl       = readline.createInterface({ input: process.stdin, output: process.stdout });
            const answer   = await new Promise<string>((resolve) => {
                rl.question(chalk.yellow(`Delete all data for ${url}? [y/N] `), resolve);
            });
            rl.close();
            if (answer.toLowerCase() !== "y") {
                console.log("Aborted.");
                return;
            }
        }

        const wd = new WatchDiff((opts["storage"] as string | undefined) ?? ".watchdiff");
        wd.watch(url, { target: opts["target"] as string | undefined });
        wd.clear(url);
        console.log(chalk.green(`Cleared all data for ${url}.`));
    });

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

program
    .command("export <url>")
    .description("Export history or reports to CSV or XLSX")
    .option("-t, --target <selector>",  "CSS selector")
    .option("-s, --storage <dir>",      "Storage directory", ".watchdiff")
    .option("-f, --format <fmt>",       "Output format: csv (default) or xlsx", "csv")
    .option("--type <type>",            "What to export: reports (default) or snapshots", "reports")
    .option("-n, --limit <number>",     "Number of entries to export", "100")
    .option("-o, --output <file>",      "Output file path (prints to stdout if omitted)")
    .action(async (url: string, opts: Record<string, string | undefined>) => {
        const storage = opts["storage"] ?? ".watchdiff";
        const format  = opts["format"]  ?? "csv";
        const type    = opts["type"]    ?? "reports";
        const limit   = parseInt(opts["limit"] ?? "100", 10);
        const output  = opts["output"];

        const wd = new WatchDiff(storage);
        wd.watch(url, { target: opts["target"] });

        if (format === "csv") {
            const csv = type === "snapshots"
                ? wd.exportSnapshotsCsv(url, limit)
                : wd.exportReportsCsv(url, limit);

            if (output) {
                writeFileSync(output, csv, "utf-8");
                console.log(chalk.green(`Exported to ${output}`));
            } else {
                process.stdout.write(csv + "\n");
            }
        } else if (format === "xlsx") {
            if (!output) {
                console.error(chalk.red("--output <file.xlsx> is required for xlsx format."));
                process.exit(1);
            }
            try {
                const buf = type === "snapshots"
                    ? await wd.exportSnapshotsXlsx(url, limit)
                    : await wd.exportReportsXlsx(url, limit);
                writeFileSync(output, buf);
                console.log(chalk.green(`Exported to ${output}`));
            } catch (err) {
                console.error(chalk.red(err instanceof Error ? err.message : String(err)));
                process.exit(1);
            }
        } else {
            console.error(chalk.red(`Unknown format: ${format}. Use 'csv' or 'xlsx'.`));
            process.exit(1);
        }
    });

// ---------------------------------------------------------------------------
// db
// ---------------------------------------------------------------------------

program
    .command("db <connectionString> <table>")
    .description(
        "Monitor a database table for changes.\n" +
        "  Connection string formats:\n" +
        "    sqlite://./path/to/db.sqlite\n" +
        "    postgresql://user:pass@host:5432/dbname\n" +
        "    mysql://user:pass@host:3306/dbname"
    )
    .option("-i, --interval <seconds>",      "Seconds between checks (default 300)")
    .option("-w, --webhook <url>",           "Webhook URL to POST on change")
    .option("-s, --storage <dir>",           "Storage directory", ".watchdiff")
    .option("--diff-mode <mode>",            "row (default) | schema | aggregate | value")
    .option("--primary-key <cols>",          "Comma-separated primary key column(s)")
    .option("--ignore-columns <cols>",       "Comma-separated columns to skip")
    .option("--label <label>",               "Human-readable label")
    .option("--query <sql>",                 "Custom SELECT query (overrides default SELECT *)")
    .option("--threshold <pct>",             "Alert threshold % for aggregate mode (default 0)")
    .option("--cooldown <seconds>",          "Min seconds between consecutive alerts")
    .option("--dry-run",                     "Fetch and diff without saving or alerting")
    .option("--max-snapshots <n>",           "Keep only the last N snapshots")
    .option("--no-insert",                   "Suppress insert alerts")
    .option("--no-delete",                   "Suppress delete alerts")
    .option("--no-update",                   "Suppress update alerts")
    .option("--json",                        "Output raw JSON on each change")
    .option("-q, --quiet",                   "Suppress all output except errors")
    .action(async (
        connectionString: string,
        table: string,
        opts: Record<string, string | boolean | undefined>
    ) => {
        applyOutput(opts);

        const storage = (opts["storage"] as string | undefined) ?? process.env["WATCHDIFF_STORAGE"] ?? ".watchdiff";
        const wd      = new WatchDiff(storage);

        const dbOpts: DbWatchOptions = {};

        const interval = opts["interval"] ? parseInt(opts["interval"] as string, 10) : undefined;
        if (interval !== undefined) dbOpts.interval = interval;

        const webhook = opts["webhook"] as string | undefined;
        if (webhook) dbOpts.webhooks = [webhook];

        const diffMode = opts["diffMode"] as string | undefined;
        if (diffMode) dbOpts.diffMode = diffMode as DbWatchOptions["diffMode"];

        const primaryKey = opts["primaryKey"] as string | undefined;
        if (primaryKey) dbOpts.primaryKey = primaryKey.split(",").map((s) => s.trim());

        const ignoreColumns = opts["ignoreColumns"] as string | undefined;
        if (ignoreColumns) dbOpts.ignoreColumns = ignoreColumns.split(",").map((s) => s.trim());

        const label = opts["label"] as string | undefined;
        if (label) dbOpts.label = label;

        const query = opts["query"] as string | undefined;
        if (query) dbOpts.query = query;

        const threshold = opts["threshold"] ? parseFloat(opts["threshold"] as string) : undefined;
        if (threshold !== undefined) dbOpts.threshold = threshold;

        const cooldown = opts["cooldown"] ? parseInt(opts["cooldown"] as string, 10) : undefined;
        if (cooldown !== undefined) dbOpts.cooldown = cooldown;

        if (opts["dryRun"])    dbOpts.dryRun        = true;
        if (opts["insert"] === false) dbOpts.alertOnInsert = false;
        if (opts["delete"] === false) dbOpts.alertOnDelete = false;
        if (opts["update"] === false) dbOpts.alertOnUpdate = false;

        const maxSnap = opts["maxSnapshots"] ? parseInt(opts["maxSnapshots"] as string, 10) : undefined;
        if (maxSnap !== undefined) dbOpts.maxSnapshots = maxSnap;

        if (!opts["quiet"]) {
            dbOpts.onChange = (report) => {
                if (opts["json"]) {
                    console.log(JSON.stringify(report, null, 2));
                    return;
                }
                console.log(chalk.yellow(`\n${dbReportSummary(report)}`));
                for (const change of report.changes) {
                    const key  = change.rowKey ? chalk.gray(` [key: ${change.rowKey}]`) : "";
                    if (change.kind === "inserted") {
                        console.log(chalk.green(`  [+] inserted${key}`));
                    } else if (change.kind === "deleted") {
                        console.log(chalk.red(`  [-] deleted${key}`));
                    } else if (change.kind === "updated") {
                        console.log(chalk.yellow(`  [~] updated${key}`));
                        for (const mod of change.modifications ?? []) {
                            console.log(chalk.yellow(`      ${mod.column}: ${JSON.stringify(mod.before)} → ${JSON.stringify(mod.after)}`));
                        }
                    } else if (change.kind === "schema_changed") {
                        console.log(chalk.magenta(`  [schema] ${change.column ?? ""}: ${change.context ?? ""}`));
                    } else if (change.kind === "threshold_exceeded") {
                        console.log(chalk.red(`  [threshold] ${change.context ?? ""}`));
                    } else if (change.kind === "value_changed") {
                        console.log(chalk.yellow(`  [value] ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`));
                    }
                }
            };
        }

        wd.watchDb(connectionString, table, dbOpts);

        const stop = wd.start();

        process.on("SIGINT", () => {
            if (!opts["quiet"]) console.log(chalk.gray("\nStopping..."));
            stop();
            process.exit(0);
        });
    });

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

program
    .command("init")
    .description("Generate a watchdiff.config.json template in the current directory")
    .option("-f, --force", "Overwrite existing config file")
    .action((opts: { force?: boolean }) => {
        const dest = "watchdiff.config.json";

        if (existsSync(dest) && !opts.force) {
            console.error(chalk.red(`${dest} already exists. Use --force to overwrite.`));
            process.exit(1);
        }

        const template = {
            storage: ".watchdiff",
            watches: [
                {
                    url:                  "https://example.com",
                    target:               ".price",
                    interval:             300,
                    label:                "Example - Product Price",
                    browser:              false,
                    diffMode:             "line",
                    cooldown:             0,
                    retries:              0,
                    jitter:               0,
                    dryRun:               false,
                    maxSnapshots:         100,
                    changeThreshold:      0,
                    ignoreNumbers:        false,
                    alertIfNoChangeAfter: 0,
                    webhooks:             [] as string[],
                    ignoreSelectors:      [] as string[],
                    proxies:              [] as string[],
                    userAgents:           [] as string[],
                },
            ],
        };

        writeFileSync(dest, JSON.stringify(template, null, 2) + "\n", "utf-8");
        console.log(chalk.green(`Created ${dest}`));
        console.log(chalk.gray("\nEdit the file, then run:"));
        console.log(chalk.bold(`  watchdiff run --config ${dest}`));
        console.log(chalk.gray("  or just: watchdiff run    (auto-discovers watchdiff.config.json)"));
    });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConfigFile {
    storage?: string;
    watches: Array<{
        url:                   string;
        target?:               string;
        interval?:             number;
        label?:                string;
        browser?:              boolean;
        diffMode?:             string;
        webhooks?:             string[];
        ignoreSelectors?:      string[];
        proxies?:              string[];
        userAgents?:           string[];
        headers?:              Record<string, string>;
        timeout?:              number;
        minChanges?:           number;
        cooldown?:             number;
        retries?:              number;
        retryDelay?:           number;
        jitter?:               number;
        dryRun?:               boolean;
        maxSnapshots?:         number;
        changeThreshold?:      number;
        ignoreNumbers?:        boolean;
        alertIfNoChangeAfter?: number;
        webhookRetries?:       number;
        archiveHtml?:          boolean;
        screenshotOnChange?:   boolean;
        changeSpikeWindow?:    number;
        changeSpikeThreshold?: number;
    }>;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

const VALID_DIFF_MODES = new Set(["line", "semantic", "word", "json", "rss"]);

interface ConfigError { path: string; message: string; }

function validateConfigFile(raw: unknown, filePath: string): void {
    const errors: ConfigError[] = [];

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        errors.push({ path: "", message: "root must be an object" });
        exitWithConfigErrors(errors, filePath);
    }

    const cfg = raw as Record<string, unknown>;

    if (!Array.isArray(cfg["watches"])) {
        errors.push({ path: "watches", message: "must be an array" });
        exitWithConfigErrors(errors, filePath);
    }

    const watches = cfg["watches"] as unknown[];
    if (watches.length === 0) {
        errors.push({ path: "watches", message: "array must not be empty" });
    }

    for (let i = 0; i < watches.length; i++) {
        const w   = watches[i];
        const pfx = `watches[${i}]`;

        if (typeof w !== "object" || w === null || Array.isArray(w)) {
            errors.push({ path: pfx, message: "must be an object" });
            continue;
        }

        const e = w as Record<string, unknown>;

        if (typeof e["url"] !== "string" || !e["url"]) {
            errors.push({ path: `${pfx}.url`, message: "required string" });
        } else {
            try { new URL(e["url"]); } catch {
                errors.push({ path: `${pfx}.url`, message: `invalid URL: ${e["url"]}` });
            }
        }

        if (e["diffMode"] !== undefined && !VALID_DIFF_MODES.has(String(e["diffMode"]))) {
            errors.push({ path: `${pfx}.diffMode`, message: `must be one of: ${[...VALID_DIFF_MODES].join(", ")}` });
        }

        for (const key of ["jitter", "changeThreshold"] as const) {
            const v = e[key];
            if (v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) {
                errors.push({ path: `${pfx}.${key}`, message: "must be a number between 0 and 1" });
            }
        }

        for (const key of ["interval", "timeout", "cooldown", "retries", "retryDelay", "maxSnapshots", "alertIfNoChangeAfter", "minChanges", "webhookRetries"] as const) {
            const v = e[key];
            if (v !== undefined && (typeof v !== "number" || v < 0)) {
                errors.push({ path: `${pfx}.${key}`, message: "must be a non-negative number" });
            }
        }

        for (const key of ["webhooks", "ignoreSelectors", "proxies", "userAgents"] as const) {
            if (e[key] !== undefined && !Array.isArray(e[key])) {
                errors.push({ path: `${pfx}.${key}`, message: "must be an array" });
            }
        }

        if (e["headers"] !== undefined && (typeof e["headers"] !== "object" || Array.isArray(e["headers"]))) {
            errors.push({ path: `${pfx}.headers`, message: "must be an object" });
        }
    }

    if (errors.length > 0) exitWithConfigErrors(errors, filePath);
}

function exitWithConfigErrors(errors: ConfigError[], filePath: string): never {
    console.error(chalk.red(`\nConfig validation failed: ${filePath}`));
    for (const e of errors) {
        console.error(chalk.red(`  ${e.path ? `${e.path}: ` : ""}${e.message}`));
    }
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Config load / apply
// ---------------------------------------------------------------------------

function loadConfig(path: string): ConfigFile {
    if (!existsSync(path)) {
        console.error(chalk.red(`Config file not found: ${path}`));
        process.exit(1);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
        console.error(chalk.red(`Invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
    validateConfigFile(raw, path);
    return raw as ConfigFile;
}

function applyConfig(wd: WatchDiff, cfg: ConfigFile): void {
    for (const w of cfg.watches) {
        wd.watch(w.url, {
            target:               w.target,
            interval:             w.interval,
            label:                w.label,
            browser:              w.browser,
            diffMode:             w.diffMode as WatchOptions["diffMode"],
            webhooks:             w.webhooks,
            ignoreSelectors:      w.ignoreSelectors,
            proxies:              w.proxies,
            userAgents:           w.userAgents,
            headers:              w.headers,
            timeout:              w.timeout,
            minChanges:           w.minChanges,
            cooldown:             w.cooldown,
            retries:              w.retries,
            retryDelay:           w.retryDelay,
            jitter:               w.jitter,
            dryRun:               w.dryRun,
            maxSnapshots:         w.maxSnapshots,
            changeThreshold:      w.changeThreshold,
            ignoreNumbers:        w.ignoreNumbers,
            alertIfNoChangeAfter: w.alertIfNoChangeAfter,
            webhookRetries:       w.webhookRetries,
            archiveHtml:          w.archiveHtml,
            screenshotOnChange:   w.screenshotOnChange,
            changeSpikeWindow:    w.changeSpikeWindow,
            changeSpikeThreshold: w.changeSpikeThreshold,
        });
    }
}

// ---------------------------------------------------------------------------
// CLI option / env var resolution
// ---------------------------------------------------------------------------

function isTruthy(val: string): boolean {
    return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}

function buildWatchOptions(opts: Record<string, string | boolean | undefined>): WatchOptions {
    const result: WatchOptions = {};
    const env = process.env;

    const str = (key: string, envKey?: string): string | undefined =>
        (opts[key] as string | undefined) ?? (envKey ? env[envKey] : undefined);
    const num = (key: string, envKey?: string): number | undefined => {
        const v = str(key, envKey);
        return v !== undefined ? parseInt(v, 10) : undefined;
    };
    const flt = (key: string, envKey?: string): number | undefined => {
        const v = str(key, envKey);
        return v !== undefined ? parseFloat(v) : undefined;
    };
    const bool = (key: string, envKey?: string): boolean => {
        if (opts[key]) return true;
        const v = envKey ? env[envKey] : undefined;
        return v ? isTruthy(v) : false;
    };

    const target = str("target", "WATCHDIFF_TARGET");
    if (target)                              result.target            = target;
    const interval = num("interval", "WATCHDIFF_INTERVAL");
    if (interval !== undefined)              result.interval          = interval;
    const webhook = str("webhook", "WATCHDIFF_WEBHOOK");
    if (webhook)                             result.webhooks          = [webhook];
    if (bool("browser", "WATCHDIFF_BROWSER")) result.browser          = true;
    const proxy = str("proxy", "WATCHDIFF_PROXY");
    if (proxy)                               result.proxies           = [proxy];
    const ua = str("userAgent", "WATCHDIFF_USER_AGENT");
    if (ua)                                  result.userAgents        = [ua];
    const diffMode = str("diffMode", "WATCHDIFF_DIFF_MODE");
    if (diffMode)                            result.diffMode          = diffMode as WatchOptions["diffMode"];
    const cooldown = num("cooldown", "WATCHDIFF_COOLDOWN");
    if (cooldown !== undefined)              result.cooldown          = cooldown;
    const retries = num("retries", "WATCHDIFF_RETRIES");
    if (retries !== undefined)               result.retries           = retries;
    const jitter = flt("jitter", "WATCHDIFF_JITTER");
    if (jitter !== undefined)                result.jitter            = jitter;
    if (opts["dryRun"])                      result.dryRun            = true;
    const maxSnap = num("maxSnapshots", "WATCHDIFF_MAX_SNAPSHOTS");
    if (maxSnap !== undefined)               result.maxSnapshots      = maxSnap;
    const threshold = flt("changeThreshold", "WATCHDIFF_CHANGE_THRESHOLD");
    if (threshold !== undefined)             result.changeThreshold   = threshold;
    if (bool("ignoreNumbers", "WATCHDIFF_IGNORE_NUMBERS")) result.ignoreNumbers = true;
    const silence = num("alertIfNoChange", "WATCHDIFF_ALERT_IF_NO_CHANGE");
    if (silence !== undefined)               result.alertIfNoChangeAfter = silence;
    if (bool("archiveHtml", "WATCHDIFF_ARCHIVE_HTML")) result.archiveHtml = true;
    if (bool("screenshot", "WATCHDIFF_SCREENSHOT"))    result.screenshotOnChange = true;
    const spikeWindow = num("spikeWindow", "WATCHDIFF_SPIKE_WINDOW");
    if (spikeWindow !== undefined)           result.changeSpikeWindow    = spikeWindow;
    const spikeThreshold = num("spikeThreshold", "WATCHDIFF_SPIKE_THRESHOLD");
    if (spikeThreshold !== undefined)        result.changeSpikeThreshold = spikeThreshold;
    if (bool("alertOnStatusChange", "WATCHDIFF_ALERT_ON_STATUS_CHANGE")) result.alertOnStatusChange = true;

    return result;
}

// ---------------------------------------------------------------------------
// Output (verbosity + log format)
// ---------------------------------------------------------------------------

/** Patch console based on --quiet / --verbose / --log-format flags. */
function applyOutput(opts: Record<string, unknown>): void {
    const quiet   = !!opts["quiet"];
    const verbose = !!opts["verbose"];
    const fmt     = (opts["logFormat"] as string | undefined) ?? process.env["WATCHDIFF_LOG_FORMAT"];

    if (fmt === "json") {
        const jsonWriter = (level: string, stderr = false) =>
            (...args: unknown[]) => {
                const line = JSON.stringify({
                    level,
                    timestamp: new Date().toISOString(),
                    message:   args.map(String).join(" "),
                }) + "\n";
                (stderr ? process.stderr : process.stdout).write(line);
            };
        console.log   = jsonWriter("info");
        console.info  = jsonWriter("info");
        console.warn  = jsonWriter("warn");
        console.error = jsonWriter("error", true);
        console.debug = jsonWriter("debug");
    }

    if (quiet) {
        console.log   = () => {};
        console.info  = () => {};
        console.warn  = () => {};
        console.debug = () => {};
    } else if (!verbose) {
        console.debug = () => {};
    }
}

function fmtDate(d: Date): string {
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

program.parse();
