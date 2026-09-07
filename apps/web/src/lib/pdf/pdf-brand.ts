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
