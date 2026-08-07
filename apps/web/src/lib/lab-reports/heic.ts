import "server-only";

/**
 * HEIC to JPEG, at the extraction boundary.
 *
 * WHY THIS EXISTS: an iPhone photographing a lab report produces HEIC by
 * default, and the self-arranged fulfilment model's front door is precisely "a
 * patient photographs the result they were handed". The upload path and the
 * storage bucket have always accepted image/heic; the vision model does not.
 * Without this, every iPhone upload succeeded and then immediately recorded a
 * failed extraction telling the clinician to type the numbers in by hand — the
 * one flow the whole engine exists to remove, silently defeated for what is
 * plausibly most of the patient uploads in the country.
 *
 * The conversion happens HERE rather than in the browser on purpose. Safari can
 * decode HEIC to a canvas, but no other browser can, and an upload path that
 * only works on one browser is a worse trap than the one being fixed: it fails
 * for exactly the users who cannot tell why.
 *
 * NEVER THROWS. A conversion failure returns the original bytes unchanged, so
 * the caller falls through to its existing unsupported-type handling and the
 * manual-entry path is exactly as it was. This module can only ever turn a
 * guaranteed failure into a possible success.
 */

/** What the vision model accepts directly, so nothing else is touched. */
const PASSTHROUGH = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export interface NormalisedDocument {
  buffer: Buffer;
  mediaType: string;
  /** True when bytes were re-encoded, for logging and for the failure message. */
  converted: boolean;
}

/**
 * JPEG quality for the re-encode.
 *
 * Deliberately high. This image is about to be read for digits on a printed
 * table, where the difference between an 8 and a 3 can be a few pixels of
 * compression artefact. Storage is not the constraint — the converted copy is
 * never persisted, it only exists for the duration of one model call — so
 * there is nothing to trade accuracy against.
 */
const JPEG_QUALITY = 0.92;

/**
 * Return bytes the vision model can read, converting HEIC if that is what
 * arrived. Anything already readable passes through untouched.
 */
export async function normaliseForVision(
  buffer: Buffer,
  mediaType: string | null,
): Promise<NormalisedDocument> {
  const type = (mediaType ?? "").toLowerCase();

  if (PASSTHROUGH.has(type)) {
    return { buffer, mediaType: type, converted: false };
  }
  if (!HEIC_TYPES.has(type)) {
    // Unknown type: hand it back unchanged and let the caller refuse it.
    return { buffer, mediaType: type, converted: false };
  }

  try {
    // Imported lazily so the (native-ish, heavyweight) decoder is only loaded
    // when a HEIC actually arrives, and so a broken install degrades to the
    // old behaviour rather than breaking every extraction on the platform.
    const { default: heicConvert } = await import("heic-convert");
    const output = await heicConvert({
      buffer,
      format: "JPEG",
      quality: JPEG_QUALITY,
    });
    const converted = Buffer.from(output);
    if (converted.length === 0) throw new Error("Converter returned no data");
    return { buffer: converted, mediaType: "image/jpeg", converted: true };
  } catch (error) {
    console.error("lab-reports: HEIC conversion failed, passing original through", error);
    return { buffer, mediaType: type, converted: false };
  }
}

/** True when this type can be read, with conversion if needed. */
export function isReadableDocumentType(mediaType: string | null): boolean {
  const type = (mediaType ?? "").toLowerCase();
  return PASSTHROUGH.has(type) || HEIC_TYPES.has(type);
}
