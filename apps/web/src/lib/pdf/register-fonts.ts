import { Font } from "@react-pdf/renderer";

/**
 * react-pdf's built-in fonts (Helvetica/Times/Courier) are the classic
 * PDF base-14 set, which does not include the Naira sign (₦, U+20A6) — it
 * silently renders blank/missing-glyph instead of erroring, which is why
 * invoices showed no ₦ at all. Noto Sans has broad Unicode coverage
 * including currency symbols, so registering it once and using it as the
 * page's default font fixes every document that shows an amount, not just
 * the one that was reported.
 *
 * Registered once per process (Font.register is idempotent — re-registering
 * the same family is a no-op) rather than per-render.
 */
let registered = false;

export const PDF_FONT_FAMILY = "Noto Sans";

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      {
        src: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf",
        fontWeight: 400,
      },
      {
        src: "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf",
        fontWeight: 700,
      },
    ],
  });
}
