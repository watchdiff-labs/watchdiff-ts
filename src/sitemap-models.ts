import { createHash } from "node:crypto";

export interface SitemapEntry {
    url:         string;
    lastmod?:    string;
    priority?:   number;
    changefreq?: string;
}

export interface SitemapSnapshot {
    url:         string;
    entries:     SitemapEntry[];
    capturedAt:  Date;
    checksum:    string;
}

export interface SitemapDiffReport {
    url:        string;
    label:      string;
    added:      SitemapEntry[];
    removed:    SitemapEntry[];
    comparedAt: Date;
}

export interface SitemapWatchConfig {
    url:        string;
    label:      string;
    interval:   number;
    onAdded?:   (entries: SitemapEntry[]) => void;
    onRemoved?: (entries: SitemapEntry[]) => void;
    onChange?:  (report: SitemapDiffReport) => void;
    onError?:   (err: Error) => void;
}

export function sitemapHasChanges(r: SitemapDiffReport): boolean {
    return r.added.length > 0 || r.removed.length > 0;
}

export function makeSitemapSnapshot(url: string, entries: SitemapEntry[]): SitemapSnapshot {
    const checksum = createHash("sha256")
        .update(JSON.stringify(entries.map((e) => e.url).sort()))
        .digest("hex");
    return { url, entries, capturedAt: new Date(), checksum };
}
