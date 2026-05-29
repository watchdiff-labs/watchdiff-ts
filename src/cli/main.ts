import { program } from "commander";
import chalk from "chalk";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { WatchDiff } from "../index.js";
import { changeHuman, reportSummary } from "../models.js";
import type { WatchOptions } from "../core.js";

program
    .name("watchdiff")
    .description("Lightweight web change monitoring - clean diffs, no AI required.")
    .version("0.1.2");

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

program
    .command("run [url]")
    .description("Start continuous monitoring (Ctrl+C to stop). Pass a URL or --config file.")
    .option("-t, --target <selector>",    "CSS selector or XPath expression to watch")
    .option("-i, --interval <seconds>",   "Seconds between checks", "300")
    .option("-w, --webhook <url>",        "Webhook URL to POST on change")
    .option("-s, --storage <dir>",        "Storage directory", ".watchdiff")
    .option("-c, --config <file>",        "JSON config file (watchdiff.config.json)")
    .option("--browser",                  "Use headless Playwright browser for JS-heavy pages")
    .option("--proxy <url>",              "Proxy URL (e.g. http://user:pass@host:port)")
    .option("--user-agent <ua>",          "Custom User-Agent string")
    .option("--diff-mode <mode>",         "Diff mode: 'line' (default), 'semantic', 'word', or 'json'")
    .option("--cooldown <seconds>",       "Minimum seconds between two alerts for the same URL (anti-spam)")
    .option("--retries <n>",              "Number of fetch retries on error (default 0)")
    .option("--jitter <factor>",          "Interval jitter 0-1, e.g. 0.2 = ±20% variance (default 0)")
    .option("--dry-run",                  "Fetch and diff without saving or alerting")
    .option("--max-snapshots <n>",        "Keep only the last N snapshots per URL")
    .option("--change-threshold <ratio>", "Minimum fraction 0-1 of content that must change to alert")
    .option("--ignore-numbers",           "Ignore standalone number changes (counters, dates)")
    .option("--alert-if-no-change <sec>", "Fire silence alert after N seconds without a change")
    .option("-q, --quiet",                "Suppress all output except errors")
    .option("-v, --verbose",              "Show debug output (no-change ticks, cooldown skips, etc.)")
    .action((url: string | undefined, opts: Record<string, string | boolean | undefined>) => {
        applyVerbosity(opts);
        const storage = (opts["storage"] as string | undefined) ?? ".watchdiff";
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

        const stop = wd.start();

        process.on("SIGINT", () => {
            if (!opts["quiet"]) console.log(chalk.gray("\nStopping..."));
            stop();
            process.exit(0);
        });
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
    .option("-q, --quiet",               "Suppress all output except errors")
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
        applyVerbosity(opts);
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
        url:                  string;
        target?:              string;
        interval?:            number;
        label?:               string;
        browser?:             boolean;
        diffMode?:            string;
        webhooks?:            string[];
        ignoreSelectors?:     string[];
        proxies?:             string[];
        userAgents?:          string[];
        headers?:             Record<string, string>;
        timeout?:             number;
        minChanges?:          number;
        cooldown?:            number;
        retries?:             number;
        retryDelay?:          number;
        jitter?:              number;
        dryRun?:              boolean;
        maxSnapshots?:        number;
        changeThreshold?:     number;
        ignoreNumbers?:       boolean;
        alertIfNoChangeAfter?: number;
    }>;
}

function loadConfig(path: string): ConfigFile {
    if (!existsSync(path)) {
        console.error(chalk.red(`Config file not found: ${path}`));
        process.exit(1);
    }
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as ConfigFile;
    } catch (err) {
        console.error(chalk.red(`Invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }
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
        });
    }
}

function buildWatchOptions(opts: Record<string, string | boolean | undefined>): WatchOptions {
    const result: WatchOptions = {};
    if (opts["target"])            result.target            = opts["target"] as string;
    if (opts["interval"])          result.interval          = parseInt(opts["interval"] as string, 10);
    if (opts["webhook"])           result.webhooks          = [opts["webhook"] as string];
    if (opts["browser"])           result.browser           = true;
    if (opts["proxy"])             result.proxies           = [opts["proxy"] as string];
    if (opts["userAgent"])         result.userAgents        = [opts["userAgent"] as string];
    if (opts["diffMode"])          result.diffMode          = opts["diffMode"] as WatchOptions["diffMode"];
    if (opts["cooldown"])          result.cooldown          = parseInt(opts["cooldown"] as string, 10);
    if (opts["retries"])           result.retries           = parseInt(opts["retries"] as string, 10);
    if (opts["jitter"])            result.jitter            = parseFloat(opts["jitter"] as string);
    if (opts["dryRun"])            result.dryRun            = true;
    if (opts["maxSnapshots"])      result.maxSnapshots      = parseInt(opts["maxSnapshots"] as string, 10);
    if (opts["changeThreshold"])   result.changeThreshold   = parseFloat(opts["changeThreshold"] as string);
    if (opts["ignoreNumbers"])     result.ignoreNumbers     = true;
    if (opts["alertIfNoChange"])   result.alertIfNoChangeAfter = parseInt(opts["alertIfNoChange"] as string, 10);
    return result;
}

/** Patch console to suppress output based on --quiet / --verbose flags. */
function applyVerbosity(opts: Record<string, unknown>): void {
    if (opts["quiet"]) {
        // Suppress info and debug, keep errors
        console.log   = () => {};
        console.info  = () => {};
        console.warn  = () => {};
        console.debug = () => {};
    } else if (!opts["verbose"]) {
        // Default: suppress debug ticks
        console.debug = () => {};
    }
}

function fmtDate(d: Date): string {
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

program.parse();
