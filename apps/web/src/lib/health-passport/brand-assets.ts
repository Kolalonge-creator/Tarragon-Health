import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Guard Leaf mark, loaded off disk for PDF rendering.
 *
 * Read as bytes rather than referenced by URL because @react-pdf fetching a URL
 * at render time would make every download depend on the app being able to reach
 * itself over the network — a slow or blocked request would turn a working
 * document into a hung one. Bytes off the filesystem cannot fail that way.
 *
 * Cached for the process lifetime: the file does not change under a running
 * server, and re-reading 64KB on every download is pure waste.
 *
 * A missing file degrades to a wordmark-only header rather than an exception.
 * A logo is not what makes this document trustworthy — the signature is — so
 * losing it must never lose the passport.
 */

const CANDIDATE_PATHS = [
  // Normal Next.js server runtime: cwd is apps/web.
  "public/brand/guard-leaf-mark.png",
  // Monorepo root, e.g. a script or a test runner started from the top.
  "apps/web/public/brand/guard-leaf-mark.png",
];

let cached: Buffer | null | undefined;

export function guardLeafMarkPng(): Buffer | null {
  if (cached !== undefined) return cached;
  for (const relative of CANDIDATE_PATHS) {
    try {
      cached = readFileSync(path.join(process.cwd(), relative));
      return cached;
    } catch {
      // try the next candidate
    }
  }
  cached = null;
  return cached;
}

/**
 * The brand system as PDF-ready values.
 *
 * Deliberately a separate set of constants from the dashboard's clinical status
 * colours (green/amber/red/blue/grey). Those signal a patient's clinical state;
 * these are the brand. docs/BRAND_GUIDE.md is explicit that conflating the two
 * is a mistake, and a document that reads as "green = you are fine" when the
 * green is just the letterhead would be exactly that mistake.
 */
export const PDF_BRAND = {
  green: "#0E7C52",
  greenDeep: "#0A5D3D",
  greenTint: "#E8F2EC",
  navy: "#12324B",
  navyTint: "#EDF2F6",
  ink: "#1F2933",
  muted: "#5B6B78",
  hairline: "#DCE4EA",
  paper: "#FFFFFF",
  warm: "#B45309",
  alert: "#B42318",
} as const;
