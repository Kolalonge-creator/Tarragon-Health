/**
 * Deliberately crude, dependency-free User-Agent summary for the "Devices"
 * list on /account — good enough to tell a patient "Chrome on Windows"
 * apart from "Safari on iPhone" without pulling in a full UA-parsing
 * library for a single, low-stakes display string. Falls back to a
 * truncated raw string for anything it doesn't recognise, which is a
 * correct (if unpolished) answer, not a bug.
 */
export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  // "Edg/" (desktop), "EdgA/" (Android), "EdgiOS/" (iOS) — Edge's UA token
  // differs per platform; matching only "Edg/" mislabelled mobile Edge as
  // Chrome/Safari, undermining the "spot an unfamiliar login" point of this
  // list.
  const browser = /Edg(A|iOS)?\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /CriOS\//.test(userAgent)
          ? "Chrome"
          : /FxiOS\//.test(userAgent)
            ? "Firefox"
            : /Firefox\//.test(userAgent)
              ? "Firefox"
              : /Safari\//.test(userAgent) && /Version\//.test(userAgent)
                ? "Safari"
                : null;

  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;

  return userAgent.length > 60 ? `${userAgent.slice(0, 60)}…` : userAgent;
}
