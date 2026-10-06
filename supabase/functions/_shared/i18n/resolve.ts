import { EN } from "./catalogue.ts";

/**
 * Resolve an i18n key pair (subject + body) with parameter interpolation.
 * Returns null when the key is not in the catalogue so the caller can
 * fall back to the raw text that SQL already put in payload.subject/message.
 */
export function resolveI18n(
  key: string,
  params?: Record<string, string>,
): { subject: string; body: string } | null {
  const subjectKey = `${key}.subject`;
  const bodyKey = `${key}.body`;
  const rawSubject = EN[subjectKey];
  const rawBody = EN[bodyKey];
  if (rawSubject === undefined || rawBody === undefined) return null;
  return {
    subject: interpolate(rawSubject, params),
    body: interpolate(rawBody, params),
  };
}

function interpolate(
  template: string,
  params?: Record<string, string>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const val = params[name];
    return val !== undefined ? val : match;
  });
}
