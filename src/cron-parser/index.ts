/**
 * Minimal 5-field cron parser.
 * Fields: minute hour day month weekday
 * Supports: wildcard, specific values, lists (1,3,5), ranges (1-5), steps (every-5, 1-5/2)
 */

interface CronFields {
    minute:   number[];
    hour:     number[];
    day:      number[];
    month:    number[];
    weekday:  number[];
}

function parseField(field: string, min: number, max: number): number[] {
    if (field === "*") {
        return range(min, max);
    }

    const result: number[] = [];
    for (const part of field.split(",")) {
        const stepIdx   = part.indexOf("/");
        const step      = stepIdx !== -1 ? parseInt(part.slice(stepIdx + 1), 10) : 1;
        const rangePart = stepIdx !== -1 ? part.slice(0, stepIdx) : part;

        if (rangePart === "*") {
            for (let v = min; v <= max; v += step) result.push(v);
        } else if (rangePart.includes("-")) {
            const parts2 = rangePart.split("-");
            const lo     = parseInt(parts2[0]!, 10);
            const hi     = parseInt(parts2[1]!, 10);
            for (let v = lo; v <= hi; v += step) result.push(v);
        } else {
            const v = parseInt(rangePart, 10);
            result.push(v);
        }
    }

    return [...new Set(result)].sort((a, b) => a - b);
}

function range(lo: number, hi: number): number[] {
    const out: number[] = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
}

function parseCron(expr: string): CronFields {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression (expected 5 fields): ${JSON.stringify(expr)}`);
    }
    return {
        minute:  parseField(parts[0]!, 0, 59),
        hour:    parseField(parts[1]!, 0, 23),
        day:     parseField(parts[2]!, 1, 31),
        month:   parseField(parts[3]!, 1, 12),
        weekday: parseField(parts[4]!, 0, 6),
    };
}

/** Returns the next Date matching the cron expression, after `from` (default: now). */
export function nextCronRun(expr: string, from?: Date): Date {
    const fields = parseCron(expr);

    // Start one minute ahead of `from` so we never return the same minute.
    const start = new Date(from ?? new Date());
    start.setSeconds(0, 0);
    start.setMinutes(start.getMinutes() + 1);

    // Advance up to 4 years to find a match (covers all valid cron schedules).
    const limit = new Date(start);
    limit.setFullYear(limit.getFullYear() + 4);

    const candidate = new Date(start);

    while (candidate < limit) {
        // Month is 1-based in cron, getMonth() is 0-based.
        if (!fields.month.includes(candidate.getMonth() + 1)) {
            candidate.setMonth(candidate.getMonth() + 1, 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }

        if (!fields.day.includes(candidate.getDate()) &&
            !fields.weekday.includes(candidate.getDay())) {
            candidate.setDate(candidate.getDate() + 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }

        if (!fields.hour.includes(candidate.getHours())) {
            candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
            continue;
        }

        if (!fields.minute.includes(candidate.getMinutes())) {
            candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
            continue;
        }

        return new Date(candidate);
    }

    throw new Error(`No matching cron run found within 4 years for expression: ${JSON.stringify(expr)}`);
}
