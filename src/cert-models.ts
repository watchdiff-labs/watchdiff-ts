// ---------------------------------------------------------------------------
// Certificate monitoring models
// ---------------------------------------------------------------------------

export interface CertWatchConfig {
    hostname:             string;
    port:                 number;
    label:                string;
    interval:             number;
    /** Alert when fewer than this many days remain before expiry (default 30). */
    warnDaysBeforeExpiry: number;
    /** Fire alerting when the cert is about to expire (default true). */
    alertOnExpiry?:       boolean;
    /** Fire alerting when the cert fingerprint changes (e.g. renewal, replacement). */
    alertOnChange?:       boolean;
    cooldown?:            number;
    dryRun?:              boolean;
    webhooks?:            string[];
    webhookRetries?:      number;
    onExpiry?:            (info: CertExpiryInfo)  => void | Promise<void>;
    onChange?:            (info: CertChangeInfo)  => void | Promise<void>;
    onError?:             (err: Error, config: CertWatchConfig) => void;
}

export function makeCertWatchConfig(
    hostname: string,
    opts: Partial<Omit<CertWatchConfig, "hostname">> = {},
): CertWatchConfig {
    return {
        hostname,
        port:                 opts.port                 ?? 443,
        label:                opts.label                ?? hostname,
        interval:             opts.interval             ?? 3600,
        warnDaysBeforeExpiry: opts.warnDaysBeforeExpiry ?? 30,
        alertOnExpiry:        opts.alertOnExpiry        ?? true,
        alertOnChange:        opts.alertOnChange        ?? true,
        cooldown:             opts.cooldown,
        dryRun:               opts.dryRun,
        webhooks:             opts.webhooks,
        webhookRetries:       opts.webhookRetries,
        onExpiry:             opts.onExpiry,
        onChange:             opts.onChange,
        onError:              opts.onError,
    };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface CertSnapshot {
    hostname:        string;
    port:            number;
    validFrom:       Date;
    validTo:         Date;
    daysUntilExpiry: number;
    issuer:          string;
    subject:         string;
    fingerprint:     string;
    capturedAt:      Date;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface CertReport {
    hostname:           string;
    label:              string;
    snapshot:           CertSnapshot;
    previous?:          CertSnapshot;
    daysUntilExpiry:    number;
    isExpired:          boolean;
    isExpiringSoon:     boolean;
    fingerprintChanged: boolean;
    comparedAt:         Date;
}

// ---------------------------------------------------------------------------
// Callback info types
// ---------------------------------------------------------------------------

export interface CertExpiryInfo {
    hostname:        string;
    label:           string;
    daysUntilExpiry: number;
    validTo:         Date;
    isExpired:       boolean;
}

export interface CertChangeInfo {
    hostname:            string;
    label:               string;
    previousFingerprint: string;
    currentFingerprint:  string;
    previousValidTo:     Date;
    currentValidTo:      Date;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface CertWatcherStatus {
    hostname:        string;
    label:           string;
    port:            number;
    interval:        number;
    paused:          boolean;
    lastCheckAt:     Date | null;
    nextCheckAt:     Date | null;
    lastChangeAt:    Date | null;
    checksCount:     number;
    changesCount:    number;
    errorsCount:     number;
    daysUntilExpiry: number | null;
    validTo:         Date | null;
    isExpiringSoon:  boolean;
}
