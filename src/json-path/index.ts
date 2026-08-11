/**
 * Minimal JSON path extractor.
 * Supports: $ root, .key property access, [n] array index, nested combinations.
 * Returns the raw JSON string of the extracted value.
 */

function tokenizePath(path: string): string[] {
    // Strip optional leading "$"
    const normalized = path.startsWith("$") ? path.slice(1) : path;
    const tokens: string[] = [];
    let remaining = normalized;

    while (remaining.length > 0) {
        if (remaining.startsWith(".")) {
            remaining = remaining.slice(1);
            // Read up to next "." or "["
            const end = remaining.search(/[.\[]/);
            if (end === -1) {
                tokens.push(remaining);
                remaining = "";
            } else {
                tokens.push(remaining.slice(0, end));
                remaining = remaining.slice(end);
            }
        } else if (remaining.startsWith("[")) {
            const close = remaining.indexOf("]");
            if (close === -1) {
                throw new Error(`JSON path: unclosed bracket in ${JSON.stringify(path)}`);
            }
            tokens.push(remaining.slice(1, close));
            remaining = remaining.slice(close + 1);
        } else {
            // bare segment without leading dot (e.g. "data.items[2]")
            const end = remaining.search(/[.\[]/);
            if (end === -1) {
                tokens.push(remaining);
                remaining = "";
            } else {
                tokens.push(remaining.slice(0, end));
                remaining = remaining.slice(end);
            }
        }
    }

    return tokens.filter((t) => t.length > 0);
}

/**
 * Extract the value at `path` from a JSON string.
 * Returns the raw JSON serialization of the found value.
 * Throws if the path cannot be resolved.
 */
export function extractJsonPath(json: string, path: string): string {
    let current: unknown;
    try {
        current = JSON.parse(json);
    } catch {
        throw new Error(`JSON path: input is not valid JSON`);
    }

    const tokens = tokenizePath(path);

    for (const token of tokens) {
        if (current === null || current === undefined) {
            throw new Error(`JSON path: cannot access "${token}" on null/undefined`);
        }

        if (Array.isArray(current)) {
            const idx = parseInt(token, 10);
            if (isNaN(idx)) {
                throw new Error(`JSON path: expected array index, got "${token}"`);
            }
            if (idx < 0 || idx >= current.length) {
                throw new Error(`JSON path: array index ${idx} out of bounds (length ${current.length})`);
            }
            current = current[idx];
        } else if (typeof current === "object") {
            const obj = current as Record<string, unknown>;
            if (!(token in obj)) {
                throw new Error(`JSON path: key "${token}" not found`);
            }
            current = obj[token];
        } else {
            throw new Error(`JSON path: cannot access "${token}" on ${typeof current}`);
        }
    }

    return JSON.stringify(current);
}
