import "server-only";
import QRCode from "qrcode";

/**
 * 69.7 check-in QR — renders the plain-text payload (the appointment's own
 * id) as an inline SVG, same shape as apps/web/src/lib/emergency/qr-render.ts.
 * A real physical facility with the BLE clinical-device-pairing kind of
 * kiosk hardware would use a USB/Bluetooth barcode-scanner reader (types the
 * scanned text into whatever input has focus) against the facility queue
 * page's "scan or enter code" field — no camera/decoding library needed on
 * this side, which this codebase doesn't have yet. ECC level 'M', matching
 * the emergency card's printed-QR choice — this one is more often shown on
 * a phone screen than printed, but a mid error-correction level costs
 * nothing here and buys tolerance for a scuffed screen/bad lighting at a
 * reception desk.
 */
export async function appointmentCheckInQrSvg(appointmentId: string): Promise<string | null> {
  try {
    return await QRCode.toString(appointmentId, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    });
  } catch {
    // A missing QR degrades to the manual-entry path on the facility queue
    // page, never a broken page.
    return null;
  }
}
