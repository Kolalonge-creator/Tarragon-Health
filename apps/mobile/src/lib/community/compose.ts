import type { MessageKey } from "@tarragon/i18n";
import { FAILED_KEY, type ComposeOutcome } from "./model";
import type { UploadReply } from "./upload";

/**
 * What the composer does with the answer to a post, a reply, an edit, a question or a post with a picture. Pure, so it is tested.
 * Same behaviour as the web composer (apps/web/.../community/composer.tsx):
 *
 *   published  -> cleared, "Posted."
 *   held       -> cleared (the post exists, a moderator will look), reason shown
 *   blocked    -> text KEPT so it can be fixed, reason shown
 *   refused    -> text KEPT, reason shown
 *   safety     -> text AND picture CLEARED and kept nowhere; the screen shows the safety card before anything else
 *   failed     -> everything KEPT; the request id is kept too unless the server gave a clear no, so pressing Post again cannot double-post
 */
export type ComposerResult =
  | { kind: "outcome"; outcome: ComposeOutcome }
  /** `definite` is true when the server gave a clear no, so the next try is a new attempt with a new request id. */
  | { kind: "failed"; message: MessageKey; definite: boolean };

export interface ComposerEffect {
  message: MessageKey | null;
  clearText: boolean;
  clearPicture: boolean;
  /** End this attempt: the next press uses a new request id. */
  settleRequestId: boolean;
  safety: "emergency" | "self_harm" | null;
  /** Reload the feed or replies (something new exists). */
  refresh: boolean;
  /** An edit box can close. */
  close: boolean;
}

export function composerEffect(result: ComposerResult): ComposerEffect {
  if (result.kind === "failed") {
    return { message: result.message, clearText: false, clearPicture: false, settleRequestId: result.definite, safety: null, refresh: false, close: false };
  }
  const outcome = result.outcome;
  switch (outcome.kind) {
    case "safety":
      return { message: null, clearText: true, clearPicture: true, settleRequestId: true, safety: outcome.safety, refresh: false, close: false };
    case "published":
    case "held":
      return { message: outcome.message, clearText: true, clearPicture: true, settleRequestId: true, safety: null, refresh: true, close: true };
    case "blocked":
    case "refused":
      return { message: outcome.message, clearText: false, clearPicture: false, settleRequestId: true, safety: null, refresh: false, close: false };
  }
}

/** From the text route's answer. */
export function fromSubmit(result: { ok: true; outcome: ComposeOutcome } | { ok: false; key: MessageKey; definite: boolean }): ComposerResult {
  return result.ok ? { kind: "outcome", outcome: result.outcome } : { kind: "failed", message: result.key, definite: result.definite };
}

/** From the picture route's answer. */
export function fromUpload(reply: UploadReply): ComposerResult {
  return reply.kind === "outcome" ? reply : { kind: "failed", message: FAILED_KEY, definite: reply.definite };
}
