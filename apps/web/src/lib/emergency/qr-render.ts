import "server-only";
import QRCode from "qrcode";

/**
 * Render the offline card's plain-text payload (see qr-text.ts) as an inline
 * SVG. Kept separate from qr-text.ts so the text-building logic stays a pure,
 * directly-unit-tested module with no server-only/QRCode dependency.
 *
 * ECC level 'M' (not 'H' like the live card's URL QR): the text payload is
 * larger, and 'M' buys back capacity headroom while still tolerating real
 * printed-card wear far better than a phone screen ever needs.
 */
export async function emergencyTextQrSvg(text: string): Promise<string | null> {
  try {
    return await QRCode.toString(text, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    });
  } catch {
    // A missing QR is a degraded card, never a broken page — the same facts
    // are already printed in full, human-readable text on the card itself.
    return null;
  }
}
