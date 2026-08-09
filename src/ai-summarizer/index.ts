import type { DiffReport, WatchConfig } from "../models.js";

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type AiProviderType = "anthropic" | "openai" | "gemini" | "custom";

export interface AiProvider {
    type:     AiProviderType;
    /** API key - not required for "custom". */
    apiKey?:  string;
    /** Model override. Uses provider default when omitted. */
    model?:   string;
    /**
     * Base URL for OpenAI-compatible endpoints.
     * Examples:
     *   Ollama  → "http://localhost:11434/v1"
     *   Mistral → "https://api.mistral.ai/v1"
     *   Groq    → "https://api.groq.com/openai/v1"
     *   Together→ "https://api.together.xyz/v1"
     * Defaults to "https://api.openai.com/v1" when omitted.
     */
    baseUrl?: string;
    /** Custom completion function - use any AI library or local model. */
    callAi?:  (prompt: string) => string | null | Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type AiErrorKind =
    | "invalid_key"       // 401 / 403 - permanent, disable AI for this watcher
    | "quota_exceeded"    // 429 - temporary, retry next interval
    | "model_error"       // 400 - bad request / unknown model
    | "network_error"     // fetch failed, timeout, DNS
    | "empty_response"    // API returned no text
    | "unknown";

export class AiError extends Error {
    constructor(
        message: string,
        public readonly kind: AiErrorKind,
        public readonly statusCode?: number,
    ) {
        super(message);
        this.name = "AiError";
    }

    /** True when retrying on the next check interval makes sense. */
    get isRetryable(): boolean {
        return this.kind === "quota_exceeded" || this.kind === "network_error";
    }

    /** True when AI should be silently disabled for the rest of the session. */
    get isPermanent(): boolean {
        return this.kind === "invalid_key" || this.kind === "model_error";
    }
}

// ---------------------------------------------------------------------------
// Default models
// ---------------------------------------------------------------------------

const DEFAULTS: Record<Exclude<AiProviderType, "custom">, string> = {
    anthropic: "claude-haiku-4-5-20251001",
    openai:    "gpt-4o-mini",
    gemini:    "gemini-3.1-flash-lite",
};

// ---------------------------------------------------------------------------
// Auto-discovery from environment variables
// ---------------------------------------------------------------------------

/**
 * Detect an AI provider from environment variables.
 * Priority: ANTHROPIC_API_KEY → OPENAI_API_KEY → GEMINI_API_KEY / GOOGLE_AI_API_KEY
 *
 * Set OPENAI_BASE_URL to point any OpenAI-compatible provider
 * (Ollama, Mistral, Groq, Together AI, LM Studio …).
 */
export function resolveProvider(): AiProvider | null {
    const anthropic = process.env["ANTHROPIC_API_KEY"];
    if (anthropic) return { type: "anthropic", apiKey: anthropic };

    const openai   = process.env["OPENAI_API_KEY"];
    if (openai) {
        return {
            type:    "openai",
            apiKey:  openai,
            baseUrl: process.env["OPENAI_BASE_URL"],
        };
    }

    const gemini = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_AI_API_KEY"];
    if (gemini) return { type: "gemini", apiKey: gemini };

    return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a natural-language summary for a DiffReport.
 *
 * If `provider` is omitted, falls back to auto-discovery via env vars.
 * Returns null when there are no meaningful changes to summarise.
 * Throws AiError on provider errors - callers should handle by kind.
 */
export async function generateAiSummary(
    report: DiffReport,
    provider?: AiProvider,
    promptOverride?: string | ((report: DiffReport) => string | Promise<string>),
): Promise<string | null> {
    const p = provider ?? resolveProvider();
    if (!p) {
        throw new AiError(
            "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY, " +
            "or pass aiProvider explicitly.",
            "unknown",
        );
    }

    let prompt: string;
    if (promptOverride !== undefined) {
        prompt = typeof promptOverride === "function"
            ? await promptOverride(report)
            : promptOverride;
    } else {
        const lines = report.changes
            .map((c) => {
                if (c.kind === "added")    return `Added: ${c.after ?? ""}`;
                if (c.kind === "removed")  return `Removed: ${c.before ?? ""}`;
                if (c.kind === "modified") return `Changed: ${c.before ?? ""} → ${c.after ?? ""}`;
                return null;
            })
            .filter(Boolean)
            .slice(0, 30)
            .join("\n");

        if (!lines) return null;

        prompt =
            `You are monitoring a web page for changes. Summarize the following diff in 1-2 sentences ` +
            `in plain language, focusing on what is important to a human reader.\n\n` +
            `URL: ${report.url}\nChanges:\n${lines}\n\nSummary:`;
    }

    switch (p.type) {
        case "anthropic": return callAnthropic(prompt, p);
        case "openai":    return callOpenAiCompatible(prompt, p);
        case "gemini":    return callGemini(prompt, p);
        case "custom": {
            if (!p.callAi) {
                throw new AiError('Provider type "custom" requires a callAi function.', "model_error");
            }
            const result = await p.callAi(prompt);
            if (result === null || result === undefined) {
                throw new AiError("Custom callAi returned null.", "empty_response");
            }
            return String(result).trim() || null;
        }
        default:
            throw new AiError(
                `Unknown AI provider type: "${String((p as AiProvider).type)}". ` +
                `Use "anthropic", "openai", "gemini", or "custom".`,
                "model_error",
            );
    }
}

/** Returns true when AI summaries are enabled and a provider is available. */
export function aiSummaryEnabled(config: WatchConfig): boolean {
    if (!config.aiSummary) return false;
    if (config.aiProvider)  return true;
    return resolveProvider() !== null;
}

/** Returns the resolved provider for a config (explicit or from env). */
export function getProvider(config: WatchConfig): AiProvider | null {
    return config.aiProvider ?? resolveProvider();
}

/**
 * Low-level: send a prompt to a provider and return the text response.
 * Use this to build custom summaries (e.g. for DbDiffReport).
 */
export async function callProvider(prompt: string, provider?: AiProvider): Promise<string | null> {
    const p = provider ?? resolveProvider();
    if (!p) {
        throw new AiError(
            "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.",
            "unknown",
        );
    }
    switch (p.type) {
        case "anthropic": return callAnthropic(prompt, p);
        case "openai":    return callOpenAiCompatible(prompt, p);
        case "gemini":    return callGemini(prompt, p);
        case "custom": {
            if (!p.callAi) throw new AiError('Provider type "custom" requires a callAi function.', "model_error");
            const r = await p.callAi(prompt);
            if (r === null || r === undefined) throw new AiError("Custom callAi returned null.", "empty_response");
            return String(r).trim() || null;
        }
        default:
            throw new AiError(`Unknown AI provider type: "${String((p as AiProvider).type)}".`, "model_error");
    }
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function callAnthropic(prompt: string, p: AiProvider): Promise<string | null> {
    let resp: Response;
    try {
        resp = await fetch("https://api.anthropic.com/v1/messages", {
            method:  "POST",
            headers: {
                "x-api-key":         p.apiKey ?? "",
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            body: JSON.stringify({
                model:      p.model ?? DEFAULTS.anthropic,
                max_tokens: 256,
                messages:   [{ role: "user", content: prompt }],
            }),
        });
    } catch (err) {
        throw new AiError(`Network error: ${String(err)}`, "network_error");
    }

    if (!resp.ok) {
        const body = await safeText(resp);
        throw new AiError(`Anthropic ${resp.status}: ${body}`, classifyStatus(resp.status), resp.status);
    }

    const data = await resp.json() as { content: { type: string; text: string }[] };
    const text = data.content.find((b) => b.type === "text")?.text.trim();
    if (!text) throw new AiError("Anthropic returned empty content.", "empty_response");
    return text;
}

/**
 * OpenAI-compatible: works with OpenAI, Ollama, Mistral, Groq, Together AI,
 * LM Studio, Perplexity, Anyscale, and any provider following the chat/completions spec.
 */
async function callOpenAiCompatible(prompt: string, p: AiProvider): Promise<string | null> {
    const base = (p.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const url  = `${base}/chat/completions`;

    let resp: Response;
    try {
        resp = await fetch(url, {
            method:  "POST",
            headers: {
                ...(p.apiKey ? { "Authorization": `Bearer ${p.apiKey}` } : {}),
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model:      p.model ?? DEFAULTS.openai,
                max_tokens: 256,
                messages:   [{ role: "user", content: prompt }],
            }),
        });
    } catch (err) {
        throw new AiError(`Network error: ${String(err)}`, "network_error");
    }

    if (!resp.ok) {
        const body = await safeText(resp);
        throw new AiError(`OpenAI-compatible ${resp.status}: ${body}`, classifyStatus(resp.status), resp.status);
    }

    const data = await resp.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message.content.trim();
    if (!text) throw new AiError("OpenAI-compatible API returned empty content.", "empty_response");
    return text;
}

async function callGemini(prompt: string, p: AiProvider): Promise<string | null> {
    const model = p.model ?? DEFAULTS.gemini;
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${p.apiKey ?? ""}`;

    let resp: Response;
    try {
        resp = await fetch(url, {
            method:  "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                contents:         [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 256 },
            }),
        });
    } catch (err) {
        throw new AiError(`Network error: ${String(err)}`, "network_error");
    }

    if (!resp.ok) {
        const body = await safeText(resp);
        throw new AiError(`Gemini ${resp.status}: ${body}`, classifyStatus(resp.status), resp.status);
    }

    const data = await resp.json() as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new AiError("Gemini returned empty content.", "empty_response");
    return text;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyStatus(status: number): AiErrorKind {
    if (status === 401 || status === 403) return "invalid_key";
    if (status === 429)                   return "quota_exceeded";
    if (status === 400)                   return "model_error";
    return "unknown";
}

async function safeText(resp: Response): Promise<string> {
    try { return await resp.text(); } catch { return "(unreadable)"; }
}
