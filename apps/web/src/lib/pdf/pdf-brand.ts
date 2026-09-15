import fs from "node:fs";
import path from "node:path";

/**
 * The Guard Leaf mark, read once from the app's own public assets and kept
 * as a Buffer. A previous version fetched this over HTTPS from the live
 * marketing domain on every render — that made every PDF depend on network
 * access to app.tarragonhealth.ng, which silently produced a logo-less PDF
 * (react-pdf drops an Image it can't load rather than failing the render)
 * whenever that fetch was slow, blocked, or the domain wasn't reachable
 * (e.g. local dev). The file already ships in this app's own
 * public/brand/, so reading it directly removes the network dependency
 * entirely.
 */
export const PDF_LOGO_SRC = {
  data: fs.readFileSync(path.join(process.cwd(), "public/brand/guard-leaf-mark.png")),
  format: "png" as const,
};

export const PDF_CONTACT_EMAIL = "admin@tarragonhealth.ng";

/**
 * The one real, published support line (CLAUDE.md's Non-Negotiable Business
 * Rules: phone numbers always E.164). Matches the number already printed on
 * the marketing site's contact page and footer — do not invent a second one.
 */
export const PDF_CONTACT_PHONE = "+234 806 119 7940";

/** Master tagline, per CLAUDE.md's Brand section. Print verbatim, never
 * paraphrased — it is the one line every TarragonHealth document carries. */
export const PDF_TAGLINE = "Care that stays with you.";

/** Brand colour tokens, per CLAUDE.md — never approximate these by eye. */
export const PDF_BRAND_GREEN = "#0E7C52";
export const PDF_CLINICAL_NAVY = "#12324B";
export const PDF_DEEP_FOREST = "#0B5E3E";
