// Broadcast branded-email template builder — KEEP IN SYNC WITH
// supabase/functions/send-pending-notifications/index.ts (the
// broadcast_announcement handler, which does the real send). Both must
// produce structurally identical HTML for the same input, or an admin's live
// preview in the confirm dialog lies about what recipients actually get. No
// react-email here (not installed, and the edge function runs on Deno while
// this app is Node/Next) — plain template-literal HTML, so the two copies
// stay independently readable rather than sharing a module across a runtime
// boundary that doesn't exist yet. See notification_broadcasts.email_content's
// column comment (migration
// 20260912220307_broadcast_specific_patients_search_and_email_content.sql)
// for the full field contract.

export interface BroadcastEmailContent {
  headline: string;
  bodyText: string;
  imageUrl?: string;
  bandColor?: "green" | "navy" | "none";
  buttonText?: string;
  buttonUrl?: string;
  footerNote?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders the exact HTML supabase/functions/send-pending-notifications's
 * broadcast_announcement handler will send for this content (or, when
 * content is null/undefined, the plain fallback rendering every broadcast
 * used before email_content existed). Used for the admin composer's live
 * preview — see broadcast-composer.tsx's confirm dialog.
 */
export function renderBroadcastEmailHtml(
  content: BroadcastEmailContent | null | undefined,
  fallbackSubject: string,
  fallbackBody: string
): string {
  if (!content) {
    const bodyHtml = escapeHtml(fallbackBody).replace(/\n/g, "<br>");
    return (
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
      `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(fallbackSubject)}</h2>` +
      `<p>${bodyHtml}</p>` +
      `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
      `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
      `</div>`
    );
  }

  const band = content.bandColor ?? "none";
  const bandBg = band === "green" ? "#0E7C52" : band === "navy" ? "#12324B" : null;

  const imageHtml = content.imageUrl
    ? `<img src="${escapeHtml(content.imageUrl)}" alt="" style="width:100%;display:block;margin:0 0 16px;border-radius:8px" />`
    : "";

  const headlineHtml = bandBg
    ? `<div style="background:${bandBg};padding:16px 20px;border-radius:8px;margin:0 0 16px"><h2 style="color:#ffffff;margin:0">${escapeHtml(content.headline)}</h2></div>`
    : `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(content.headline)}</h2>`;

  const bodyParagraphs = content.bodyText
    .split(/\n\s*\n/)
    .filter((para) => para.trim().length > 0)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const buttonHtml =
    content.buttonText && content.buttonUrl
      ? `<p style="margin-top:20px"><a href="${escapeHtml(content.buttonUrl)}" style="background:#0E7C52;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(content.buttonText)}</a></p>`
      : "";

  const footerNoteHtml = content.footerNote
    ? `<p style="color:#5b6b78;font-size:13px;margin-top:4px">${escapeHtml(content.footerNote)}</p>`
    : "";

  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5;max-width:600px">` +
    imageHtml +
    headlineHtml +
    bodyParagraphs +
    buttonHtml +
    `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
    `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
    footerNoteHtml +
    `</div>`
  );
}
