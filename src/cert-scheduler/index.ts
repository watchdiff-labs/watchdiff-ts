import { fetchCert } from "../cert-fetcher/index.js";
import {
    type CertExpiryInfo,
    type CertChangeInfo,
    type CertReport,
    type CertSnapshot,
    type CertWatchConfig,
    type CertWatcherStatus,
} from "../cert-models.js";
import { Notifier } from "../notifier/index.js";

interface CertState {
    lastCheckAt:     Date | null;
    nextCheckAt:     Date | null;
    lastChangeAt:    Date | null;
    checksCount:     number;
    changesCount:    number;
    errorsCount:     number;
    paused:          boolean;
    lastAlertAt:     number;
    lastSnapshot:    CertSnapshot | null;
    daysUntilExpiry: number | null;
    validTo:         Date | null;
}

export class CertScheduler {
    private readonly notifier                                     = new Notifier();
    private readonly states                                       = new Map<string, CertState>();
    private readonly timers: ReturnType<typeof setInterval>[]    = [];

    private key(config: CertWatchConfig): string {
        return `${config.hostname}:${config.port}`;
    }

    private makeEmptyState(): CertState {
        return {
            lastCheckAt:     null,
            nextCheckAt:     null,
            lastChangeAt:    null,
            checksCount:     0,
            changesCount:    0,
            errorsCount:     0,
            paused:          false,
            lastAlertAt:     0,
            lastSnapshot:    null,
            daysUntilExpiry: null,
            validTo:         null,
        };
    }

    private getState(config: CertWatchConfig): CertState {
        const k = this.key(config);
        if (!this.states.has(k)) this.states.set(k, this.makeEmptyState());
        return this.states.get(k)!;
    }

    start(configs: CertWatchConfig[]): () => void {
        for (const config of configs) {
            console.info(`[watchdiff] Starting cert watcher for ${config.label} (interval=${config.interval}s)`);
            void this.check(config);
            const timer = setInterval(() => {
                if (!this.getState(config).paused) void this.check(config);
            }, config.interval * 1000);
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

    getStatuses(configs: CertWatchConfig[]): CertWatcherStatus[] {
        return configs.map((config) => {
            const s = this.getState(config);
            return {
                hostname:        config.hostname,
                label:           config.label,
                port:            config.port,
                interval:        config.interval,
                paused:          s.paused,
                lastCheckAt:     s.lastCheckAt,
                nextCheckAt:     s.nextCheckAt,
                lastChangeAt:    s.lastChangeAt,
                checksCount:     s.checksCount,
                changesCount:    s.changesCount,
                errorsCount:     s.errorsCount,
                daysUntilExpiry: s.daysUntilExpiry,
                validTo:         s.validTo,
                isExpiringSoon:  s.daysUntilExpiry !== null &&
                                 s.daysUntilExpiry <= config.warnDaysBeforeExpiry,
            };
        });
    }

    private async check(config: CertWatchConfig): Promise<CertReport | null> {
        const state = this.getState(config);
        const now   = Date.now();
        state.checksCount++;
        state.nextCheckAt = new Date(now + config.interval * 1000);

        let snapshot: CertSnapshot;
        try {
            snapshot = await fetchCert(config);
        } catch (err) {
            state.errorsCount++;
            state.lastCheckAt = new Date();
            const error = err instanceof Error ? err : new Error(String(err));
            if (config.onError) {
                try { config.onError(error, config); } catch (cbErr) {
                    console.error(`[${config.label}] onError callback threw:`, cbErr);
                }
            } else {
                console.error(`[${config.label}] Cert fetch failed:`, error.message);
            }
            return null;
        }

        state.lastCheckAt     = new Date();
        state.daysUntilExpiry = snapshot.daysUntilExpiry;
        state.validTo         = snapshot.validTo;

        const previous         = state.lastSnapshot;
        const isExpired        = snapshot.daysUntilExpiry < 0;
        const isExpiringSoon   = !isExpired && snapshot.daysUntilExpiry <= config.warnDaysBeforeExpiry;
        const fingerprintChanged = !!(previous && previous.fingerprint !== snapshot.fingerprint);

        const report: CertReport = {
            hostname: config.hostname,
            label:    config.label,
            snapshot,
            previous:           previous ?? undefined,
            daysUntilExpiry:    snapshot.daysUntilExpiry,
            isExpired,
            isExpiringSoon,
            fingerprintChanged,
            comparedAt: new Date(),
        };

        state.lastSnapshot = snapshot;

        if (!previous) {
            console.info(
                `[${config.label}] Cert captured - expires in ${snapshot.daysUntilExpiry}d (${snapshot.validTo.toISOString().slice(0, 10)})`,
            );
            return report;
        }

        const cooldownMs    = (config.cooldown ?? 0) * 1000;
        const cooldownReady = now - state.lastAlertAt >= cooldownMs;

        // Alert: fingerprint changed (cert renewed / replaced)
        if (fingerprintChanged && config.alertOnChange !== false && cooldownReady && !config.dryRun) {
            state.changesCount++;
            state.lastChangeAt = new Date();
            state.lastAlertAt  = now;

            const info: CertChangeInfo = {
                hostname:            config.hostname,
                label:               config.label,
                previousFingerprint: previous.fingerprint,
                currentFingerprint:  snapshot.fingerprint,
                previousValidTo:     previous.validTo,
                currentValidTo:      snapshot.validTo,
            };
            console.info(`[${config.label}] Certificate replaced - new expiry ${snapshot.validTo.toISOString().slice(0, 10)}`);
            if (config.onChange) {
                try { await config.onChange(info); } catch (err) {
                    console.warn("[watchdiff] onChange callback error:", err);
                }
            }
            await this.dispatchWebhook(config, `Certificate replaced for ${config.hostname}. New expiry: ${snapshot.validTo.toISOString().slice(0, 10)}`);
        }

        // Alert: expiring soon / expired
        if ((isExpiringSoon || isExpired) && config.alertOnExpiry !== false && cooldownReady && !config.dryRun) {
            if (!fingerprintChanged) {
                state.lastAlertAt = now;
            }
            const info: CertExpiryInfo = {
                hostname:        config.hostname,
                label:           config.label,
                daysUntilExpiry: snapshot.daysUntilExpiry,
                validTo:         snapshot.validTo,
                isExpired,
            };
            const msg = isExpired
                ? `[${config.label}] Certificate EXPIRED (${snapshot.hostname})`
                : `[${config.label}] Certificate expires in ${snapshot.daysUntilExpiry} day(s) - ${snapshot.validTo.toISOString().slice(0, 10)}`;
            console.warn(msg);
            if (config.onExpiry) {
                try { await config.onExpiry(info); } catch (err) {
                    console.warn("[watchdiff] onExpiry callback error:", err);
                }
            }
            await this.dispatchWebhook(config, msg);
        }

        return report;
    }

    private async dispatchWebhook(config: CertWatchConfig, text: string): Promise<void> {
        if (!config.webhooks?.length) return;
        const fakeReport = {
            url:        `https://${config.hostname}`,
            target:     undefined,
            label:      config.label,
            changes:    [{ kind: "modified" as const, context: "ssl_cert", before: "", after: text }],
            comparedAt: new Date(),
            before:     { url: `https://${config.hostname}`, target: undefined, content: "", rawHtml: "", capturedAt: new Date(), checksum: "" },
            after:      { url: `https://${config.hostname}`, target: undefined, content: "", rawHtml: "", capturedAt: new Date(), checksum: "" },
        };
        await this.notifier.notify(fakeReport, {
            onChange:       [],
            webhooks:       config.webhooks,
            minChanges:     1,
            webhookRetries: config.webhookRetries,
        });
    }
}
