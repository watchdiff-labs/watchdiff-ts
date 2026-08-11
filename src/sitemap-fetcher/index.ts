import type { SitemapEntry } from "../sitemap-models.js";

async function fetchXml(url: string): Promise<string> {
    const res = await globalThis.fetch(url, {
        headers: { Accept: "application/xml,text/xml,*/*" },
        signal:  AbortSignal.timeout(15_000),
        redirect: "follow",
    });
    if (!res.ok) {
        throw new Error(`Sitemap fetch failed: HTTP ${res.status} for ${url}`);
    }
    return res.text();
}

/** Extract text content of the first matching tag within a block. */
function extractTag(block: string, tag: string): string | undefined {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    const m  = re.exec(block);
    return m?.[1]?.trim();
}

function parseSitemapEntries(xml: string): SitemapEntry[] {
    const entries: SitemapEntry[] = [];
    const urlBlockRe              = /<url>([\s\S]*?)<\/url>/gi;
    let match: RegExpExecArray | null;

    while ((match = urlBlockRe.exec(xml)) !== null) {
        const block      = match[1];
        if (!block) continue;
        const loc        = extractTag(block, "loc");
        if (!loc) continue;

        const lastmod     = extractTag(block, "lastmod");
        const priorityRaw = extractTag(block, "priority");
        const changefreq  = extractTag(block, "changefreq");

        entries.push({
            url:         loc,
            lastmod,
            priority:    priorityRaw !== undefined ? parseFloat(priorityRaw) : undefined,
            changefreq,
        });
    }

    return entries;
}

function isSitemapIndex(xml: string): boolean {
    return /<sitemapindex/i.test(xml);
}

function parseChildUrls(xml: string): string[] {
    const urls: string[] = [];
    const sitemapBlockRe = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
    let match: RegExpExecArray | null;

    while ((match = sitemapBlockRe.exec(xml)) !== null) {
        const block = match[1];
        if (!block) continue;
        const loc = extractTag(block, "loc");
        if (loc) urls.push(loc);
    }

    return urls;
}

export async function fetchSitemap(url: string): Promise<SitemapEntry[]> {
    const xml = await fetchXml(url);

    if (isSitemapIndex(xml)) {
        const childUrls = parseChildUrls(xml);
        const results   = await Promise.allSettled(childUrls.map((u) => fetchSitemap(u)));
        const entries: SitemapEntry[] = [];
        for (const r of results) {
            if (r.status === "fulfilled") entries.push(...r.value);
        }
        return entries;
    }

    return parseSitemapEntries(xml);
}
