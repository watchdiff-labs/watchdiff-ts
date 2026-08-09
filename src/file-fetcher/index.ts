import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export class FileFetcher {
    async fetch(path: string): Promise<{ content: string; sizeBytes: number; modifiedAt: Date }> {
        const absPath  = resolve(path);
        const [content, stats] = await Promise.all([
            readFile(absPath, "utf-8"),
            stat(absPath),
        ]);
        return {
            content,
            sizeBytes:  stats.size,
            modifiedAt: stats.mtime,
        };
    }
}

export function filePathFromUrl(url: string): string {
    return url.replace(/^file:\/\//, "");
}
