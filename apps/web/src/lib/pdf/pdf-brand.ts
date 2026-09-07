/**
 * Shared branding constants for react-pdf documents (invoice, lab request,
 * Health Passport). A relative /public path can't be used inside a react-pdf
 * Image — it renders server-side, outside any browser origin — so this is
 * the one real, live app URL (confirmed serving /brand/guard-leaf-mark.png
 * as of 2026-09-07) rather than a per-document guess.
 */
export const PDF_LOGO_URL = "https://app.tarragonhealth.ng/brand/guard-leaf-mark.png";

export const PDF_CONTACT_EMAIL = "admin@tarragonhealth.ng";
