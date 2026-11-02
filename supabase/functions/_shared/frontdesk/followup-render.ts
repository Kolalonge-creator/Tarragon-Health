/**
 * Turns one claimed follow-up run into the email that is sent (F8). Pure: no I/O, no clock.
 *
 * The wording is the approved text from fd_sequence_steps with two placeholders filled, {{first_name}} (falls back to "there") and {{link}}
 * (where the step sends the person). Every email gets an unsubscribe footer and the List-Unsubscribe headers (RFC 8058 one-click), added
 * here and not in the stored wording, so no approved text can ever omit them.
 */
export interface RenderInput {
  readonly subject: string;
  readonly bodyText: string;
  readonly firstName: string | null;
  readonly stepKey: string;
  readonly sequenceKey: string;
  /** https://app.tarragonhealth.ng, no trailing slash. */
  readonly appBaseUrl: string;
  /** https://tarragonhealth.ng, no trailing slash. */
  readonly siteUrl: string;
  readonly unsubscribeUrl: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly link: string;
}

/** Where each step sends the person. Anything not listed opens the app. */
export function linkFor(stepKey: string, sequenceKey: string, appBaseUrl: string, siteUrl: string): string {
  if (sequenceKey === "finish_signup") return `${appBaseUrl}/onboarding`;
  if (stepKey === "welcome_3") return `${siteUrl}/pricing`;
  if (sequenceKey === "health_check_interest") return `${siteUrl}/annual-health-check`;
  if (sequenceKey === "post_enquiry") return stepKey === "post_enquiry_1" ? `${siteUrl}/pricing/how-it-works` : appBaseUrl;
  return appBaseUrl;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A first name is shown as typed except that anything that is not a plausible name falls back to "there". */
export function displayName(firstName: string | null): string {
  const n = (firstName ?? "").trim();
  return n.length >= 1 && n.length <= 40 && /^[\p{L}][\p{L}\p{M}'’ -]*$/u.test(n) ? n : "there";
}

export function renderFollowup(input: RenderInput): RenderedEmail {
  const link = linkFor(input.stepKey, input.sequenceKey, input.appBaseUrl, input.siteUrl);
  const fill = (t: string): string => t.replace(/\{\{first_name\}\}/g, displayName(input.firstName)).replace(/\{\{link\}\}/g, link);
  const subject = fill(input.subject);
  const body = fill(input.bodyText).trim();
  const footerText = `You are getting this email because of your TarragonHealth account or your enquiry.\nStop these emails: ${input.unsubscribeUrl}\nTarragonHealth, Lagos, Nigeria`;
  const text = `${body}\n\n--\n${footerText}\n`;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p).replace(/\n/g, "<br>").replace(escapeHtml(link), `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`)}</p>`)
    .join("");
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#1d2b2b;max-width:560px">${paragraphs}` +
    `<hr style="border:none;border-top:1px solid #dde5e2;margin:22px 0">` +
    `<p style="margin:0;font-size:13px;color:#5b6b68;line-height:1.5">You are getting this email because of your TarragonHealth account or your enquiry.<br>` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}">Stop these emails</a><br>TarragonHealth, Lagos, Nigeria</p></div>`;
  return {
    subject,
    text,
    html,
    link,
    headers: { "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
