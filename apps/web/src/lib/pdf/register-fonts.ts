import path from "node:path";
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
 * `Font.register()`'s `src` must be a path/URL string — it runs its own
 * `isDataUrl`/`isUrl` string checks on the value before ever touching
 * fontkit, so passing a Buffer throws ("dataUrl.substring is not a
 * function") rather than registering. Bundled locally
 * (fonts/NotoSans-*.ttf) rather than fetched from Google Fonts at render
 * time, since a remote URL source races `renderToBuffer()` against the
 * lazy fetch react-pdf's layout engine does when it first needs the font.
 *
 * Registered once per process (Font.register is idempotent — re-registering
 * the same family is a no-op) rather than per-render.
 */
let registered = false;

export const PDF_FONT_FAMILY = "Noto Sans";

const FONTS_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");

export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(FONTS_DIR, "NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONTS_DIR, "NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
}
