# watchdiff-core

[![npm version](https://img.shields.io/npm/v/watchdiff-core?color=blue)](https://www.npmjs.com/package/watchdiff-core)
[![CI](https://github.com/watchdiff-labs/watchdiff-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/watchdiff-labs/watchdiff-ts/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)

**Lightweight web change monitoring - diffs, AI summaries, file/API/SSL/DB monitoring, structured alerts.**

WatchDiff watches web pages, files, APIs, databases, and SSL certificates - then tells you exactly what changed, in plain language or via an AI-generated summary.

- **Deterministic** - same input always produces the same output
- **Human-readable diffs** - "Price changed: $19 -> $24", not a wall of HTML
- **AI summaries** - optional Claude / OpenAI / Gemini natural language summary of every diff
- **CSS selectors AND XPath** - target any zone of any page
- **JS-heavy pages** - optional Playwright headless browser rendering
- **Proxy and User-Agent rotation** - avoid rate-limiting
- **5 diff modes** - line, word, semantic, JSON, RSS/Atom
- **RSS / Atom monitoring** - item-level diff by guid/id
- **File monitoring** - watch local files for changes with the same diff pipeline
- **API monitoring** - watch REST/JSON endpoints with response-time tracking and expected-status alerting
- **SSL certificate monitoring** - alert when a cert is about to expire or is replaced
- **Condition-based alerts** - `alertIf` custom function to suppress noise
- **Cron scheduling** - fire checks at exact times with standard 5-field cron expressions
- **Flapping detection** - re-verify before alerting to suppress transient changes
- **Sitemap monitoring** - watch a `sitemap.xml` for added or removed URLs
- **JSON path targeting** - diff only a specific field inside a JSON API response
- **Cookie-based authentication** - pass session cookies to monitor login-protected pages
- **Email alerts** - send SMTP email notifications on change (requires nodemailer)
- **Stable watcher ID** - assign a stable `id` key per watcher; targeted `pause(id)` / `resume(id)` even when multiple watchers share the same URL
- **Concurrency limiting** - cap simultaneous in-flight checks with `new WatchDiff({ concurrency: 5 })` to avoid overwhelming targets
- **Maintenance windows** - automatically skip checks during scheduled downtime — no code changes needed at runtime
- **Active hours** - restrict monitoring to specific hours/days of the week, with full IANA timezone support
- **Failure policy** - require N consecutive failures before alerting, and N consecutive successes before re-enabling alerts after recovery
- **Config validation** - `watchdiff validate` checks a config file for errors (invalid URLs, unknown modes, bad cron expressions) before deploying
- **HTML archiving** - save full page HTML to disk on every change
- **Screenshot on change** - capture a PNG via Playwright on every detected change
- **HTTP status monitoring** - alert when a URL returns a different status code (200 → 503, 503 → 200)
- **Database monitoring** - watch SQLite, PostgreSQL, or MySQL tables for row inserts, deletes, updates, and schema changes
- **Change spike detection** - alert when a page changes too frequently in a time window
- **URL comparison** - diff two arbitrary URLs in a single command
- **Built-in status server** - HTTP endpoints `/health`, `/status`, `/metrics` (Prometheus)
- **SQLite backend** - optional, for high-volume workloads
- **CSV / XLSX export** - full history export in one command
- **Zero external services** - snapshots stored locally as JSON or SQLite
- **Alert cooldown** - minimum delay between two alerts per URL to prevent notification spam
- **Retry with backoff** - automatic retry on fetch errors with exponential backoff
- **5 webhook channels** - Discord, Slack, Telegram, Microsoft Teams, ntfy.sh
- **Pause / Resume** - dynamically suspend and restart individual watchers
- **Silence detection** - alert when a page stops changing
- **Dry-run mode** - fetch and diff without saving or alerting
- **Snapshot pruning** - keep only the last N snapshots per URL
- **Change threshold** - require a minimum fraction of content to change before alerting
- **ignoreNumbers** - strip standalone numbers to ignore counter/date noise
- **`onRecovery` callback** - fired when a watcher recovers after a consecutive-failure streak
- **`maxRetryDelay`** - cap the maximum exponential backoff delay
- **`alertOnFirstCheck`** - optionally fire `onChange` on the very first snapshot capture
- **`webhookHeaders`** - add custom headers to every outgoing webhook POST
- **Slack Block Kit** - enriched Slack webhook payloads with header, section, and context blocks
- **`retentionDays`** - automatically prune snapshots older than N days
- **JSON export** - export reports and snapshots as JSON (`--format json` or `exportReportsJson()`)
- **`watchdiff snapshot`** - CLI command to print the latest stored snapshot for a URL
- **`watchdiff clean`** - CLI command to delete orphan snapshot files
- **`watchdiff pause` / `watchdiff resume`** - pause and resume watchers from the CLI
- **HTTP Basic Auth** - `auth: { user, pass }` for password-protected endpoints — automatically adds an `Authorization: Basic` header
- **`onBeforeCheck` hook** - async callback fired before every fetch tick, useful to refresh tokens or log activity
- **POST request support** - `requestBody` switches the fetcher to POST for APIs that require a request body
- **Watcher tags** - `tags: ["prod", "prices"]` then `wd.pause("prod")` to pause or resume an entire group
- **`watchdiff list`** - CLI command listing all configured watchers with their label, URL, target, interval, tags, and paused state
- **`minInterval`** - global (`new WatchDiff({ minInterval: 30 })`) or per-watcher floor on the minimum seconds between checks
- **SSRF protection** - all URLs validated against loopback, link-local, and private IP ranges before any request; disable with `allowPrivateUrls: true` for internal monitoring
- **Response size cap** - `maxResponseSize` (default 10 MB) prevents unbounded memory usage from oversized responses
- **Redirect safety** - automatic redirect following capped at 10 hops with SSRF validation at each hop
- **SQL injection guard** - custom DB queries validated as SELECT-only before execution
- **Cookie value encoding** - cookie values are `encodeURIComponent`-encoded to prevent header injection
- **`maxWatchers`** - optional limit on the number of registered watchers (`new WatchDiff({ maxWatchers: 1000 })`)
- **Status server localhost-only by default** - `startStatusServer(port)` binds to `127.0.0.1`; pass a second arg to override
- **Fully typed** - complete TypeScript types included
- **Native fetch** - no HTTP library dependency, runs on Node.js 18+


## At a glance

| What you want | How |
|---|---|
| Monitor a URL for changes | `.watch(url, { interval, target })` + `.start()` |
| Target a specific element | `target: ".price"` (CSS) or `target: "//span[@class='p']"` (XPath) |
| Get notified on change | `onChange: (report) => ...` or `webhooks: ["https://discord.com/..."]` |
| Render JS-heavy pages | `browser: true` (requires playwright) |
| Avoid notification spam | `cooldown: 3600` (min seconds between alerts) |
| Retry on fetch errors | `retries: 3, retryDelay: 1000` (exponential backoff) |
| Randomise polling interval | `jitter: 0.2` (±20% variance) |
| Word-level diff | `diffMode: "word"` |
| Diff a JSON API endpoint | `diffMode: "json"` |
| Rotate proxies / UAs | `proxies: [...]`, `userAgents: [...]` |
| Diff at paragraph level | `diffMode: "semantic"` |
| Persist to SQLite | `new WatchDiff(undefined, new SqliteStore(".db"))` |
| Export history | `.exportReportsCsv(url)` / `.exportReportsXlsx(url)` |
| Pause a watcher | `wd.pause(url)` / `wd.resume(url)` |
| Check watcher state | `wd.status()` |
| Alert on page silence | `alertIfNoChangeAfter: 86400` |
| Dry-run (no save/alert) | `dryRun: true` |
| Limit snapshot storage | `maxSnapshots: 100` |
| Ignore counters / dates | `ignoreNumbers: true` |
| Require significant change | `changeThreshold: 0.05` (5% of content) |
| Handle errors gracefully | `onError: (err) => myLogger.error(err)` |
| Monitor an RSS/Atom feed | `diffMode: "rss"` |
| Archive HTML on change | `archiveHtml: true` |
| Screenshot on change | `screenshotOnChange: true` (requires `browser: true`) |
| Detect change spikes | `changeSpikeWindow: 300, changeSpikeThreshold: 5` |
| Monitor HTTP status | `alertOnStatusChange: true` + `onStatusChange: (info) => ...` |
| Monitor a DB table | `.watchDb("sqlite://./app.db", "products", { diffMode: "row" })` |
| Monitor DB schema | `.watchDb(connStr, "users", { diffMode: "schema" })` |
| Monitor a DB aggregate | `.watchDb(connStr, "orders", { diffMode: "aggregate", query: "SELECT COUNT(*) FROM orders", threshold: 10 })` |
| Monitor a local file | `.watchFile("/etc/nginx/nginx.conf", { interval: 60 })` |
| Monitor a REST API | `.watchApi("https://api.example.com/prices", { expectedStatus: 200 })` |
| Track API response time | `trackResponseTime: true` → `report.responseTimeMs` |
| Alert only on condition | `alertIf: (report) => report.changes.some(c => c.context === "price")` |
| Monitor SSL certificate | `.watchCert("example.com", { warnDaysBeforeExpiry: 14 })` |
| AI summary of changes | `aiSummary: true, aiProvider: { type: "gemini", apiKey: "..." }` |
| Customize the AI prompt | `aiPrompt: "Summarize this diff in French."` or `aiPrompt: (report) => ...` |
| Fire checks on a schedule | `schedule: "0 9 * * *"` (cron expression) |
| Confirm change before alerting | `confirmAfter: 30` (flapping detection) |
| Monitor a sitemap for URL changes | `.watchSitemap("https://example.com/sitemap.xml")` |
| Watch one JSON field only | `jsonPath: "$.data.price"` |
| Monitor authenticated pages | `cookies: { session: "abc123", csrftoken: "xyz" }` |
| Send email on change | `alert: { email: { to: "...", smtp: { host, port, user, pass } } }` (requires nodemailer) |
| Give a watcher a stable ID | `id: "my-watcher"` then `wd.pause("my-watcher")` / `wd.resume("my-watcher")` |
| Limit concurrent checks | `new WatchDiff({ concurrency: 5 })` |
| Skip checks during scheduled downtime | `maintenanceWindows: [{ from: "2026-09-01T02:00:00Z", to: "2026-09-01T04:00:00Z" }]` |
| Restrict monitoring to business hours | `activeBetween: { from: "09:00", to: "18:00", days: ["monday","friday"] }` |
| Require 3 failures before alerting | `failurePolicy: { consecutiveFailures: 3 }` |
| Validate config before deploying | `watchdiff validate` or `watchdiff validate --config my.json` |
| Diff two URLs | `wd.compareUrls(urlA, urlB)` or `watchdiff compare <urlA> <urlB>` |
| Expose status over HTTP | `wd.startStatusServer(9090)` or `--status-port 9090` |
| CLI one-liner | `watchdiff run https://example.com --target .price --interval 60` |
| Multi-URL config file | `watchdiff init` then edit `watchdiff.config.json` |
| Show watcher status | `watchdiff status` |
| Show last diff | `watchdiff diff https://example.com` |
| React when a watcher recovers | `onRecovery: (config) => console.log("Recovered:", config.label)` |
| Cap backoff delay | `maxRetryDelay: 30000` (max 30s between retries) |
| Alert on very first check | `alertOnFirstCheck: true` |
| Add auth headers to webhooks | `webhookHeaders: { Authorization: "Bearer token" }` |
| Auto-prune old snapshots | `retentionDays: 30` |
| Export as JSON | `wd.exportReportsJson(url)` / `watchdiff export url --format json` |
| View latest snapshot | `watchdiff snapshot https://example.com` |
| Remove orphan files | `watchdiff clean --config watchdiff.config.json` |
| HTTP Basic Auth | `auth: { user: "alice", pass: "secret" }` |
| Async pre-fetch hook | `onBeforeCheck: async (config) => { /* refresh token */ }` |
| POST to an API | `requestBody: { query: "SELECT 1" }` or `requestBody: "raw body"` |
| Group watchers by tag | `tags: ["prod"]` then `wd.pause("prod")` |
| List configured watchers | `watchdiff list` or `watchdiff list --config my.json` |
| Floor check frequency | `minInterval: 30` (per-watcher) or `new WatchDiff({ minInterval: 30 })` (global) |
| Cap watcher count | `new WatchDiff({ maxWatchers: 100 })` |
| Allow internal URLs | `allowPrivateUrls: true` (disables SSRF guard for private-network monitoring) |
| Cap response body size | `maxResponseSize: 5242880` (5 MB default: 10 MB) |
| Bind status server to custom host | `wd.startStatusServer(9090, "0.0.0.0")` |

### Quick navigation

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [API reference](#api)
- [Feature details](#feature-details)
  - [JS-heavy pages (Playwright)](#js-heavy-pages-playwright)
  - [Proxy rotation](#proxy-rotation)
  - [User-Agent rotation](#user-agent-rotation)
  - [XPath selectors](#xpath-selectors)
  - [Diff modes](#diff-modes)
  - [Alert cooldown](#alert-cooldown)
  - [Retry with exponential backoff](#retry-with-exponential-backoff)
  - [Interval jitter](#interval-jitter)
  - [Pause and resume](#pause-and-resume)
  - [Watcher status](#watcher-status)
  - [Silence detection](#silence-detection)
  - [Dry-run mode](#dry-run-mode)
  - [Snapshot pruning](#snapshot-pruning)
  - [Change threshold](#change-threshold)
  - [Ignore numbers](#ignore-numbers)
  - [Error callback](#error-callback)
  - [Webhook channels](#webhook-channels)
  - [HTML archiving](#html-archiving)
  - [Screenshot on change](#screenshot-on-change)
  - [Change spike detection](#change-spike-detection)
  - [HTTP status monitoring](#http-status-monitoring)
  - [Database monitoring](#database-monitoring)
  - [RSS / Atom monitoring](#rss--atom-monitoring)
  - [AI summaries](#ai-summaries)
  - [File monitoring](#file-monitoring)
  - [API monitoring](#api-monitoring)
  - [SSL certificate monitoring](#ssl-certificate-monitoring)
  - [Condition-based alerts](#condition-based-alerts---alertif)
  - [Cron scheduling](#cron-scheduling)
  - [Flapping detection](#flapping-detection)
  - [Sitemap monitoring](#sitemap-monitoring)
  - [JSON path targeting](#json-path-targeting)
  - [Cookie-based authentication](#cookie-based-authentication)
  - [Email alerts](#email-alerts)
  - [onRecovery callback](#onrecovery-callback)
  - [maxRetryDelay](#maxretrydelay)
  - [alertOnFirstCheck](#alertonfirstcheck)
  - [webhookHeaders](#webhookheaders)
  - [Slack Block Kit](#slack-block-kit)
  - [retentionDays](#retentiondays)
  - [JSON export](#json-export)
  - [Stable watcher ID](#stable-watcher-id)
  - [Concurrency limiting](#concurrency-limiting)
  - [Maintenance windows](#maintenance-windows)
  - [Active hours](#active-hours)
  - [Failure policy](#failure-policy)
  - [URL comparison](#url-comparison)
  - [Status server](#status-server)
  - [SQLite storage backend](#sqlite-storage-backend)
  - [CSV and XLSX export](#csv-and-xlsx-export)
  - [Config file](#watchdiff-init---config-file)
  - [Environment variables](#environment-variables)
  - [Validate config](#validate-config)
  - [HTTP Basic Auth](#http-basic-auth)
  - [onBeforeCheck hook](#onbeforecheck-hook)
  - [POST request support](#post-request-support)
  - [Watcher tags](#watcher-tags)
  - [minInterval](#mininterval)
- [Types](#types)
- [Helper functions](#helper-functions)
- [CLI reference](#cli)
- [Advanced usage](#advanced-usage)
- [Optional dependencies](#optional-dependencies)


## Also available for Python

A Python port of this library is available on PyPI: [watchdiff-core](https://pypi.org/project/watchdiff-core/)

```bash
pip install watchdiff-core
```

Same pipeline, same concepts, same diff output - native Python implementation.


## Install

```bash
npm install watchdiff-core
```


## Quick start

### Web page monitoring

```typescript
import { WatchDiff } from "watchdiff-core";

const wd = new WatchDiff();

wd.watch("https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html", {
  target: ".price_color",
  interval: 60,
  label: "Book price",
  onChange: (report) => console.log(report.changes),
});

const stop = wd.start();

process.on("SIGINT", () => { stop(); process.exit(0); });
```

### Database monitoring

```typescript
import { WatchDiff } from "watchdiff-core";

const wd = new WatchDiff();

// Watch a SQLite table for row-level changes (requires: npm install better-sqlite3)
wd.watchDb("sqlite://./app.db", "products", {
  primaryKey: ["id"],
  ignoreColumns: ["updated_at"],
  interval: 30,
  onChange: (report) => {
    for (const c of report.changes) {
      if (c.kind === "inserted") console.log("New product:", c.row);
      if (c.kind === "deleted")  console.log("Deleted:", c.row);
      if (c.kind === "updated")  console.log("Updated key", c.rowKey, c.modifications);
    }
  },
});

// Also monitor a PostgreSQL table (requires: npm install pg)
wd.watchDb("postgresql://user:pass@localhost/mydb", "users", {
  diffMode: "schema",
  onSchemaChange: (info) => console.log("Schema changed:", info.changes),
});

const stop = wd.start();

process.on("SIGINT", () => { stop(); process.exit(0); });
```


## How it works

### Web pipeline

Every web check runs through a fixed pipeline:

```
Fetcher / BrowserFetcher -> Cleaner -> Parser -> DiffEngine -> Store -> Notifier
```

1. **Fetcher** - downloads the page via native `fetch` (Node 18+), with proxy and UA rotation, and optional retry
2. **BrowserFetcher** - optional Playwright path for JS-rendered pages
3. **Cleaner** - strips scripts, styles, ads, and tracking noise (cheerio)
4. **Parser** - extracts the target CSS selector or XPath expression (or full body)
5. **DiffEngine** - compares content in line, word, semantic, or JSON mode
6. **Store** - persists snapshots and reports as JSON files or SQLite
7. **Notifier** - fires callbacks and webhooks on detected changes

### Database pipeline

Every database check runs through a parallel pipeline:

```
DbFetcher (SQLite / PostgreSQL / MySQL) -> DbDiffEngine -> Store -> callbacks / webhooks
```

1. **DbFetcher** - executes `SELECT * FROM <table>` (or a custom query) via the appropriate driver adapter
2. **DbDiffEngine** - compares snapshots in one of four modes: `row`, `schema`, `aggregate`, or `value`
3. **Store** - serialises the row snapshot to JSON and saves it via the existing `IStore` interface
4. **Dispatch** - fires `onChange`, `onSchemaChange`, `onThreshold` callbacks and webhooks on detected changes


## API

### `new WatchDiff(opts?)`

```typescript
// Default JSON storage
const wd = new WatchDiff();

// Options object (recommended)
const wd = new WatchDiff({ storageDir: ".watchdiff", concurrency: 10 });

// With SQLite backend (optional - requires better-sqlite3)
import { SqliteStore } from "watchdiff-core";
const wd = new WatchDiff({ store: new SqliteStore(".watchdiff.db") });

// Backward-compatible string form (still supported)
const wd = new WatchDiff(".watchdiff");
const wd = new WatchDiff(undefined, new SqliteStore(".watchdiff.db"));
```

| Option | Type | Default | Description |
|---|---|---|---|
| `storageDir` | `string` | `".watchdiff"` | Directory for JSON snapshot storage |
| `store` | `IStore` | - | Custom store (e.g. `SqliteStore`). Overrides `storageDir` |
| `concurrency` | `number` | unlimited | Max simultaneous in-flight checks. See [Concurrency limiting](#concurrency-limiting) |
| `minInterval` | `number` | `0` | Global floor on minimum seconds between checks. Applied to all watchers that do not set their own `minInterval` |


### `.watch(url, options?)` - chainable

Register a URL to monitor.

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `string` | - | CSS selector (`.price`) or XPath (`//div[@class="price"]`). Omit for full page. |
| `interval` | `number` | `300` | Seconds between checks |
| `label` | `string` | URL | Human-readable name in logs and reports |
| `headers` | `Record<string, string>` | `{}` | Extra HTTP headers |
| `timeout` | `number` | `15000` | HTTP timeout in milliseconds |
| `ignoreSelectors` | `string[]` | `[]` | CSS selectors to strip before diffing |
| `ignorePatterns` | `RegExp[]` | `[]` | Regex patterns to strip from text |
| `browser` | `boolean` | `false` | Use headless Playwright browser (JS-heavy pages) |
| `browserOptions` | `BrowserOptions` | - | Options for the headless browser |
| `proxies` | `string[]` | `[]` | Proxy URLs to rotate through |
| `userAgents` | `string[]` | `[]` | User-Agent strings to rotate through |
| `diffMode` | `"line" \| "semantic" \| "word" \| "json" \| "rss"` | `"line"` | Diff granularity |
| `onChange` | `fn \| fn[]` | - | Callback(s) receiving a `DiffReport` on each change |
| `webhooks` | `string[]` | `[]` | Discord / Slack / Telegram / Teams / ntfy.sh / custom POST |
| `minChanges` | `number` | `1` | Minimum changes required to trigger an alert |
| `cooldown` | `number` | `0` | Minimum seconds between two consecutive alerts (anti-spam) |
| `retries` | `number` | `0` | Fetch retry count on error (exponential backoff) |
| `retryDelay` | `number` | `1000` | Base delay in ms before first retry (doubles each attempt) |
| `jitter` | `number` | `0` | Interval randomisation factor 0-1. `0.2` = ±20% variance |
| `dryRun` | `boolean` | `false` | Fetch and diff without saving or alerting |
| `maxSnapshots` | `number` | - | Keep only the last N snapshots per URL |
| `changeThreshold` | `number` | `0` | Minimum fraction 0-1 of content that must change before alerting |
| `ignoreNumbers` | `boolean` | `false` | Strip standalone numbers before diffing |
| `alertIfNoChangeAfter` | `number` | - | Fire `onSilence` after this many seconds without a detected change |
| `onError` | `fn` | - | Called on fetch/parse errors instead of logging to console |
| `onSilence` | `fn` | - | Called when `alertIfNoChangeAfter` seconds elapse without a change |
| `webhookRetries` | `number` | `3` | Retry attempts for failed webhook deliveries (exponential backoff, `0` = no retry) |
| `archiveHtml` | `boolean` | `false` | Save full-page HTML to `.watchdiff/archive/` on every detected change |
| `screenshotOnChange` | `boolean` | `false` | Capture a PNG screenshot on change (requires `browser: true`) |
| `changeSpikeWindow` | `number` | - | Spike detection time window in seconds |
| `changeSpikeThreshold` | `number` | - | Alert when this many changes occur inside `changeSpikeWindow` |
| `onSpike` | `fn` | - | Called when a change spike is detected |
| `expectedStatus` | `number` | - | Fire `onError` when the HTTP status code differs from this expected value |
| `trackResponseTime` | `boolean` | `false` | Record HTTP response time on every check — available as `report.responseTimeMs` |
| `alertOnStatusChange` | `boolean` | `false` | Alert when the HTTP status code changes (e.g. `200 → 503` or `503 → 200`) |
| `onStatusChange` | `fn` | - | Called when the HTTP status code changes |
| `alert` | `AlertConfig` | - | Full alert config object: `{ onChange, webhooks, minChanges, webhookRetries, email }` |
| `alertIf` | `fn` | - | Custom condition - alert only when this function returns `true` |
| `aiSummary` | `boolean` | `false` | Generate an AI natural-language summary of detected changes |
| `aiProvider` | `AiProvider` | - | AI provider config. Auto-detected from env vars when omitted. |
| `aiPrompt` | `string \| fn` | - | Override the default AI prompt. String or function receiving `DiffReport`. |
| `schedule` | `string` | - | 5-field cron expression. Overrides `interval` when set. |
| `confirmAfter` | `number` | - | Re-verify after N seconds before alerting (flapping detection) |
| `jsonPath` | `string` | - | JSON path expression to extract a sub-value before diffing (e.g. `"$.data.price"`) |
| `cookies` | `Record<string, string>` | - | Cookies sent with every request — merged into the `Cookie` header (e.g. `{ session: "abc" }`) |
| `id` | `string` | - | Stable identity key for this watcher. Used for `pause(id)` / `resume(id)` and storage keys instead of URL |
| `maintenanceWindows` | `MaintenanceWindow[]` | - | Time windows during which checks are skipped entirely |
| `activeBetween` | `ActiveBetween` | - | Restrict monitoring to specific hours and/or days of the week |
| `failurePolicy` | `FailurePolicy` | - | Control how many consecutive failures/recoveries are needed before alerting |
| `onRecovery` | `fn` | - | Called when a watcher recovers after a consecutive-failure streak |
| `maxRetryDelay` | `number` | `Infinity` | Cap on exponential backoff delay in ms between fetch retries |
| `alertOnFirstCheck` | `boolean` | `false` | Fire `onChange` on the very first snapshot capture |
| `webhookHeaders` | `Record<string, string>` | - | Extra headers merged into every outgoing webhook POST |
| `retentionDays` | `number` | - | Auto-delete snapshots older than N days after each save |
| `auth` | `{ user: string; pass: string }` | - | HTTP Basic Auth credentials — adds an `Authorization: Basic` header |
| `onBeforeCheck` | `fn` | - | Async callback fired before every fetch tick. A thrown error logs a warning but does not skip the check |
| `requestBody` | `string \| Record<string, unknown>` | - | When set, switches the request method to POST. Objects are JSON-serialised; strings are sent as-is |
| `tags` | `string[]` | - | Arbitrary tags for grouping watchers. Pass a tag to `wd.pause()` / `wd.resume()` to operate on all matching watchers at once |
| `minInterval` | `number` | - | Per-watcher floor on minimum seconds between checks. Overrides the global `WatchDiffOptions.minInterval` |

```typescript
wd
  .watch("https://example.com/product", {
    target: ".price",
    interval: 30,
    onChange: (report) => console.log(report.changes),
    webhooks: ["https://discord.com/api/webhooks/YOUR_WEBHOOK"],
    retries: 3,
    cooldown: 3600,
  })
  .watch("https://news.ycombinator.com", { interval: 300, label: "HN" });
```


### `.onChange(callback)` - chainable

Global callback fired for every URL that changes.

```typescript
wd.onChange((report) => {
  console.log(reportSummary(report));
  for (const change of report.changes) {
    console.log(changeHuman(change));
  }
});
```


### `.start()` - returns `stop()`

Start the monitoring loop. Returns a `stop()` function.

```typescript
const stop = wd.start();

setTimeout(stop, 3_600_000);

process.on("SIGINT", () => { stop(); process.exit(0); });
```


### `await .checkOnce(url)`

Single immediate check without starting the scheduler.

```typescript
wd.watch("https://example.com", { target: ".price" });
const report = await wd.checkOnce("https://example.com");
if (report) console.log(reportSummary(report));
```


### `.pause(urlOrId)` / `.resume(urlOrId)`

Suspend or resume a watcher at runtime without stopping the scheduler.
Pass the watcher's `id` (if set) or its URL.

```typescript
const stop = wd.start();

// Pause by URL
wd.pause("https://example.com");

// Pause by stable ID (when id is set in .watch())
wd.pause("my-watcher");

// Resume later
setTimeout(() => wd.resume("my-watcher"), 30_000);
```


### `.status()`

Return runtime status for all registered watchers.

```typescript
const statuses = wd.status();
for (const s of statuses) {
  console.log(s.url, s.paused, s.checksCount, s.lastChangeAt);
}
```

Returns an array of `WatcherStatus`:

```typescript
interface WatcherStatus {
  url:           string;
  id?:           string;        // set when id was configured
  label:         string;
  target:        string | undefined;
  interval:      number;
  paused:        boolean;
  inMaintenance: boolean;       // true when inside a maintenanceWindow
  lastCheckAt:   Date | null;
  nextCheckAt:   Date | null;
  lastChangeAt:  Date | null;
  checksCount:   number;
  changesCount:  number;
  errorsCount:   number;
}
```


### `.history(url, limit?)` / `.reports(url, limit?)`

```typescript
const snapshots = wd.history("https://example.com", 10);
const reports   = wd.reports("https://example.com", 20);
```

### `.clear(url)`

Delete all stored snapshots and reports for a URL.


### `await .compareUrls(urlA, urlB, opts?)`

Fetch and diff two arbitrary URLs in a single call. No storage is written.

```typescript
const report = await wd.compareUrls(
  "https://example.com/v1",
  "https://example.com/v2",
  { target: ".content", diffMode: "word" }
);
console.log(report.changes.length, "difference(s)");
```


### `.watchDb(connectionString, table, options?)` - chainable

Register a database table to monitor. Returns `this` for chaining.

**Supported connection strings:**

```
sqlite://./path/to/db.sqlite
postgresql://user:pass@host:5432/dbname
mysql://user:pass@host:3306/dbname
```

| Option | Type | Default | Description |
|---|---|---|---|
| `diffMode` | `"row" \| "schema" \| "aggregate" \| "value"` | `"row"` | Diff strategy |
| `primaryKey` | `string[]` | first column | Column(s) that identify a row across snapshots |
| `ignoreColumns` | `string[]` | `[]` | Columns to exclude from comparison |
| `query` | `string` | `SELECT * FROM <table>` | Custom SELECT query |
| `interval` | `number` | `300` | Seconds between checks |
| `label` | `string` | auto | Human-readable name in logs |
| `alertOnInsert` | `boolean` | `true` | Alert when rows are inserted |
| `alertOnDelete` | `boolean` | `true` | Alert when rows are deleted |
| `alertOnUpdate` | `boolean` | `true` | Alert when rows are updated |
| `threshold` | `number` | `0` | For `aggregate` mode: alert when value changes by ≥ this % |
| `onChange` | `fn` | - | Callback receiving a `DbDiffReport` on each change |
| `onSchemaChange` | `fn` | - | Called specifically when column definitions change |
| `onThreshold` | `fn` | - | Called when an aggregate threshold is exceeded |
| `onError` | `fn` | - | Called on connection / query errors |
| `webhooks` | `string[]` | `[]` | Webhook URLs (same channels as web monitoring) |
| `webhookRetries` | `number` | `3` | Retry attempts for failed webhook deliveries |
| `cooldown` | `number` | `0` | Minimum seconds between two consecutive alerts |
| `dryRun` | `boolean` | `false` | Fetch and diff without saving or alerting |
| `maxSnapshots` | `number` | - | Keep only the last N snapshots |

```typescript
import { WatchDiff } from "watchdiff-core";

const wd = new WatchDiff();

// Row-level diff - detect inserts, deletes, and column-level updates
wd.watchDb("sqlite://./app.db", "products", {
  primaryKey: ["id"],
  ignoreColumns: ["updated_at"],
  interval: 60,
  onChange: (report) => {
    for (const c of report.changes) {
      if (c.kind === "inserted") console.log("New row:", c.row);
      if (c.kind === "deleted")  console.log("Deleted row:", c.row);
      if (c.kind === "updated")  console.log("Updated row key:", c.rowKey, c.modifications);
    }
  },
});

// Schema diff - alert when columns are added, removed, or have their type changed
wd.watchDb("postgresql://user:pass@localhost/mydb", "users", {
  diffMode: "schema",
  onSchemaChange: (info) => console.log("Schema changed:", info.changes),
});

// Aggregate / threshold - alert when a scalar query result changes by ≥ 10%
wd.watchDb("mysql://user:pass@localhost/shop", "orders", {
  diffMode: "aggregate",
  query: "SELECT COUNT(*) FROM orders WHERE status = 'pending'",
  threshold: 10,
  onThreshold: (info) => {
    console.log(`Pending orders changed by ${info.changePercent.toFixed(1)}%`);
  },
});

// Value diff - alert whenever a single value changes at all
wd.watchDb("postgresql://user:pass@localhost/app", "config", {
  diffMode: "value",
  query: "SELECT value FROM config WHERE key = 'maintenance_mode'",
  onChange: (report) => {
    const change = report.changes[0]!;
    console.log(`Maintenance mode: ${change.before} → ${change.after}`);
  },
});

wd.start();
```


### `.startStatusServer(port?)` / `.stopStatusServer()`

Start a lightweight HTTP server that exposes watcher state. Default port: `9090`.

```typescript
const wd = new WatchDiff();
wd.watch("https://example.com", { interval: 60 });
wd.startStatusServer(9090);
const stop = wd.start();

// Endpoints:
// GET /health  → { "status": "ok" }
// GET /status  → JSON array of WatcherStatus
// GET /metrics → Prometheus text format
```


### Export API

```typescript
// CSV (no extra dependency)
const csv = wd.exportReportsCsv("https://example.com", 100);
fs.writeFileSync("reports.csv", csv);

const snapCsv = wd.exportSnapshotsCsv("https://example.com", 50);

// XLSX (requires: npm install exceljs)
const buf = await wd.exportReportsXlsx("https://example.com", 100);
fs.writeFileSync("reports.xlsx", buf);

const snapBuf = await wd.exportSnapshotsXlsx("https://example.com");

// JSON (no extra dependency)
const json = wd.exportReportsJson("https://example.com", 100);
fs.writeFileSync("reports.json", json);

const snapJson = wd.exportSnapshotsJson("https://example.com", 50);
```


## Feature details

### JS-heavy pages (Playwright)

For pages that load content via JavaScript (SPAs, lazy loaders, infinite scroll), enable
the headless browser backend. WatchDiff will launch a Chromium instance, wait for the page
to fully render, and then proceed through the normal pipeline.

```bash
# Install playwright (one-time setup)
npm install playwright
npx playwright install chromium
```

```typescript
wd.watch("https://spa-example.com", {
  browser: true,
  browserOptions: {
    waitFor: "networkidle",      // wait until network is quiet
    waitForSelector: ".content", // also wait for this CSS selector
  },
  interval: 120,
});
```


### Proxy rotation

Pass a list of proxy URLs in `proxies`. WatchDiff picks one at random on each request,
distributing load across the pool to avoid IP-based rate-limiting.

```typescript
wd.watch("https://example.com", {
  proxies: [
    "http://user:pass@proxy1.example.com:8080",
    "http://user:pass@proxy2.example.com:8080",
    "socks5://proxy3.example.com:1080",
  ],
  interval: 60,
});
```


### User-Agent rotation

Pass a list of `userAgents` to randomise the browser fingerprint on each request:

```typescript
wd.watch("https://example.com", {
  userAgents: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
  ],
  interval: 30,
});
```


### XPath selectors

`target` accepts both CSS selectors and XPath expressions. XPath is detected automatically
when the value starts with `/` or `./`.

```typescript
// CSS selector (default)
wd.watch("https://example.com", { target: ".product-price" });

// XPath expression
wd.watch("https://example.com", {
  target: "//span[@class='product-price']",
});

// More complex XPath
wd.watch("https://example.com", {
  target: "//table[@id='results']//tr[position()>1]/td[2]",
  label:  "Table column 2",
});
```


### Diff modes

WatchDiff supports five diff modes selectable via `diffMode`:

| Mode | Best for | Granularity |
|---|---|---|
| `"line"` (default) | General text content | Line by line |
| `"semantic"` | Blog posts, news articles, structured pages | Paragraph / heading / cell |
| `"word"` | Short values, prices, status text | Word by word |
| `"json"` | REST APIs, JSON feeds | Nested key path |
| `"rss"` | RSS 2.0 and Atom feeds | Item by item (guid / id) |

**`line` mode (default)**

Myers line-by-line diff. Each change = one line of text.

**`word` mode**

Word-level diff, useful for tracking individual value changes in dense text. Changes are
smaller and more precise than line mode.

```typescript
wd.watch("https://example.com/status", {
  target:   ".status-text",
  diffMode: "word",
});
// change: [~] Changed: "operational" → "degraded"
```

**`semantic` mode**

Extracts semantic content blocks (`<p>`, `<h1-h6>`, `<li>`, `<td>`, `<th>`, `<blockquote>`)
and diffs those blocks. Each change = one paragraph or heading - no fragmented line splits.

```typescript
wd.watch("https://blog.example.com/post/123", {
  diffMode: "semantic",
  label:    "Blog post",
});
```

**`json` mode**

Designed for JSON API endpoints. Recursively walks the JSON structure and reports changes by
key path, making it easy to track which specific field changed.

```typescript
wd.watch("https://api.example.com/product/42", {
  diffMode: "json",
  headers:  { Accept: "application/json" },
  label:    "Product API",
  onChange: (report) => {
    for (const c of report.changes) {
      // c.context = "price", "stock.available", etc.
      console.log(changeHuman(c));
    }
  },
});
// [~] Changed (price): "19.99" → "24.99"
// [~] Changed (stock.available): "true" → "false"
```

Falls back to line diff automatically when the content cannot be parsed as JSON.

**`rss` mode**

Designed for RSS 2.0 and Atom feeds. Parses the XML, identifies items by `guid` (RSS) or `id`
(Atom), and reports each item as added, removed, or modified - instead of a raw XML diff.

```typescript
wd.watch("https://news.example.com/feed.xml", {
  diffMode: "rss",
  label:    "News feed",
  onChange: (report) => {
    for (const c of report.changes) {
      // c.kind = "added" | "removed" | "modified"
      // c.after / c.before = item title
      // c.context = item link or guid
      console.log(changeHuman(c));
    }
  },
});
// [+] Added: "New article title"
// [-] Removed: "Old article title"
```

Falls back to line diff automatically when no `<item>` or `<entry>` elements are found.


### Alert cooldown

Set a minimum delay between two consecutive alerts for the same URL. Useful to avoid
notification storms when a page changes on every check (e.g. live counters, timestamps).

```typescript
wd.watch("https://example.com/live-stats", {
  target:   ".visitor-count",
  interval: 30,
  cooldown: 3600,  // at most one alert per hour
  onChange: (report) => sendNotification(report),
});
```

When a change is detected but the cooldown has not elapsed, the change is still stored
in the snapshot history - only the alert (callbacks + webhooks) is suppressed.

```bash
watchdiff run https://example.com --target .price --cooldown 600
```


### Retry with exponential backoff

Configure automatic retries on fetch errors (network failures, 5xx, timeouts).
WatchDiff waits `retryDelay * 2^(attempt-1)` ms between attempts.

```typescript
wd.watch("https://example.com", {
  retries:    3,      // up to 3 extra attempts (4 total)
  retryDelay: 2000,   // 2s → 4s → 8s between attempts
});
```

- `retries: 0` (default) - no retry, fail immediately
- 4xx errors (except 429) are not retried - only network errors, timeouts, 5xx, and 429
- The `onError` callback is invoked after all retries are exhausted


### Interval jitter

Add randomness to the polling interval to avoid predictable bot patterns or thundering
herds when monitoring many URLs with the same interval.

```typescript
wd.watch("https://example.com", {
  interval: 300,
  jitter:   0.2,  // actual interval: 240-360s (300 ± 20%)
});
```

`jitter` is a fraction 0-1. `0.2` means ±20% variance around `interval`.


### Pause and resume

Suspend a watcher temporarily without stopping the entire scheduler. Useful for maintenance
windows, rate-limit back-off, or feature flags.

```typescript
const stop = wd
  .watch("https://example.com")
  .start();

// Pause during nightly maintenance
const MAINTENANCE_HOUR = 3;
setInterval(() => {
  const hour = new Date().getHours();
  if (hour === MAINTENANCE_HOUR) {
    wd.pause("https://example.com");
  } else {
    wd.resume("https://example.com");
  }
}, 60_000);
```

Pausing is per-URL. Other watchers continue unaffected.


### Watcher status

Get a live snapshot of the state of all registered watchers - useful for dashboards,
health checks, or diagnostics.

```typescript
const statuses = wd.status();
for (const s of statuses) {
  console.log(`${s.label}: ${s.checksCount} checks, ${s.changesCount} changes, paused=${s.paused}`);
}
```

From the CLI:

```bash
watchdiff status                       # reads watchdiff.config.json
watchdiff status --config my.json
watchdiff status --json                # machine-readable output
```


### Silence detection

Fire a callback when a page has not changed for longer than expected. Useful to detect
pages that have gone offline or stale without any content change being emitted.

```typescript
wd.watch("https://example.com/feed", {
  interval:             300,
  alertIfNoChangeAfter: 86400,  // 24 hours
  onSilence: ({ url, label, secondsSinceLastChange }) => {
    console.warn(`${label} has not changed in ${secondsSinceLastChange}s`);
    sendAlert(`${label} may be offline or broken`);
  },
});
```

The silence callback fires at most once per `alertIfNoChangeAfter` seconds to avoid repeated
alerts. The timer resets on the next detected change.


### Dry-run mode

Fetch and diff pages without writing any data to disk or firing any alerts. Useful
for testing your config or verifying selectors before going live.

```typescript
wd.watch("https://example.com", {
  target: ".price",
  dryRun: true,
  onChange: (report) => console.log("Would have alerted:", reportSummary(report)),
});
```

```bash
watchdiff run https://example.com --target .price --dry-run
watchdiff check https://example.com --dry-run
```

In dry-run mode: snapshots are not saved, reports are not saved, no callbacks or webhooks
are fired. The `onChange` callback is still invoked if provided - letting you inspect what
*would* have been alerted.


### Snapshot pruning

Limit disk usage by keeping only the most recent N snapshots per URL. Older snapshots
are deleted automatically after each save.

```typescript
wd.watch("https://example.com", {
  maxSnapshots: 50,  // keep last 50 snapshots
});
```

Works with both the JSON store and SqliteStore. Does not affect reports.


### Change threshold

Require a minimum fraction of content to have changed before firing an alert. Useful for
pages that have minor noise (timestamps, ad counters) but you only care about substantial
changes.

```typescript
wd.watch("https://example.com/article", {
  changeThreshold: 0.05,  // only alert if at least 5% of content changed
});
```

`changeThreshold` is a fraction from `0` (any change, default) to `1` (entire content
must change). Changes below the threshold are still stored, just not alerted.


### Ignore numbers

Strip standalone numbers from the text before diffing. Useful when a page contains
rotating counters, view counts, timestamps, or prices you don't care about.

```typescript
wd.watch("https://example.com/live", {
  ignoreNumbers: true,  // "1,234 views updated at 14:52" → no change detected
});
```

```bash
watchdiff run https://example.com --ignore-numbers
```


### Error callback

Instead of logging fetch and parse errors to the console, handle them in your own code:

```typescript
wd.watch("https://example.com", {
  retries:  2,
  onError: (err, config) => {
    myLogger.error({ url: config.url, message: err.message });
    metrics.increment("watchdiff.errors");
  },
});
```

The callback receives the `Error` object and the full `WatchConfig` for the failing URL.


### Webhook channels

Payload format is auto-detected from the URL. All webhooks time out after 10 seconds and
never block each other (`Promise.allSettled`).

| URL pattern | Channel | Payload |
|---|---|---|
| `discord.com` | Discord | `{ content: "..." }` (≤ 2000 chars) |
| `hooks.slack.com` | Slack | `{ text: "..." }` (≤ 3000 chars) |
| `api.telegram.org` | Telegram Bot API | `{ chat_id, text, parse_mode: "HTML" }` |
| `outlook.office.com` / `webhook.office.com` | Microsoft Teams | MessageCard JSON |
| `ntfy.sh` / `ntfy.` | ntfy.sh | `{ message }` with Title and Tags headers |
| anything else | Generic | Full `DiffReport` as JSON |

**Telegram** - format the URL as:
```
https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>
```

```typescript
wd.watch("https://example.com", {
  webhooks: [
    "https://api.telegram.org/botABC123/sendMessage?chat_id=-1001234567",
  ],
});
```

**ntfy.sh** - self-hosted or public push notifications:
```typescript
wd.watch("https://example.com", {
  webhooks: ["https://ntfy.sh/my-topic"],
});
```

**Microsoft Teams** - use an Incoming Webhook connector URL:
```typescript
wd.watch("https://example.com", {
  webhooks: ["https://outlook.office.com/webhook/YOUR/IncomingWebhook/TOKEN"],
});
```


### HTML archiving

Save the raw HTML of the full page to disk whenever a change is detected. Files are written
to `<storageDir>/archive/<urlhash>_<timestamp>.html`.

```typescript
wd.watch("https://example.com", {
  archiveHtml: true,
  interval:    300,
});
```

```bash
watchdiff run https://example.com --archive-html
```

Archived files are never pruned automatically - manage retention yourself if storage matters.


### Screenshot on change

Capture a full-page PNG screenshot whenever a change is detected. Requires `browser: true`
(Playwright). Files are written to `<storageDir>/archive/<urlhash>_<timestamp>.png`.

```typescript
wd.watch("https://example.com/dashboard", {
  browser:            true,
  screenshotOnChange: true,
  interval:           120,
});
```

```bash
watchdiff run https://example.com --browser --screenshot
```

A failed screenshot is logged as a warning but does not interrupt the normal diff pipeline.


### Change spike detection

Alert when a page changes too frequently within a rolling time window. Useful for detecting
flapping deployments, feed storms, or runaway content updates.

```typescript
wd.watch("https://example.com/live", {
  interval:             30,
  changeSpikeWindow:    300,    // 5-minute window
  changeSpikeThreshold: 5,      // alert if ≥ 5 changes in that window
  onSpike: ({ url, label, changesInWindow, windowSeconds }) => {
    console.warn(`${label}: ${changesInWindow} changes in ${windowSeconds}s`);
    sendAlert(`Spike detected on ${url}`);
  },
});
```

The `onSpike` callback fires at most once per `changeSpikeWindow` seconds to avoid repeated
alerts during the same spike.

```typescript
interface SpikeInfo {
  url:             string;
  label:           string;
  changesInWindow: number;  // number of changes detected inside the window
  windowSeconds:   number;  // width of the spike detection window
}
```


### RSS / Atom monitoring

Use `diffMode: "rss"` to monitor RSS 2.0 and Atom feeds at the item level. WatchDiff parses
the XML, identifies items by `guid` (RSS) or `id` (Atom), and reports added, removed, and
modified items individually - much cleaner than a raw XML line diff.

```typescript
wd.watch("https://hnrss.org/frontpage", {
  diffMode: "rss",
  label:    "Hacker News front page",
  interval: 300,
  onChange: (report) => {
    for (const c of report.changes) {
      console.log(changeHuman(c));
      // [+] Added: "Show HN: My project" (https://news.ycombinator.com/item?id=42)
    }
  },
});
```

```bash
watchdiff run https://hnrss.org/frontpage --diff-mode rss
```

Falls back to line diff if no `<item>` or `<entry>` elements are found.


### HTTP status monitoring

Detect HTTP-level failures independently of content changes. When `alertOnStatusChange: true`,
WatchDiff compares the HTTP status code on each check and alerts when it changes - even if the
page content looks identical.

Typical use cases: detect a site going down (`200 → 503`), a page being deleted (`200 → 404`),
or a server recovering from an outage (`503 → 200`).

```typescript
wd.watch("https://example.com", {
  interval:             60,
  alertOnStatusChange:  true,
  onStatusChange: ({ url, label, previousStatus, currentStatus }) => {
    if (currentStatus === 200) {
      console.log(`[ok] ${label} recovered (${previousStatus} → 200)`);
    } else {
      console.error(`[down] ${label} is down: ${previousStatus} → ${currentStatus}`);
    }
  },
  // Optionally combine with webhooks for instant notifications
  webhooks: ["https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"],
});
```

```bash
watchdiff run https://example.com --alert-on-status-change --webhook https://ntfy.sh/my-topic
```

Status codes:
- `0` : unreachable (network error, DNS failure, timeout)
- `200` : ok
- `403` : forbidden
- `404` : not found
- `429` : rate limited
- `503` : service unavailable

The `/metrics` endpoint also exposes a `watchdiff_last_http_status` gauge per URL.

```typescript
interface StatusChangeInfo {
  url:            string;
  label:          string;
  previousStatus: number;
  currentStatus:  number;  // 0 = unreachable
}
```

### Database monitoring

Monitor database tables for row-level changes, schema evolution, aggregate thresholds, or single-value changes.
Requires the driver package for the database you target (see [Optional dependencies](#optional-dependencies)).

#### Diff modes

| Mode | What is compared | Typical use case |
|---|---|---|
| `row` | Each row identified by primary key | Watch a products or users table for CRUD changes |
| `schema` | Column definitions (name, type, nullability) | Detect DDL changes (ALTER TABLE, etc.) |
| `aggregate` | A single numeric result of a custom query | Alert when an order count jumps by ≥ 10% |
| `value` | A single arbitrary value returned by a custom query | Watch a config flag or a max-ID cursor |

#### Row diff

```typescript
wd.watchDb("sqlite://./app.db", "products", {
  primaryKey:    ["id"],
  ignoreColumns: ["updated_at"],  // exclude noisy timestamps
  interval:      60,
  onChange: (report) => {
    for (const c of report.changes) {
      if (c.kind === "inserted")
        console.log("New product:", c.row);
      if (c.kind === "deleted")
        console.log("Product removed:", c.row);
      if (c.kind === "updated") {
        for (const m of c.modifications ?? []) {
          console.log(`${m.column}: ${m.before} → ${m.after}`);
        }
      }
    }
  },
  webhooks: ["https://ntfy.sh/my-products"],
});
```

Without `primaryKey`, rows are compared as an unordered set - inserts and deletes are detected but updates are not.

#### Schema diff

```typescript
wd.watchDb("postgresql://user:pass@localhost/mydb", "users", {
  diffMode:       "schema",
  interval:       300,
  onSchemaChange: (info) => {
    for (const c of info.changes) {
      console.log(`Column ${c.column}: ${c.context}`);  // "column added", "type changed", etc.
    }
  },
});
```

#### Aggregate / threshold diff

```typescript
wd.watchDb("mysql://user:pass@localhost/shop", "orders", {
  diffMode:    "aggregate",
  query:       "SELECT COUNT(*) FROM orders WHERE status = 'pending'",
  threshold:   10,  // alert when count changes by ≥ 10%
  onThreshold: (info) => {
    console.log(`Pending orders: ${info.previousValue} → ${info.currentValue} (${info.changePercent.toFixed(1)}%)`);
  },
});
```

#### Value diff

```typescript
wd.watchDb("postgresql://user:pass@localhost/app", "config", {
  diffMode: "value",
  query:    "SELECT value FROM config WHERE key = 'feature_flag_x'",
  onChange: (report) => {
    const ch = report.changes[0]!;
    console.log(`feature_flag_x changed: ${ch.before} → ${ch.after}`);
  },
});
```

#### CLI

```bash
# Row diff on a SQLite file
watchdiff db sqlite://./app.db products --primary-key id --interval 60

# Ignore noisy timestamp column
watchdiff db sqlite://./app.db products --primary-key id --ignore-columns updated_at

# PostgreSQL schema monitoring
watchdiff db postgresql://user:pass@localhost/mydb users --diff-mode schema

# Aggregate threshold (alert when count changes by ≥ 10%)
watchdiff db mysql://user:pass@localhost/shop orders --diff-mode aggregate \
  --query "SELECT COUNT(*) FROM orders WHERE status='pending'" --threshold 10

# Suppress update alerts, watch only inserts and deletes
watchdiff db sqlite://./app.db products --no-update

# Send to a webhook on any change
watchdiff db postgresql://user:pass@localhost/mydb users \
  --webhook https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

#### `DbDiffReport` structure

```typescript
interface DbDiffReport {
  connectionString: string;
  table:            string;
  label:            string;
  before:           DbSnapshot;
  after:            DbSnapshot;
  changes:          DbChange[];
  diffMode:         DbDiffMode;
  comparedAt:       Date;
}

type DbChangeKind =
  | "inserted"          // new row (row mode)
  | "deleted"           // removed row (row mode)
  | "updated"           // row fields changed (row mode)
  | "schema_changed"    // column added, removed, or type-changed (schema mode)
  | "threshold_exceeded"// aggregate value changed beyond threshold (aggregate mode)
  | "value_changed";    // tracked value changed (value mode)
```

### Stable watcher ID

Assign a stable `id` to a watcher. The ID is used as the storage key and as the argument to `pause()` / `resume()` — letting you target a specific watcher even when multiple watchers share the same URL.

```typescript
wd
  .watch("https://example.com/product", { id: "product-price", target: ".price" })
  .watch("https://example.com/product", { id: "product-stock", target: ".stock" });

// Pause only the price watcher
wd.pause("product-price");

// Resume it later
wd.resume("product-price");
```

Without `id`, `pause(url)` pauses **all** watchers for that URL. With `id`, each watcher is independent.

```typescript
// Status reflects the id
const statuses = wd.status();
// [{ id: "product-price", url: "...", paused: true, ... }, ...]
```


## Concurrency limiting

Cap the number of simultaneous in-flight checks. Useful when monitoring many URLs to avoid overwhelming a single server or hitting rate limits.

```typescript
// At most 5 checks running at the same time
const wd = new WatchDiff({ concurrency: 5 });

wd.watch("https://site.com/page-1", { interval: 30 });
wd.watch("https://site.com/page-2", { interval: 30 });
// ... 50 more watches
wd.start();
```

Without `concurrency`, all due checks fire simultaneously. With it, excess checks queue behind a semaphore and run as slots free up.

```typescript
import { WatchDiff, SqliteStore } from "watchdiff-core";

const wd = new WatchDiff({ concurrency: 10, store: new SqliteStore(".watchdiff.db") });
```


## Maintenance windows

Automatically skip checks during known downtime windows — no code change needed at runtime.

```typescript
wd.watch("https://example.com", {
  interval: 60,
  maintenanceWindows: [
    // Nightly maintenance 2am–4am UTC on 2026-09-15
    { from: "2026-09-15T02:00:00Z", to: "2026-09-15T04:00:00Z" },
    // A longer planned outage
    { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-01T06:00:00Z") },
  ],
  onChange: (report) => console.log(report.changes),
});
```

While the current time is inside any window, the check is silently skipped and `status()` reports `inMaintenance: true`. The window is evaluated fresh on each tick, so no restart is needed after the window passes.

```typescript
interface MaintenanceWindow {
  from: string | Date;   // ISO string or Date
  to:   string | Date;
}
```


## Active hours

Restrict monitoring to specific hours and days of the week. Checks are skipped outside the defined window, with full IANA timezone support.

```typescript
// Monitor only during business hours in Paris time
wd.watch("https://example.com", {
  interval: 60,
  activeBetween: {
    timezone: "Europe/Paris",
    days:     ["monday", "tuesday", "wednesday", "thursday", "friday"],
    from:     "09:00",
    to:       "18:00",
  },
});

// Monitor 24/7 but skip nights (UTC)
wd.watch("https://api.example.com/stock", {
  interval: 30,
  activeBetween: { from: "07:00", to: "22:00" },
});
```

`days` defaults to all 7 days when omitted. `timezone` defaults to UTC when omitted. Time comparison uses `Intl.DateTimeFormat` — no extra dependency.

```typescript
interface ActiveBetween {
  timezone?: string;  // IANA timezone, e.g. "Europe/Paris". Default: UTC
  days?:     Array<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday">;
  from:      string;  // HH:MM, e.g. "09:00"
  to:        string;  // HH:MM, e.g. "18:00"
}
```


## Failure policy

Control how many consecutive fetch failures must occur before `onError` and alerts fire, and how many consecutive successes are needed before re-enabling alerts after a failure streak. Optionally honour the `Retry-After` header on 429/503 responses.

```typescript
wd.watch("https://example.com", {
  failurePolicy: {
    consecutiveFailures: 3,   // alert only after 3 failures in a row (default: 1)
    recoveryChecks:      2,   // require 2 successes in a row to clear the failure state (default: 1)
    respectRetryAfter:   true, // honour Retry-After header on 429 / 503
  },
  onError: (err) => console.error("Persistent failure:", err.message),
});
```

Without `failurePolicy`, the first fetch error fires `onError` immediately. With it:
- Errors below the threshold are silently swallowed (no alert, no callback).
- After `consecutiveFailures` errors in a row, the alert fires once and is then suppressed until recovery.
- Recovery requires `recoveryChecks` consecutive successful fetches.
- When `respectRetryAfter: true` and the server responds with a `Retry-After` header, the next check for that watcher is postponed until the header deadline.

```typescript
interface FailurePolicy {
  consecutiveFailures?: number;   // default 1
  recoveryChecks?:      number;   // default 1
  respectRetryAfter?:   boolean;  // default false
}
```


## URL comparison

Compare two arbitrary URLs on the spot without any persistent storage. Useful for comparing
staging vs production, two versions of a page, or two different APIs.

**API:**

```typescript
const wd     = new WatchDiff();
const report = await wd.compareUrls(
  "https://staging.example.com/product/42",
  "https://www.example.com/product/42",
  { target: ".price", diffMode: "word" }
);

if (report.changes.length === 0) {
  console.log("Identical.");
} else {
  for (const c of report.changes) console.log(changeHuman(c));
}
```

**CLI:**

```bash
watchdiff compare https://staging.example.com https://www.example.com
watchdiff compare https://staging.example.com https://www.example.com --target .price --diff-mode word
watchdiff compare https://api.example.com/v1/data https://api.example.com/v2/data --diff-mode json
watchdiff compare https://a.example.com https://b.example.com --json
```


### Status server

Start a lightweight HTTP server to expose watcher state for dashboards, load balancers,
and Prometheus scrapers - no extra dependencies, pure Node.js `http`.

**API:**

```typescript
const wd = new WatchDiff();
wd.watch("https://example.com", { interval: 60 });
wd.startStatusServer(9090);
wd.start();

// wd.stopStatusServer();  - stops the HTTP server
```

**CLI:**

```bash
watchdiff run https://example.com --interval 60 --status-port 9090
```

**Endpoints:**

| Endpoint | Response |
|---|---|
| `GET /health` | `200 { "status": "ok" }` |
| `GET /status` | `200` JSON array of `WatcherStatus` |
| `GET /metrics` | `200` Prometheus text exposition format |

**`/metrics` example:**

```
# HELP watchdiff_checks_total Total number of checks performed per URL.
# TYPE watchdiff_checks_total counter
watchdiff_checks_total{url="https://example.com",label="example.com"} 42

# HELP watchdiff_changes_total Total number of checks that produced at least one change.
# TYPE watchdiff_changes_total counter
watchdiff_changes_total{url="https://example.com",label="example.com"} 3

# HELP watchdiff_errors_total Total number of fetch or parse errors.
# TYPE watchdiff_errors_total counter
watchdiff_errors_total{url="https://example.com",label="example.com"} 0

# HELP watchdiff_paused 1 if the watcher is currently paused, 0 otherwise.
# TYPE watchdiff_paused gauge
watchdiff_paused{url="https://example.com",label="example.com"} 0
```

The server calls `.unref()` on the underlying socket - it will not keep the Node.js process
alive on its own.


### SQLite storage backend

The default storage writes one JSON file per watched URL. For high-volume monitoring
(hundreds of URLs, long retention) the SQLite backend is more efficient.

```bash
npm install better-sqlite3
```

```typescript
import { WatchDiff, SqliteStore } from "watchdiff-core";

const store = new SqliteStore(".watchdiff.db");
const wd    = new WatchDiff(undefined, store);

wd.watch("https://example.com", { interval: 60 });
wd.start();
```

`SqliteStore` implements the same `IStore` interface as the default `Store` and also
implements `pruneSnapshots` for `maxSnapshots` support.


### CSV and XLSX export

Export your full monitoring history for analysis in any spreadsheet tool.

**CSV (no extra dependency):**

```typescript
import { WatchDiff } from "watchdiff-core";
import { writeFileSync } from "node:fs";

const wd = new WatchDiff();
wd.watch("https://example.com", { target: ".price" });

// Reports (one row per change)
writeFileSync("reports.csv", wd.exportReportsCsv("https://example.com", 500));

// Snapshots (one row per captured snapshot)
writeFileSync("snapshots.csv", wd.exportSnapshotsCsv("https://example.com", 200));
```

**XLSX (requires exceljs):**

```bash
npm install exceljs
```

```typescript
const buf = await wd.exportReportsXlsx("https://example.com", 500);
writeFileSync("reports.xlsx", buf);
```

CSV columns (reports): `url`, `label`, `comparedAt`, `kind`, `before`, `after`

CSV columns (snapshots): `url`, `target`, `capturedAt`, `checksum`, `contentPreview`


### `watchdiff init` - config file

Generate a `watchdiff.config.json` template in the current directory:

```bash
watchdiff init
```

Config files are validated at startup. If a field has an invalid value (unknown `diffMode`, negative `interval`, malformed URL, etc.), watchdiff prints a clear error and exits instead of failing silently.

The generated file includes all supported options:

```json
{
  "storage": ".watchdiff",
  "watches": [
    {
      "url": "https://example.com",
      "target": ".price",
      "interval": 300,
      "label": "Example - Product Price",
      "browser": false,
      "diffMode": "line",
      "cooldown": 0,
      "retries": 0,
      "jitter": 0,
      "dryRun": false,
      "maxSnapshots": 100,
      "changeThreshold": 0,
      "ignoreNumbers": false,
      "alertIfNoChangeAfter": 0,
      "webhooks": [],
      "ignoreSelectors": [],
      "proxies": [],
      "userAgents": []
    }
  ]
}
```


### Environment variables

All CLI options accept a `WATCHDIFF_*` environment variable as a fallback. CLI flags always take precedence.

| Variable | CLI equivalent | Example |
|---|---|---|
| `WATCHDIFF_STORAGE` | `-s, --storage` | `WATCHDIFF_STORAGE=.data` |
| `WATCHDIFF_INTERVAL` | `-i, --interval` | `WATCHDIFF_INTERVAL=60` |
| `WATCHDIFF_WEBHOOK` | `-w, --webhook` | `WATCHDIFF_WEBHOOK=https://discord.com/...` |
| `WATCHDIFF_DIFF_MODE` | `--diff-mode` | `WATCHDIFF_DIFF_MODE=word` |
| `WATCHDIFF_RETRIES` | `--retries` | `WATCHDIFF_RETRIES=3` |
| `WATCHDIFF_COOLDOWN` | `--cooldown` | `WATCHDIFF_COOLDOWN=3600` |
| `WATCHDIFF_JITTER` | `--jitter` | `WATCHDIFF_JITTER=0.2` |
| `WATCHDIFF_BROWSER` | `--browser` | `WATCHDIFF_BROWSER=true` |
| `WATCHDIFF_IGNORE_NUMBERS` | `--ignore-numbers` | `WATCHDIFF_IGNORE_NUMBERS=1` |
| `WATCHDIFF_MAX_SNAPSHOTS` | `--max-snapshots` | `WATCHDIFF_MAX_SNAPSHOTS=100` |
| `WATCHDIFF_CHANGE_THRESHOLD` | `--change-threshold` | `WATCHDIFF_CHANGE_THRESHOLD=0.05` |
| `WATCHDIFF_ALERT_IF_NO_CHANGE` | `--alert-if-no-change` | `WATCHDIFF_ALERT_IF_NO_CHANGE=86400` |
| `WATCHDIFF_LOG_FORMAT` | `--log-format` | `WATCHDIFF_LOG_FORMAT=json` |
| `WATCHDIFF_TARGET` | `-t, --target` | `WATCHDIFF_TARGET=.price` |
| `WATCHDIFF_ARCHIVE_HTML` | `--archive-html` | `WATCHDIFF_ARCHIVE_HTML=true` |
| `WATCHDIFF_SCREENSHOT` | `--screenshot` | `WATCHDIFF_SCREENSHOT=true` |
| `WATCHDIFF_SPIKE_WINDOW` | `--spike-window` | `WATCHDIFF_SPIKE_WINDOW=300` |
| `WATCHDIFF_SPIKE_THRESHOLD` | `--spike-threshold` | `WATCHDIFF_SPIKE_THRESHOLD=5` |
| `WATCHDIFF_ALERT_ON_STATUS_CHANGE` | `--alert-on-status-change` | `WATCHDIFF_ALERT_ON_STATUS_CHANGE=true` |

Useful for Docker or CI environments where you want to avoid hardcoding values in the config file:

```bash
WATCHDIFF_STORAGE=/data \
WATCHDIFF_LOG_FORMAT=json \
WATCHDIFF_WEBHOOK=https://hooks.slack.com/... \
watchdiff run --config /etc/watchdiff.config.json
```


### Validate config

Run `watchdiff validate` to check a config file for common errors before deploying. See the [CLI section](#validate---validate-config-file) for full details.

```bash
watchdiff validate                    # validates watchdiff.config.json
watchdiff validate --config my.json   # validates a specific file
```


### HTTP Basic Auth

Pass `auth: { user, pass }` to add an `Authorization: Basic` header to every request for that watcher. The credentials are Base64-encoded automatically.

```typescript
wd.watch("https://internal.corp/dashboard", {
  auth: { user: "monitoring", pass: "s3cret" },
  target: ".metric",
  interval: 60,
});
```

The `auth` option works alongside `headers`, `cookies`, and proxy rotation. It is separate from `webhookHeaders`, which controls outgoing webhook requests rather than inbound fetch requests.


### onBeforeCheck hook

`onBeforeCheck` is called once before every fetch tick for a given watcher. It receives the `WatchConfig` and may return a `Promise`. A thrown error is caught and logged as a warning; the check still proceeds.

A common use case is refreshing a short-lived token in `config.headers` before each request:

```typescript
let token = await fetchToken();

wd.watch("https://api.example.com/prices", {
  headers: { Authorization: `Bearer ${token}` },
  onBeforeCheck: async (config) => {
    token = await fetchToken();               // refresh before each tick
    config.headers["Authorization"] = `Bearer ${token}`;
  },
  interval: 60,
});
```


### POST request support

Set `requestBody` to switch the HTTP method from GET to POST. Pass a string for raw bodies (e.g. GraphQL queries), or an object for JSON payloads — the object is serialised automatically and a `Content-Type: application/json` header is added.

```typescript
// JSON POST
wd.watch("https://api.example.com/graphql", {
  requestBody: { query: "{ products { id name price } }" },
  diffMode: "json",
  interval: 60,
});

// Raw string body
wd.watch("https://api.example.com/search", {
  requestBody: "q=watchdiff&format=json",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  interval: 300,
});
```


### Watcher tags

Assign one or more tags to a watcher via `tags: string[]`. Tags are arbitrary strings used for grouping. Pass a tag name to `wd.pause()` or `wd.resume()` to operate on every watcher that carries that tag in a single call.

```typescript
wd
  .watch("https://shop.example.com/prices", { tags: ["prod", "prices"], interval: 60 })
  .watch("https://shop.example.com/stock",  { tags: ["prod", "stock"],  interval: 60 })
  .watch("https://staging.example.com",     { tags: ["staging"],        interval: 60 });

const stop = wd.start();

// Pause all production watchers at once
wd.pause("prod");

// Resume only the price watcher group
wd.resume("prices");
```

`pause()` and `resume()` first check for a direct URL or stable ID match; if none is found they fall back to matching by tag. A single call may pause or resume multiple watchers when the tag is shared.


### minInterval

`minInterval` sets a floor on the minimum seconds that must elapse between two consecutive checks for a watcher. It prevents jitter or very short intervals from scheduling checks faster than you intend.

Set it globally for all watchers via `WatchDiffOptions`:

```typescript
// No watcher will run more than once every 30 seconds, regardless of its interval or jitter
const wd = new WatchDiff({ minInterval: 30 });
```

Or override it per watcher:

```typescript
wd.watch("https://example.com", {
  interval: 10,   // requested interval
  jitter: 0.5,    // ±50% variance
  minInterval: 5, // but never faster than every 5 seconds
});
```

When both a global and per-watcher `minInterval` are set, the per-watcher value takes precedence for that watcher. The floor is applied after jitter is computed.


## Types

### `DiffReport`

```typescript
interface DiffReport {
  url:        string;
  target:     string | undefined;
  label:      string;
  before:     Snapshot;
  after:      Snapshot;
  changes:    Change[];
  comparedAt: Date;
}
```

### `Change`

```typescript
interface Change {
  kind:     "added" | "removed" | "modified" | "unchanged";
  before?:  string;
  after?:   string;
  context?: string;  // JSON key path in "json" mode, surrounding hint otherwise
}
```

### `Snapshot`

```typescript
interface Snapshot {
  url:         string;
  target:      string | undefined;
  content:     string;   // cleaned plain text
  rawHtml:     string;   // raw HTML of the extracted zone
  capturedAt:  Date;
  checksum:    string;   // SHA-256 of content
}
```

### `WatcherStatus`

```typescript
interface WatcherStatus {
  url:           string;
  id?:           string;        // set when id was configured
  label:         string;
  target:        string | undefined;
  interval:      number;
  paused:        boolean;
  inMaintenance: boolean;       // true when inside a maintenanceWindow
  lastCheckAt:   Date | null;
  nextCheckAt:   Date | null;
  lastChangeAt:  Date | null;
  checksCount:   number;
  changesCount:  number;
  errorsCount:   number;
}
```

### `WatchDiffOptions`

```typescript
interface WatchDiffOptions {
  storageDir?:  string;    // storage directory (default ".watchdiff")
  store?:       IStore;    // custom store — overrides storageDir
  concurrency?: number;    // max simultaneous in-flight checks (default: unlimited)
}
```

### `MaintenanceWindow`

```typescript
interface MaintenanceWindow {
  from: string | Date;   // ISO string or Date — start of window
  to:   string | Date;   // ISO string or Date — end of window
}
```

### `ActiveBetween`

```typescript
interface ActiveBetween {
  timezone?: string;  // IANA timezone (e.g. "Europe/Paris"). Default: UTC
  days?:     Array<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday">;
  from:      string;  // HH:MM start of active window (e.g. "09:00")
  to:        string;  // HH:MM end of active window (e.g. "18:00")
}
```

### `FailurePolicy`

```typescript
interface FailurePolicy {
  consecutiveFailures?: number;   // failures in a row before alerting (default 1)
  recoveryChecks?:      number;   // successes in a row before clearing failure state (default 1)
  respectRetryAfter?:   boolean;  // honour Retry-After header on 429/503 (default false)
}
```

### `SpikeInfo`

```typescript
interface SpikeInfo {
  url:             string;
  label:           string;
  changesInWindow: number;
  windowSeconds:   number;
}
```

### `StatusChangeInfo`

```typescript
interface StatusChangeInfo {
  url:            string;
  label:          string;
  previousStatus: number;
  currentStatus:  number;  // 0 = unreachable (network error / timeout)
}
```

### `SilenceInfo`

```typescript
interface SilenceInfo {
  url:                    string;
  label:                  string;
  secondsSinceLastChange: number;
}
```

### `BrowserOptions`

```typescript
interface BrowserOptions {
  waitFor?:          "load" | "domcontentloaded" | "networkidle";
  waitForSelector?:  string;
  executablePath?:   string;
}
```

### `IStore`

```typescript
interface IStore {
  saveSnapshot(snapshot: Snapshot): void;
  loadLatest(url: string, target: string | undefined): Snapshot | null;
  loadHistory(url: string, target: string | undefined, limit?: number): Snapshot[];
  clearHistory(url: string, target: string | undefined): void;
  saveReport(report: DiffReport): void;
  loadReports(url: string, target: string | undefined, limit?: number): Record<string, unknown>[];
  pruneSnapshots?(url: string, target: string | undefined, max: number): void; // optional
}
```

### Database types

### `DbDiffReport`

```typescript
interface DbDiffReport {
  connectionString: string;
  table:            string;
  label:            string;
  before:           DbSnapshot;
  after:            DbSnapshot;
  changes:          DbChange[];
  diffMode:         DbDiffMode;   // "row" | "schema" | "aggregate" | "value"
  comparedAt:       Date;
}
```

### `DbChange`

```typescript
type DbChangeKind =
  | "inserted"           // row mode - new row detected
  | "deleted"            // row mode - row removed
  | "updated"            // row mode - row fields changed
  | "schema_changed"     // schema mode - column added, removed, or type changed
  | "threshold_exceeded" // aggregate mode - scalar value changed beyond threshold
  | "value_changed";     // value mode - tracked single value changed

interface DbChange {
  kind:           DbChangeKind;
  rowKey?:        string;           // primary-key value(s) as JSON (row mode)
  row?:           Row;              // full row content (inserted / deleted)
  modifications?: RowModification[]; // per-column diffs (updated)
  column?:        string;           // affected column (schema_changed)
  before?:        unknown;
  after?:         unknown;
  context?:       string;           // human hint, e.g. "column added", "20.00% change"
}

interface RowModification {
  column: string;
  before: unknown;
  after:  unknown;
}
```

### `DbSnapshot`

```typescript
interface DbSnapshot {
  connectionString: string;
  table:            string;
  rows:             Row[];           // Row = Record<string, unknown>
  schema?:          ColumnDef[];     // present in schema mode
  capturedAt:       Date;
  checksum:         string;          // SHA-256 of serialised rows
  rowCount:         number;
}

interface ColumnDef {
  name:          string;
  type:          string;
  nullable:      boolean;
  primaryKey:    boolean;
  defaultValue?: string;
}
```

### `SchemaChangeInfo`

```typescript
interface SchemaChangeInfo {
  connectionString: string;
  table:            string;
  label:            string;
  changes:          DbChange[];
}
```

### `ThresholdInfo`

```typescript
interface ThresholdInfo {
  connectionString: string;
  table:            string;
  label:            string;
  previousValue:    number;
  currentValue:     number;
  changePercent:    number;
  threshold:        number;
}
```

### `DbWatcherStatus`

```typescript
interface DbWatcherStatus {
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
```


## Helper functions

### Web helpers

```typescript
import { reportSummary, reportHasChanges, reportAsDict, changeHuman } from "watchdiff-core";

reportSummary(report);     // "[Book price] 1 modified - 2025-01-01 12:00:00 UTC"
reportHasChanges(report);  // boolean
reportAsDict(report);      // JSON-serialisable plain object
changeHuman(change);       // "[~] Changed (price): '19.99' → '24.99'"
```

### Database helpers

```typescript
import {
  makeDbWatchConfig,
  makeDbSnapshot,
  dbSnapshotKey,
  dbHasChanges,
  dbReportSummary,
} from "watchdiff-core";

// Build a validated config with defaults
const cfg = makeDbWatchConfig("sqlite://./app.db", "products", {
  primaryKey: ["id"],
  interval:   60,
});

// Create a snapshot manually (useful for tests or custom pipelines)
const snap = makeDbSnapshot("sqlite://./app.db", "products", rows, schema);

// Stable storage key for a given connection + table (used internally by IStore)
const key = dbSnapshotKey("sqlite://./app.db", "products");
// → "db::a3f9c2d41b8e::products"

// Check whether a DbDiffReport contains any changes
dbHasChanges(report);   // boolean

// Human-readable summary line
dbReportSummary(report);
// "[products @ app.db] 2 inserted, 1 deleted - 2025-06-01 14:32:00 UTC"
```


## CLI

```bash
npm install -g watchdiff-core
```

### `run` - continuous monitoring

```bash
# Single URL
watchdiff run https://example.com --target .price --interval 60

# JS-heavy page (Playwright)
watchdiff run https://example.com --browser --target .price

# With proxy
watchdiff run https://example.com --proxy http://proxy:8080

# Custom User-Agent
watchdiff run https://example.com --user-agent "MyBot/1.0"

# Word diff
watchdiff run https://example.com --diff-mode word

# JSON diff
watchdiff run https://api.example.com/data --diff-mode json

# With a Discord / Slack / Telegram / ntfy.sh webhook
watchdiff run https://example.com --target .price --webhook https://discord.com/api/webhooks/ID/TOKEN

# Retry 3 times on error
watchdiff run https://example.com --retries 3

# Add ±20% jitter to interval
watchdiff run https://example.com --interval 300 --jitter 0.2

# Dry-run (no save, no alerts)
watchdiff run https://example.com --dry-run

# Keep only last 50 snapshots
watchdiff run https://example.com --max-snapshots 50

# Only alert if 5% or more of content changed
watchdiff run https://example.com --change-threshold 0.05

# Ignore counter / date noise
watchdiff run https://example.com --ignore-numbers

# Silence alert after 24h without change
watchdiff run https://example.com --alert-if-no-change 86400

# Archive HTML on every change
watchdiff run https://example.com --archive-html

# Take a screenshot on every change (requires --browser)
watchdiff run https://example.com --browser --screenshot

# Alert when ≥ 5 changes happen within 5 minutes
watchdiff run https://example.com --spike-window 300 --spike-threshold 5

# Expose status / metrics over HTTP
watchdiff run https://example.com --interval 60 --status-port 9090

# RSS feed monitoring
watchdiff run https://hnrss.org/frontpage --diff-mode rss

# Alert on HTTP status change (200 → 503, 503 → 200, etc.)
watchdiff run https://example.com --alert-on-status-change

# Output logs as structured JSON (for ELK, Datadog, Loki, etc.)
watchdiff run https://example.com --log-format json

# Suppress all output except errors
watchdiff run https://example.com -q

# Show debug ticks and cooldown skips
watchdiff run https://example.com -v

# From a config file
watchdiff run --config watchdiff.config.json

# Auto-discover watchdiff.config.json in current directory
watchdiff run
```

### `check` - single check

```bash
watchdiff check https://example.com --target .price
watchdiff check https://example.com --browser --diff-mode semantic
watchdiff check https://example.com --dry-run
watchdiff check https://example.com --json
watchdiff check https://example.com --log-format json
```

### `compare` - diff two URLs

Fetch and diff two URLs on the spot. No storage is written.

```bash
# Basic comparison
watchdiff compare https://staging.example.com https://www.example.com

# With a CSS selector and word-level diff
watchdiff compare https://staging.example.com https://www.example.com --target .price --diff-mode word

# JSON API diff
watchdiff compare https://api.example.com/v1/data https://api.example.com/v2/data --diff-mode json

# Machine-readable output
watchdiff compare https://a.example.com https://b.example.com --json
```

### `status` - watcher status

Show runtime state for all watchers defined in a config file:

```bash
watchdiff status
watchdiff status --config my.json
watchdiff status --json
```

### `list` - list configured watchers

Print all configured watchers from a config file without starting the scheduler. Shows label, URL, target, interval or schedule, tags, and paused state.

```bash
watchdiff list
watchdiff list --config my.json
watchdiff list --storage .mydata
watchdiff list --json    # output a JSON array
```

### `diff` - last stored diff

Show the most recent diff report for a URL without fetching the page again:

```bash
watchdiff diff https://example.com
watchdiff diff https://example.com --target .price
watchdiff diff https://example.com --json
```

### `history` - snapshot history

```bash
watchdiff history https://example.com --limit 10
```

### `reports` - diff reports

```bash
watchdiff reports https://example.com --limit 20
```

### `export` - export to CSV / XLSX / JSON

```bash
# Print reports as CSV to stdout
watchdiff export https://example.com

# Write reports to a file
watchdiff export https://example.com --output reports.csv

# Export snapshots instead
watchdiff export https://example.com --type snapshots --output snapshots.csv

# Export as XLSX (requires: npm install exceljs)
watchdiff export https://example.com --format xlsx --output reports.xlsx

# Export as JSON
watchdiff export https://example.com --format json
watchdiff export https://example.com --format json --output reports.json
watchdiff export https://example.com --type snapshots --format json --output snapshots.json

# Limit the number of exported entries
watchdiff export https://example.com --limit 500 --output reports.csv
```

### `snapshot` - print the latest stored snapshot

Print the most recently captured snapshot for a URL without fetching the page again.

```bash
watchdiff snapshot https://example.com
watchdiff snapshot https://example.com --target .price
watchdiff snapshot https://example.com --storage .mydata
watchdiff snapshot https://example.com --json   # output raw JSON
```

Output includes `capturedAt`, `checksum`, and a 500-character content preview. Use `--json` for the full content.

### `clean` - delete orphan snapshot files

Remove snapshot and report files from storage that are no longer tied to any configured URL. This is useful after removing a watcher from your config file.

```bash
watchdiff clean                          # uses watchdiff.config.json
watchdiff clean --config my.json         # specific config file
watchdiff clean --storage .mydata        # specific storage directory
watchdiff clean --yes                    # skip confirmation prompt
```

`clean` reads the config file, computes the expected file hashes for all configured URLs, then deletes any `snap_*.json` and `report_*.json` files in the storage directory whose hash does not match a known URL. It prints a list of files to be deleted and asks for confirmation unless `--yes` is passed.

### `pause` / `resume` - suspend and restart a watcher

Signal a running `watchdiff` process to pause or resume a specific watcher. These commands print a reminder to use the programmatic API (`wd.pause()` / `wd.resume()`) since CLI-to-process IPC is not built-in.

```bash
watchdiff pause https://example.com
watchdiff resume my-watcher-id
```

For programmatic control within a long-running script:

```typescript
const stop = wd.start();
wd.pause("https://example.com");     // or wd.pause("my-id")
setTimeout(() => wd.resume("https://example.com"), 60_000);
```

### `db` - database monitoring

```bash
# Row diff on a SQLite file (detects inserts, deletes, updates)
watchdiff db sqlite://./app.db products --primary-key id --interval 60

# Ignore a noisy timestamp column
watchdiff db sqlite://./app.db products --primary-key id --ignore-columns updated_at

# PostgreSQL - schema change detection
watchdiff db postgresql://user:pass@localhost/mydb users --diff-mode schema

# MySQL - aggregate threshold (alert when pending order count changes by ≥ 10%)
watchdiff db mysql://user:pass@localhost/shop orders --diff-mode aggregate \
  --query "SELECT COUNT(*) FROM orders WHERE status='pending'" --threshold 10

# Send to a webhook on change
watchdiff db sqlite://./app.db products \
  --webhook https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK

# Suppress update alerts
watchdiff db sqlite://./app.db products --no-update

# Dry-run (fetch and diff, no save or alerts)
watchdiff db sqlite://./app.db products --dry-run

# Output raw JSON on every change
watchdiff db sqlite://./app.db products --json
```

### `init` - generate config file

```bash
watchdiff init                    # creates watchdiff.config.json
watchdiff init --force            # overwrite existing config
```

### `validate` - validate config file

Check a config file for errors before deploying. Exits with code 0 on success, 1 on failure.

```bash
# Validate watchdiff.config.json in the current directory
watchdiff validate

# Validate a specific file
watchdiff validate --config my.json

# Machine-readable JSON output
watchdiff validate --json
```

Checks performed:
- All URLs are valid (start with `http://` or `https://`)
- `interval` is a positive integer
- `schedule` is a valid 5-field cron expression when set
- `diffMode` is one of `line`, `word`, `semantic`, `json`, `rss`
- `jsonPath` starts with `$` when set
- All `webhooks` are valid URLs
- `playwright` is importable when `browser: true` is used

### `clear` - delete stored data

```bash
watchdiff clear https://example.com
watchdiff clear https://example.com --yes   # skip confirmation
```


## AI summaries

Add a natural-language summary to every change alert. WatchDiff sends the diff to your AI provider of choice and attaches the result to `DiffReport.aiSummary`.

### Auto-discovery (recommended)

Set an environment variable - no code change needed:

```bash
# Pick one:
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="AIza..."
```

```typescript
wd.watch("https://shop.example.com/product", {
  target: ".price",
  aiSummary: true,   // provider auto-detected from env
  onChange: (report) => console.log(report.aiSummary),
  // "The product price increased from $29.99 to $39.99 and is now showing limited stock."
});
```

Priority order when multiple keys are set: `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY`.

### Explicit provider

```typescript
aiProvider: { type: "gemini",     apiKey: "...", model: "gemini-3.1-flash-lite" }
aiProvider: { type: "anthropic",  apiKey: "...", model: "claude-haiku-4-5-20251001" }
aiProvider: { type: "openai",     apiKey: "...", model: "gpt-4o-mini" }
```

### OpenAI-compatible providers (Ollama, Mistral, Groq, …)

Any provider that exposes an OpenAI-compatible API works out of the box via `baseUrl`:

```typescript
// Ollama (local)
aiProvider: { type: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3" }

// Mistral
aiProvider: { type: "openai", apiKey: "...", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small" }

// Groq
aiProvider: { type: "openai", apiKey: "...", baseUrl: "https://api.groq.com/openai/v1", model: "llama3-8b-8192" }

// Together AI
aiProvider: { type: "openai", apiKey: "...", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3-8b-chat-hf" }
```

Set `OPENAI_BASE_URL` for auto-discovery to pick up a compatible endpoint automatically.

### Custom function (any provider, any library)

```typescript
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

aiProvider: {
  type: "custom",
  callAi: async (prompt) => {
    const msg = await client.messages.create({
      model: "claude-opus-4-7", max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text : null;
  },
}
```

### Built-in providers

| Provider | `type` | Default model |
|---|---|---|
| Google Gemini | `"gemini"` | `gemini-3.1-flash-lite` |
| Anthropic Claude | `"anthropic"` | `claude-haiku-4-5-20251001` |
| OpenAI / compatible | `"openai"` | `gpt-4o-mini` |
| Any custom function | `"custom"` | - |

### Error handling

AI failures are non-fatal - the watcher keeps running and fires its normal alerts.

| Error kind | What triggers it | Behaviour |
|---|---|---|
| `invalid_key` | 401 / 403 | AI disabled for this watcher for the rest of the session |
| `quota_exceeded` | 429 rate limit | Skips AI this check, retries next interval |
| `model_error` | 400 / unknown model | AI disabled - check your `model` value |
| `network_error` | DNS / timeout | Skips this check, retries next interval |
| `empty_response` | Provider returned no text | Warning logged, watcher continues |

```typescript
import { AiError } from "watchdiff-core";

try {
  const summary = await generateAiSummary(report, provider);
} catch (err) {
  if (err instanceof AiError) {
    console.log(err.kind);         // "quota_exceeded"
    console.log(err.isRetryable);  // true  → retry next check
    console.log(err.isPermanent);  // false → don't disable
    console.log(err.statusCode);   // 429
  }
}
```

### Custom prompt

Override the default summary template with `aiPrompt` - pass a static string or a function that receives the `DiffReport` and returns a prompt string.

```typescript
// Static prompt - replaces the full instruction sent to the AI
wd.watchFile("/tmp/prices.txt", {
  aiSummary: true,
  aiPrompt: "Summarize this change in French in one sentence.",
});

// Dynamic prompt - build the prompt from the diff report
wd.watch("https://example.com/stock", {
  aiSummary: true,
  aiPrompt: (report) =>
    `You are monitoring ${report.url}. ` +
    `Explain in plain English what changed: ` +
    report.changes.map((c) => c.after ?? c.before ?? "").join(", "),
});

// Async function also supported
wd.watch("https://api.example.com/prices", {
  aiSummary: true,
  aiPrompt: async (report) => {
    const context = await fetchProductContext(report.url);
    return `Context: ${context}\n\nSummarize these price changes in 1 sentence: ` +
      report.changes.map((c) => `${c.before} → ${c.after}`).join(", ");
  },
});
```

The prompt is sent as-is to the provider - no variable substitution happens automatically. Use the function form to interpolate any data from the `DiffReport`.

## File monitoring

Watch local files or config files for changes using the same diff pipeline as URL monitoring.

```typescript
wd.watchFile("/etc/nginx/nginx.conf", {
  interval: 30,
  diffMode: "line",
  onChange: (report) => console.log("Config changed:", report.changes),
});

wd.watchFile("/var/log/app.log", {
  interval: 5,
  alertIf: (report) => report.changes.some(c => c.after?.includes("ERROR")),
});
```

## API monitoring

`watchApi()` is a convenience wrapper over `watch()` that defaults to JSON diff mode, tracks response time, and optionally alerts on unexpected HTTP status codes.

```typescript
wd.watchApi("https://api.example.com/v1/prices", {
  interval: 60,
  expectedStatus: 200,
  trackResponseTime: true,
  onChange: (report) => {
    console.log(`Response time: ${report.responseTimeMs}ms`);
    console.log("JSON diff:", report.changes);
  },
});
```

`report.responseTimeMs` is populated on every check when `trackResponseTime: true`.

## SSL certificate monitoring

Alert before a certificate expires or when it is silently replaced (renewal, infrastructure change).

```typescript
wd.watchCert("example.com", {
  warnDaysBeforeExpiry: 30,     // alert when fewer than 30 days remain
  alertOnExpiry: true,           // default true
  alertOnChange: true,           // alert on fingerprint change (cert replaced)
  webhooks: ["https://discord.com/api/webhooks/..."],
  onExpiry: (info) => {
    console.log(`${info.hostname} expires in ${info.daysUntilExpiry} days`);
  },
  onChange: (info) => {
    console.log(`Cert replaced - new expiry ${info.currentValidTo}`);
  },
});

// Check status
console.log(wd.getCertStatuses());
// [{ hostname: "example.com", daysUntilExpiry: 12, isExpiringSoon: true, ... }]
```

Default options: `port: 443`, `interval: 3600` (1h), `warnDaysBeforeExpiry: 30`.

## Condition-based alerts - alertIf

Suppress alerts unless a custom condition is met. `alertIf` is evaluated after diffing and before dispatching webhooks/callbacks - avoids noisy alerts without sacrificing monitoring coverage.

```typescript
// Only alert when the price drops below a threshold
wd.watch("https://shop.example.com/product", {
  target: ".price",
  alertIf: (report) => {
    const priceChange = report.changes.find(c => c.context === ".price");
    if (!priceChange?.after) return false;
    return parseFloat(priceChange.after.replace(/[^0-9.]/g, "")) < 25;
  },
});

// Only alert on critical log lines
wd.watchFile("/var/log/app.log", {
  alertIf: (report) =>
    report.changes.some(c => c.after?.match(/CRITICAL|FATAL/)),
});

// Only alert when a JSON API field exceeds a threshold
wd.watchApi("https://api.example.com/stats", {
  alertIf: (report) => {
    const change = report.changes.find(c => c.context === "errorRate");
    return Number(change?.after ?? 0) > 5;
  },
});
```

## Cron scheduling

Use a 5-field cron expression instead of a fixed interval. The watcher fires at each matching time instead of every N seconds.

```typescript
// Every day at 9am
wd.watch("https://example.com/prices", {
  schedule: "0 9 * * *",
  onChange: (report) => console.log("Morning price check:", report.changes),
});

// Every Monday and Friday at 8:30am
wd.watch("https://example.com/report", {
  schedule: "30 8 * * 1,5",
});

// Every 15 minutes during business hours (Mon-Fri, 9am-6pm)
wd.watch("https://api.example.com/stock", {
  schedule: "*/15 9-18 * * 1-5",
});
```

Supported syntax: `*`, specific values, lists (`1,3,5`), ranges (`1-5`), and steps (`*/5`, `1-5/2`). When `schedule` is set, `interval` is ignored.

## Flapping detection

Re-verify a change before firing alerts. If the content reverts within `confirmAfter` seconds, the alert is suppressed.

```typescript
wd.watch("https://example.com/status", {
  confirmAfter: 30,  // wait 30s then re-check before alerting
  onChange: (report) => console.log("Confirmed change:", report.changes),
});
```

Useful for pages with transient content (A/B tests, live scores, dashboards) where a single-check spike should not trigger an alert.

## Sitemap monitoring

Watch a `sitemap.xml` for added or removed URLs. Handles sitemap index files automatically.

```typescript
wd.watchSitemap("https://example.com/sitemap.xml", {
  interval: 3600,
  onAdded:   (entries) => console.log("New URLs:", entries.map(e => e.url)),
  onRemoved: (entries) => console.log("Removed URLs:", entries.map(e => e.url)),
  onChange:  (report)  => console.log(`${report.added.length} added, ${report.removed.length} removed`),
});

console.log(wd.getSitemapStatuses());
```

## JSON path targeting

Extract a specific value from a JSON response before diffing. Only the targeted field is compared.

```typescript
// Only watch the "price" field, ignore all other fields
wd.watchApi("https://api.example.com/product/42", {
  jsonPath: "$.data.price",
  onChange: (report) => console.log("Price changed:", report.changes),
});

// Nested path with array index
wd.watchApi("https://api.example.com/leaderboard", {
  jsonPath: "$.entries[0].score",
});
```

## Cookie-based authentication

Pass cookies with every request to monitor pages that require a login session. Cookies are merged into the outgoing `Cookie` header on top of any `headers` you supply.

```typescript
wd.watch("https://app.example.com/dashboard", {
  cookies: {
    session:   "your-session-token",
    csrftoken: "your-csrf-token",
  },
  interval: 300,
  onChange: (report) => console.log(report.changes),
});
```

You can combine `cookies` with `headers` — the cookie string is appended to any existing `Cookie` header:

```typescript
wd.watch("https://api.example.com/account", {
  headers: { Authorization: "Bearer token123" },
  cookies: { _ga: "GA1.1.0000000000.0000000000" },
  jsonPath: "$.balance",
  interval: 60,
});
```

> Tip: copy cookie values from your browser's DevTools → Network tab → Request Headers.

## Email alerts

Send email notifications via SMTP when a change is detected. Requires `nodemailer` (`npm install nodemailer`).

```typescript
wd.watch("https://example.com/prices", {
  alert: {
    onChange: [],
    webhooks: [],
    minChanges: 1,
    email: {
      to: "alerts@example.com",
      smtp: {
        host: "smtp.gmail.com",
        port: 465,
        user: "you@gmail.com",
        pass: "app-password",
      },
    },
  },
});
```

Optional fields: `from` (defaults to `user@host`), `subject` (defaults to `"[WatchDiff] Change detected: {label}"`). Multiple recipients: `to: ["a@x.com", "b@x.com"]`.

## onRecovery callback

Called once when a watcher returns to normal operation after a consecutive-failure streak. Use it to send a "back online" notification or reset an external status flag.

```typescript
wd.watch("https://example.com", {
  failurePolicy: { consecutiveFailures: 3, recoveryChecks: 2 },
  onError:    (err) => console.error("Still failing:", err.message),
  onRecovery: (config) => {
    console.log(`${config.label} is back online.`);
    sendSlackMessage(`${config.label} recovered.`);
  },
});
```

`onRecovery` fires after `recoveryChecks` consecutive successful fetches have cleared the failure state (default: 1 success).

## maxRetryDelay

Cap the maximum time WatchDiff waits between fetch retry attempts. Without this, exponential backoff can grow to hours for many retries. Set `maxRetryDelay` to keep intervals predictable.

```typescript
wd.watch("https://example.com", {
  retries:       10,
  retryDelay:    1000,   // 1s base
  maxRetryDelay: 30_000, // never wait more than 30s between retries
});
```

Delay formula: `Math.min(retryDelay * 2 ^ attempt, maxRetryDelay)`.

## alertOnFirstCheck

By default, WatchDiff silently captures the first snapshot and starts alerting on subsequent changes. Set `alertOnFirstCheck: true` to fire `onChange` (and webhooks) immediately on the very first capture — useful for sanity-checking that your selectors and callbacks work, or for loading an initial state into a downstream system.

```typescript
wd.watch("https://example.com/prices", {
  target:            ".price",
  alertOnFirstCheck: true,
  onChange: (report) => {
    // Fired on first capture: all content is "added"
    console.log("Initial state:", report.changes.length, "items");
  },
});
```

The synthetic first-check report has an empty `before` snapshot and all content marked as `added`. It goes through the same alert pipeline (callbacks, webhooks) as any subsequent change report.

## webhookHeaders

Merge custom HTTP headers into every outgoing webhook POST. Use this for authentication tokens, API keys, or routing headers required by your webhook endpoint.

```typescript
wd.watch("https://example.com", {
  webhooks: ["https://internal.example.com/hooks/watchdiff"],
  webhookHeaders: {
    Authorization: "Bearer my-internal-token",
    "X-Source":    "watchdiff",
  },
});
```

Headers are merged after the built-in `Content-Type: application/json` header, so you can override it if needed. `webhookHeaders` does not affect the Slack/Discord/Telegram payload format — only the HTTP request headers.

## Slack Block Kit

When the webhook URL matches `hooks.slack.com`, WatchDiff sends a structured Block Kit payload instead of a plain text message. The payload includes a header block, a change-summary section, and a context block with URL and timestamp.

```json
{
  "blocks": [
    { "type": "header",  "text": { "type": "plain_text", "text": "[Book price] Change detected" } },
    { "type": "section", "text": { "type": "mrkdwn",     "text": "• 1 modified" } },
    { "type": "context", "elements": [{ "type": "mrkdwn", "text": "https://books.toscrape.com · 2026-09-18 09:00:00 UTC" }] }
  ]
}
```

No configuration is needed — the Block Kit format is applied automatically for Slack webhooks. Combine with `webhookHeaders` to add an `Authorization` header when using Slack's app-level tokens.

## retentionDays

Automatically delete snapshots older than N days after each save. Use it to cap disk usage without manually managing storage.

```typescript
wd.watch("https://example.com", {
  retentionDays: 30,   // keep only snapshots from the last 30 days
  maxSnapshots:  500,  // also limit by count (both can be combined)
});
```

Retention is applied after every snapshot save, before the check result is returned. Snapshots older than `Date.now() - retentionDays * 86400000` ms are removed. Reports are not affected.

## JSON export

Export monitoring history as a formatted JSON string for use with log aggregators, dashboards, or custom tooling.

**API:**

```typescript
// Reports (array of change entries)
const json = wd.exportReportsJson("https://example.com", 100);
fs.writeFileSync("reports.json", json);

// Snapshots (array of captured content)
const snapJson = wd.exportSnapshotsJson("https://example.com", 50);
```

**CLI:**

```bash
# Print JSON to stdout
watchdiff export https://example.com --format json

# Export snapshots as JSON to a file
watchdiff export https://example.com --type snapshots --format json --output snapshots.json

# Limit entries
watchdiff export https://example.com --format json --limit 50 --output reports.json
```

## Advanced usage

### Use individual pipeline stages

All internal modules are exported and fully typed:

```typescript
import {
  Fetcher, BrowserFetcher, Cleaner, Parser, DiffEngine,
  Store, SqliteStore, Exporter, Notifier,
  makeWatchConfig, reportSummary, isXPath,
} from "watchdiff-core";

const config   = makeWatchConfig("https://example.com", {
  target: ".price",
  diffMode: "semantic",
  retries: 2,
});
const fetcher  = config.browser ? new BrowserFetcher() : new Fetcher();
const html     = await fetcher.fetch(config);
const $        = new Cleaner().clean(html);
const snapshot = new Parser().extract($, config);

const store    = new Store(".watchdiff");
const previous = store.loadLatest(config.url, config.target);
if (previous) {
  const report = new DiffEngine().compare(previous, snapshot, config);
  console.log(reportSummary(report));
}
store.saveSnapshot(snapshot);
```

### Use DB pipeline stages directly

All DB modules are exported and fully typed:

```typescript
import {
  DbFetcher, DbDiffEngine,
  makeDbWatchConfig, makeDbSnapshot,
  dbHasChanges, dbReportSummary,
} from "watchdiff-core";
import { Store } from "watchdiff-core";

const config = makeDbWatchConfig("sqlite://./app.db", "products", {
  primaryKey:    ["id"],
  ignoreColumns: ["updated_at"],
  diffMode:      "row",
});

const fetcher = new DbFetcher();
const engine  = new DbDiffEngine();
const store   = new Store(".watchdiff");

// Fetch current rows
const result  = await fetcher.fetch(config);
const current = makeDbSnapshot(config.connectionString, config.table, result.rows, result.schema);

// Load previous snapshot from store
const storeKey = `db::${config.table}`;
const stored   = store.loadLatest(storeKey, undefined);

if (stored) {
  const previous = makeDbSnapshot(
    config.connectionString,
    config.table,
    JSON.parse(stored.content).rows
  );
  const report = engine.compare(previous, current, config);
  if (dbHasChanges(report)) {
    console.log(dbReportSummary(report));
    for (const c of report.changes) {
      console.log(c.kind, c.rowKey, c.modifications ?? c.row);
    }
  }
}

// Persist snapshot
store.saveSnapshot({
  url: storeKey, target: undefined,
  content: JSON.stringify({ rows: current.rows }),
  rawHtml: "", capturedAt: current.capturedAt, checksum: current.checksum,
});
```


### Custom store implementation

Implement `IStore` to use your own storage backend:

```typescript
import type { IStore, Snapshot, DiffReport } from "watchdiff-core";
import { WatchDiff } from "watchdiff-core";

class RedisStore implements IStore {
  saveSnapshot(snap: Snapshot) { /* ... */ }
  loadLatest(url: string, target: string | undefined) { return null; }
  loadHistory(url: string, target: string | undefined, limit?: number) { return []; }
  clearHistory(url: string, target: string | undefined) { /* ... */ }
  saveReport(report: DiffReport) { /* ... */ }
  loadReports(url: string, target: string | undefined, limit?: number) { return []; }
  // Optional - implement for maxSnapshots support
  pruneSnapshots(url: string, target: string | undefined, max: number) { /* ... */ }
}

const wd = new WatchDiff(undefined, new RedisStore());
wd.watch("https://example.com");
wd.start();
```

### Integrate with a server shutdown hook

```typescript
const wd   = new WatchDiff();
const stop = wd.watch("https://example.com").start();

server.on("close", stop);
```

### XPath targeting with namespace awareness

```typescript
wd.watch("https://rss.example.com/feed.xml", {
  target:  "//item/title",
  label:   "RSS feed titles",
  headers: { Accept: "application/rss+xml" },
});
```

### Production-ready config

```typescript
const wd = new WatchDiff(undefined, new SqliteStore(".watchdiff.db"));

wd.watch("https://shop.example.com/product/42", {
  target:               ".price",
  label:                "Product 42 price",
  interval:             120,
  jitter:               0.15,
  retries:              3,
  retryDelay:           2000,
  cooldown:             1800,
  maxSnapshots:         200,
  changeThreshold:      0.01,
  diffMode:             "word",
  alertIfNoChangeAfter: 604800,  // 1 week silence = page may be broken
  webhooks: [
    "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
    "https://ntfy.sh/my-price-monitor",
  ],
  onError: (err, config) => logger.error({ url: config.url, err: err.message }),
  onSilence: ({ label, secondsSinceLastChange }) => {
    logger.warn(`${label} has not changed in ${Math.floor(secondsSinceLastChange / 86400)} days`);
  },
});

wd.start();
```


## Optional dependencies

| Feature | Package to install |
|---|---|
| JS-heavy pages / screenshots | `npm install playwright && npx playwright install chromium` |
| SQLite storage | `npm install better-sqlite3` |
| SQLite monitoring (`watchDb`) | `npm install better-sqlite3` |
| PostgreSQL monitoring (`watchDb`) | `npm install pg` |
| MySQL / MariaDB monitoring (`watchDb`) | `npm install mysql2` |
| XLSX export | `npm install exceljs` |
| Email alerts (SMTP) | `npm install nodemailer` |
| Proxy rotation (native fetch) | bundled via `undici` (no extra install) |
| RSS/Atom diff | bundled via `@xmldom/xmldom` (no extra install) |
| Status server / Prometheus metrics | built-in Node.js `http` (no extra install) |

## Development

```bash
npm install
npm run build     # compile TypeScript to dist/
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Requirements

- **Node.js 18+** - uses native `fetch` and `AbortSignal.timeout`
- TypeScript 4.7+ (for consumers using the bundled types)

## Contributing

Missing a feature? Found a bug? Pull requests are welcome on [GitHub](https://github.com/watchdiff-labs/watchdiff-ts).

If you want a feature that is not yet in the project, open an issue or submit a PR directly - contributions of any size are appreciated.

## Security

WatchDiff v0.3.0 was audited and hardened against the following categories:

| Category | Mitigation |
|---|---|
| **SSRF** | All `watch()` URLs and webhook destinations are validated against loopback, link-local (`169.254.x.x`), and private ranges. Use `allowPrivateUrls: true` to monitor internal services. |
| **Unbounded response** | `maxResponseSize` (default 10 MB) is enforced via streaming; the reader is cancelled and an error is thrown if the limit is exceeded. |
| **Redirect hijack** | Redirects are followed manually with a 10-hop cap; each target URL is SSRF-validated. |
| **SQL injection** | Custom `query` strings in DB watchers are validated as `SELECT`-only with no multi-statement support before execution. |
| **Cookie header injection** | Cookie names and values are `encodeURIComponent`-encoded before being placed in the `Cookie` header. |
| **Credential exposure in logs** | Telegram bot tokens and Basic Auth credentials are redacted before any `console.warn`/`console.error` output. |
| **Status server exposure** | `startStatusServer()` binds to `127.0.0.1` by default. Pass a second argument to change the bind address. |
| **Storage key collision** | Storage keys are derived from SHA-256 (previously MD5). |
| **Path traversal (CLI)** | The `--output` path in `watchdiff export` is resolved and checked to be within the current working directory. |

> **Note on SSL cert monitoring:** `watchCert()` intentionally uses `rejectUnauthorized: false` to inspect expired or invalid certificates. Hostname verification is still performed to detect certificate substitution.

## License

This project is licensed under the [BSD 3-Clause License](LICENSE).

You are free to use, modify, and distribute this software in source and binary forms, with or without modification, provided the copyright notice and disclaimer are retained. No copyleft restrictions - compatible with MIT and proprietary projects.
