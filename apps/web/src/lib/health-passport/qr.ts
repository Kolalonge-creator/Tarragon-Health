import "server-only";
import QRCode from "qrcode";

/**
 * QR codes for the passport.
 *
 * Two different codes with two different jobs, and it is worth being clear which
 * is which because they fail differently:
 *
 *   THE VERIFY QR carries a short URL. It is the one an embassy clerk or a
 *   receptionist actually scans, so it must survive a photocopy, a fold and bad
 *   light — hence high error correction and a generous module size. It requires
 *   the internet, and that is fine: it is answering a live question ("is this
 *   still valid?") that no offline artefact could answer honestly.
 *
 *   THE OFFLINE QR carries the whole signed credential. Nobody needs it on a
 *   normal day; it exists so the document keeps its meaning with no network at
 *   all — a technical verifier can scan it, fetch our public key once, and check
 *   the signature themselves forever after. It is large, so it is rendered only
 *   when it comfortably fits, and its absence costs the document nothing.
 */

/** PNG data URI, because @react-pdf renders raster images more predictably than inline SVG. */
async function qrPngDataUri(
  value: string,
  opts: { size: number; ecc: "L" | "M" | "Q" | "H" }
): Promise<string | null> {
  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: opts.ecc,
      margin: 1,
      width: opts.size,
      color: { dark: "#12324BFF", light: "#FFFFFFFF" },
    });
  } catch {
    // A missing QR is a degraded document, never a broken one — the verify URL
    // and the serial are both printed in plain text right beside it.
    return null;
  }
}

export async function verifyQrPng(verifyUrl: string): Promise<string | null> {
  return qrPngDataUri(verifyUrl, { size: 480, ecc: "H" });
}

/**
 * Version 40 at ECC level L tops out around 2,950 bytes. Credentials sit well
 * under that today (roughly 600-900 bytes), but an attestation statement is
 * free text, so the ceiling is real. Above it the QR is simply omitted: a
 * dense, unscannable block would be worse than none, and the same credential is
 * printed as text in the appendix either way.
 */
const OFFLINE_QR_MAX_BYTES = 2200;

export async function offlineCredentialQrPng(compact: string): Promise<string | null> {
  if (Buffer.byteLength(compact, "utf8") > OFFLINE_QR_MAX_BYTES) return null;
  // ECC 'M' rather than 'H': the payload is far larger than a URL, and this is
  // the code scanned deliberately at a desk rather than grabbed off a creased
  // card, so capacity is worth more here than damage tolerance.
  return qrPngDataUri(compact, { size: 640, ecc: "M" });
}

/** Inline SVG for the on-screen (HTML) verification panel. */
export async function verifyQrSvg(verifyUrl: string): Promise<string | null> {
  try {
    return await QRCode.toString(verifyUrl, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 1,
      width: 200,
    });
  } catch {
    return null;
  }
}
