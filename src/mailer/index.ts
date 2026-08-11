import { changeHuman } from "../models.js";
import type { DiffReport, EmailConfig } from "../models.js";

export async function sendEmail(config: EmailConfig, report: DiffReport): Promise<void> {
    let nodemailer: typeof import("nodemailer");
    try {
        nodemailer = await import("nodemailer");
    } catch {
        throw new Error("nodemailer is required for email alerts. Run: npm install nodemailer");
    }

    const { smtp } = config;
    const secure   = config.smtp.secure ?? config.smtp.port === 465;
    const from     = config.from ?? `${smtp.user}@${smtp.host}`;
    const subject  = config.subject ?? `[WatchDiff] Change detected: ${report.label}`;

    const changeLines = report.changes
        .slice(0, 50)
        .map(changeHuman)
        .join("\n");

    const ts   = report.comparedAt.toISOString().replace("T", " ").slice(0, 19);
    const body = [
        `URL:      ${report.url}`,
        `Label:    ${report.label}`,
        `Compared: ${ts} UTC`,
        `Changes:  ${report.changes.length}`,
        ``,
        changeLines,
    ].join("\n");

    const transporter = nodemailer.createTransport({
        host:   smtp.host,
        port:   smtp.port,
        secure,
        auth: {
            user: smtp.user,
            pass: smtp.pass,
        },
    });

    const to = Array.isArray(config.to) ? config.to.join(", ") : config.to;

    await transporter.sendMail({ from, to, subject, text: body });
}
