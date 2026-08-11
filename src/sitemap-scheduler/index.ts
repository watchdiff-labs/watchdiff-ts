import { fetchSitemap } from "../sitemap-fetcher/index.js";
import {
    makeSitemapSnapshot,
    sitemapHasChanges,
    type SitemapDiffReport,
    type SitemapEntry,
    type SitemapSnapshot,
    type SitemapWatchConfig,
} from "../sitemap-models.js";

interface SitemapState {
    lastCheckAt:  Date | null;
    nextCheckAt:  Date | null;
    lastChangeAt: Date | null;
    checksCount:  number;
    changesCount: number;
    errorsCount:  number;
    snapshot:     SitemapSnapshot | null;
}

export interface SitemapWatcherStatus {
    url:          string;
    label:        string;
    interval:     number;
    lastCheckAt:  Date | null;
    nextCheckAt:  Date | null;
    lastChangeAt: Date | null;
    checksCount:  number;
    changesCount: number;
    errorsCount:  number;
    entryCount:   number | null;
}

export class SitemapScheduler {
    private readonly states = new Map<string, SitemapState>();
    private readonly timers: ReturnType<typeof setInterval>[] = [];

    private makeEmptyState(): SitemapState {
        return {
            lastCheckAt:  null,
            nextCheckAt:  null,
            lastChangeAt: null,
            checksCount:  0,
            changesCount: 0,
            errorsCount:  0,
            snapshot:     null,
        };
    }

    private getState(config: SitemapWatchConfig): SitemapState {
        if (!this.states.has(config.url)) {
            this.states.set(config.url, this.makeEmptyState());
        }
        return this.states.get(config.url)!;
    }

    start(configs: SitemapWatchConfig[]): () => void {
        for (const config of configs) {
            console.info(`[watchdiff] Starting sitemap watcher for ${config.label} (interval=${config.interval}s)`);
            void this.check(config);
            const timer = setInterval(() => void this.check(config), config.interval * 1000);
            if (typeof timer === "object" && "unref" in timer) {
                (timer as NodeJS.Timeout).unref();
            }
            this.timers.push(timer);
        }
        return () => this.stop();
    }

    stop(): void {
        for (const t of this.timers) clearInterval(t);
        this.timers.length = 0;
    }

    getStatuses(configs: SitemapWatchConfig[]): SitemapWatcherStatus[] {
        return configs.map((config) => {
            const s = this.getState(config);
            return {
                url:          config.url,
                label:        config.label,
                interval:     config.interval,
                lastCheckAt:  s.lastCheckAt,
                nextCheckAt:  s.nextCheckAt,
                lastChangeAt: s.lastChangeAt,
                checksCount:  s.checksCount,
                changesCount: s.changesCount,
                errorsCount:  s.errorsCount,
                entryCount:   s.snapshot ? s.snapshot.entries.length : null,
            };
        });
    }

    private async check(config: SitemapWatchConfig): Promise<void> {
        const state = this.getState(config);
        const now   = Date.now();
        state.checksCount++;
        state.nextCheckAt = new Date(now + config.interval * 1000);

        let entries: SitemapEntry[];
        try {
            entries = await fetchSitemap(config.url);
        } catch (err) {
            state.errorsCount++;
            state.lastCheckAt = new Date();
            const error = err instanceof Error ? err : new Error(String(err));
            if (config.onError) {
                try { config.onError(error); } catch (cbErr) {
                    console.error(`[${config.label}] onError callback threw:`, cbErr);
                }
            } else {
                console.error(`[${config.label}] Sitemap fetch failed:`, error.message);
            }
            return;
        }

        state.lastCheckAt = new Date();
        const snapshot    = makeSitemapSnapshot(config.url, entries);

        if (!state.snapshot) {
            state.snapshot = snapshot;
            console.info(`[${config.label}] First sitemap captured (${entries.length} entries).`);
            return;
        }

        const previous = state.snapshot;
        state.snapshot = snapshot;

        const prevUrls = new Set(previous.entries.map((e) => e.url));
        const currUrls = new Set(entries.map((e) => e.url));

        const added:   SitemapEntry[] = entries.filter((e) => !prevUrls.has(e.url));
        const removed: SitemapEntry[] = previous.entries.filter((e) => !currUrls.has(e.url));

        const report: SitemapDiffReport = {
            url:        config.url,
            label:      config.label,
            added,
            removed,
            comparedAt: new Date(),
        };

        if (!sitemapHasChanges(report)) {
            console.debug(`[${config.label}] Sitemap: no changes.`);
            return;
        }

        state.changesCount++;
        state.lastChangeAt = new Date();

        if (added.length > 0) {
            console.info(`[${config.label}] Sitemap: ${added.length} URL(s) added.`);
            if (config.onAdded) {
                try { config.onAdded(added); } catch (err) {
                    console.warn(`[${config.label}] onAdded callback error:`, err);
                }
            }
        }

        if (removed.length > 0) {
            console.info(`[${config.label}] Sitemap: ${removed.length} URL(s) removed.`);
            if (config.onRemoved) {
                try { config.onRemoved(removed); } catch (err) {
                    console.warn(`[${config.label}] onRemoved callback error:`, err);
                }
            }
        }

        if (config.onChange) {
            try { config.onChange(report); } catch (err) {
                console.warn(`[${config.label}] onChange callback error:`, err);
            }
        }
    }
}
