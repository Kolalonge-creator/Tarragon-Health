/** What a failed profile read means. A refusal (not tied to this patient, no access) is a different thing from an outage, and the screen must not blur them. */
export class AgpReadError extends Error {
  constructor(
    readonly kind: "denied" | "error",
    message: string,
  ) {
    super(message);
    this.name = "AgpReadError";
  }
}

/** Rows asked of the audited read for each source. A source that returns exactly this many has been cut off, and the screen says so. */
export const AGP_READ_LIMIT = 5000;
