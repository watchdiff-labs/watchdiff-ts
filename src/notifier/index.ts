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

        // 2. Webhooks
        await Promise.allSettled(alert.webhooks.map((url) => this.sendWebhook(url, report)));
    }

    private async sendWebhook(url: string, report: DiffReport): Promise<void> {
        const { payload, headers } = this.buildPayload(url, report);
        try {
            const res = await globalThis.fetch(url, {
                method:  "POST",
                headers: { "Content-Type": "application/json", ...headers },
                body:    JSON.stringify(payload),
                signal:  AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                console.warn(`[watchdiff] Webhook ${url} returned ${res.status}`);
            }
        } catch (err) {
            console.warn(`[watchdiff] Webhook request error (${url}):`, err);
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
