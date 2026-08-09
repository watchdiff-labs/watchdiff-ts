import { connect } from "node:tls";
import type { CertSnapshot, CertWatchConfig } from "../cert-models.js";

export async function fetchCert(config: CertWatchConfig): Promise<CertSnapshot> {
    return new Promise((resolve, reject) => {
        const socket = connect(
            {
                host:                config.hostname,
                port:                config.port,
                servername:          config.hostname,
                rejectUnauthorized:  false,
            },
            () => {
                const raw = socket.getPeerCertificate(false);
                socket.end();

                if (!raw?.valid_to) {
                    reject(new Error(`No certificate returned for ${config.hostname}:${config.port}`));
                    return;
                }

                const validFrom = new Date(raw.valid_from);
                const validTo   = new Date(raw.valid_to);
                const now       = Date.now();
                const msPerDay  = 1000 * 60 * 60 * 24;
                const daysUntilExpiry = Math.floor((validTo.getTime() - now) / msPerDay);

                resolve({
                    hostname:        config.hostname,
                    port:            config.port,
                    validFrom,
                    validTo,
                    daysUntilExpiry,
                    issuer:          String(raw.issuer?.CN ?? raw.issuer?.O ?? "Unknown"),
                    subject:         String(raw.subject?.CN ?? config.hostname),
                    fingerprint:     raw.fingerprint256 ?? raw.fingerprint ?? "",
                    capturedAt:      new Date(),
                });
            },
        );

        socket.setTimeout(10_000, () => {
            socket.destroy();
            reject(new Error(`TLS connection timeout for ${config.hostname}:${config.port}`));
        });

        socket.on("error", (err) => {
            reject(err);
        });
    });
}
