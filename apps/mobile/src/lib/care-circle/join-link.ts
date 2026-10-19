import { useSyncExternalStore } from "react";
import { PLATFORM_URL } from "@/lib/platform-url";

const HOST = PLATFORM_URL.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";

/**
 * The invite link a patient shares, opened in the app (S29e). Three shapes reach the same place:
 *   tarragonhealth://join/<token>                        (the "open in the app" link on the web page; the scheme is already in the build)
 *   tarragonhealth://patient/supporting/join/<token>     (the web path under the app scheme)
 *   https://<platform host>/patient/supporting/join/<token>  (the shared link itself, once the OS hands it to the app)
 * The token is base64url (A-Z a-z 0-9 _ -). Anything else is not a join link and is ignored. The token is never logged or stored beyond
 * this in-memory slot, and it is cleared the moment the join screen has used or dismissed it.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export function parseJoinLink(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.length > 600) return null;
  const raw = url.trim();
  let rest: string | null = null;
  const scheme = /^tarragonhealth:\/\/(?:patient\/supporting\/)?join\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(raw);
  if (scheme?.[1]) rest = scheme[1];
  else {
    // No URL class here: React Native's is incomplete, and a regex is all this needs.
    const web = /^https:\/\/([^/?#]+)\/patient\/supporting\/join\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(raw);
    if (web?.[1] && web[2] && HOST !== "" && web[1].toLowerCase() === HOST) rest = web[2];
  }
  if (!rest) return null;
  let token: string;
  try {
    token = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return TOKEN.test(token) ? token : null;
}

let pending: string | null = null;
const listeners = new Set<() => void>();
export function setPendingJoinToken(token: string | null): void {
  pending = token;
  listeners.forEach((l) => l());
}
export function clearPendingJoinToken(): void {
  setPendingJoinToken(null);
}
/** Hands a url to the slot if it is a join link; returns whether it was one. */
export function offerUrl(url: string | null | undefined): boolean {
  const token = parseJoinLink(url);
  if (token) setPendingJoinToken(token);
  return token !== null;
}
export function usePendingJoinToken(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending,
    () => null,
  );
}
