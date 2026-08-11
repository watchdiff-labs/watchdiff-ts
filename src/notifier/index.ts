/**
 * Notifier - dispatches alerts when a DiffReport has changes.
 *
 * Supported channels:
 *   - JS callbacks (sync or async)
 *   - Discord webhook
 *   - Slack webhook
 *   - Telegram Bot API  (https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>)
 *   - Microsoft Teams   (https://outlook.office.com/webhook/...)
 *   - ntfy.sh           (https://ntfy.sh/<topic>)
 *   - Generic HTTP POST
 */

import {
    changeHuman,
    reportAsDict,
    reportHasChanges,
    reportSummary,
    type AlertConfig,
    type DiffReport,
} from "../models.js";
import { sendEmail } from "../mailer/index.js";

const DEFAULT_WEBHOOK_RETRIES = 3;
const RETRY_BASE_DELAY_MS     = 500;

export class Notifier {
    async notify(report: DiffReport, alert: AlertConfig): Promise<void> {
        if (!reportHasChanges(report)) return;
        if (report.changes.length < alert.minChanges) return;

        // 1. JS callbacks
        for (const cb of alert.onChange) {
            try {
                await cb(report);
            } catch (err) {
                console.warn("[watchdiff] Alert callback error:", err);
            }
        }

        // 2. Webhooks (with retry)
        const maxAttempts = (alert.webhookRetries ?? DEFAULT_WEBHOOK_RETRIES) + 1;
        await Promise.allSettled(
            alert.webhooks.map((url) => this.sendWebhookWithRetry(url, report, maxAttempts))
        );

        // 3. Email
        if (alert.email) {
            try {
                await sendEmail(alert.email, report);
            } catch (err) {
                console.warn("[watchdiff] Email alert failed:", err instanceof Error ? err.message : String(err));
            }
        }
    }

    private async sendWebhookWithRetry(
        url:         string,
        report:      DiffReport,
        maxAttempts: number
    ): Promise<void> {
        let lastErr: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.sendWebhook(url, report);
                return;
            } catch (err) {
                lastErr = err;
                if (attempt < maxAttempts) {
                    await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
                }
            }
        }
        console.warn(
            `[watchdiff] Webhook failed after ${maxAttempts} attempt(s) (${url}):`,
            lastErr
        );
    }

    private async sendWebhook(url: string, report: DiffReport): Promise<void> {
        const { payload, headers } = this.buildPayload(url, report);
        const res = await globalThis.fetch(url, {
            method:  "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body:    JSON.stringify(payload),
            signal:  AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            throw new Error(`Webhook ${url} returned ${res.status}`);
        }
    }

    private buildPayload(
        url: string,
        report: DiffReport
    ): { payload: Record<string, unknown>; headers: Record<string, string> } {
        const summary     = reportSummary(report);
        const changeLines = report.changes
            .slice(0, 20)
            .map(changeHuman)
            .join("\n");
        const text = `${summary}\n\n${changeLines}`;

        // Discord
        if (url.includes("discord.com")) {
            return { payload: { content: text.slice(0, 2000) }, headers: {} };
        }

        // Slack
        if (url.includes("hooks.slack.com")) {
            return { payload: { text: text.slice(0, 3000) }, headers: {} };
        }

        // Telegram  - URL format: https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>
        if (url.includes("api.telegram.org")) {
            const chatId = new URL(url).searchParams.get("chat_id") ?? "";
            return {
                payload: {
                    chat_id:    chatId,
                    text:       text.slice(0, 4096),
                    parse_mode: "HTML",
                },
                headers: {},
            };
        }

        // Microsoft Teams (Incoming Webhook or Power Automate)
        if (url.includes("outlook.office.com") || url.includes("webhook.office.com") || url.includes("logic.azure.com")) {
            return {
                payload: {
                    "@type":      "MessageCard",
                    "@context":   "http://schema.org/extensions",
                    summary:      summary,
                    themeColor:   "FF8C00",
                    title:        summary,
                    text:         `<pre>${changeLines.slice(0, 3000)}</pre>`,
                },
                headers: {},
            };
        }

        // ntfy.sh  - URL format: https://ntfy.sh/<topic>
        if (url.includes("ntfy.sh") || url.includes("ntfy.")) {
            return {
                payload: { message: text.slice(0, 4096) },
                headers: {
                    Title:    summary.slice(0, 255),
                    Priority: "default",
                    Tags:     "rotating_light",
                },
            };
        }

        // Generic
        return { payload: reportAsDict(report), headers: {} };
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
