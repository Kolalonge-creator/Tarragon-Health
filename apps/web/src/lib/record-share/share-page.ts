/**
 * The public page behind a record share link (S43, spec 2.8): status mapping and
 * HTML. Pure functions, no I/O, so the rules that matter are testable.
 *
 * WHY HTML BY HAND, NOT A NEXT PAGE. A Next.js page cannot choose its HTTP status:
 * an expired link would answer 200 with a "this has expired" paragraph, or 404.
 * The spec says an expired link returns 410 and logs the attempt, and a facility's
 * system or a link checker reads the status, not the paragraph. A route handler
 * can answer 410, 401 (PIN needed), 423 (locked) and 404 honestly.
 *
 * Everything a person can control (their name, a medicine, a facility) goes through
 * esc(). The response carries a CSP that allows no script at all.
 */

import { t, type MessageKey } from "@tarragon/i18n";

export type ShareOpenResult =
  | { status: "ok"; record: SharedRecord }
  /** A plain GET (a preview): the link is live and needs no PIN. Nothing was counted and nothing is shown until a person presses the button. */
  | { status: "ready"; views_left?: number | null }
  | { status: "gone"; reason: "expired" | "revoked" | "view_cap" }
  | { status: "pin_required" }
  | { status: "pin_wrong"; attempts_left?: number }
  | { status: "locked" }
  | { status: "not_found" };

export interface SharedRecord {
  full_name: string;
  shared_at: string;
  expires_at: string;
  sections: string[];
  views_left?: number | null;
  vitals?: Array<{
    vital_type: string;
    systolic: number | null;
    diastolic: number | null;
    pulse_bpm: number | null;
    glucose_mmol: number | null;
    weight_kg: number | null;
    temperature_c: number | null;
    spo2_pct: number | null;
    source: string;
    taken_at: string;
  }>;
  medications?: Array<{ drug_name: string; dose: string | null; frequency: string | null; is_active: boolean }>;
  conditions?: string[];
  allergies?: Array<{ allergen: string; reaction: string | null; severity: string | null }>;
  lab_results?: Array<{
    code: string;
    value: number | null;
    value_text: string | null;
    unit: string | null;
    reference_range_text: string | null;
    abnormal_flag: string | null;
    taken_at: string;
    laboratory: string | null;
  }>;
  vaccinations?: Array<{ vaccine_name: string | null; date_administered: string | null; dose_number: number | null; batch_number: string | null; verified?: boolean }>;
  procedures?: Array<{ name: string; performed_on: string | null; approximate_year: number | null; facility: string | null; verified_by_clinician: boolean }>;
  family_history?: Array<{ condition_name: string; relationship: string; age_of_onset_years: number | null; verified_by_clinician: boolean }>;
  emergency_info?: {
    blood: { blood_group: string | null; genotype: string | null; source: string | null } | null;
    emergency_contact: { name: string; phone: string; relationship: string | null } | null;
  };
}

/** The HTTP status a facility's system sees. 410 for anything that was valid and no longer is. */
export function httpStatusFor(r: ShareOpenResult): number {
  switch (r.status) {
    case "ok":
    case "ready":
      return 200;
    case "gone":
      return 410;
    case "pin_required":
    case "pin_wrong":
      return 401;
    case "locked":
      return 423;
    case "not_found":
      return 404;
  }
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}
function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
}

const SOURCE_KEYS = ["manual", "device", "wearable", "cgm", "fhir_import"] as const;
/** What stands behind a reading, in plain words: a wearable reading is an estimate, never presented as a measurement. */
function sourceLabel(source: string): string {
  return (SOURCE_KEYS as readonly string[]).includes(source) ? t(`share.public.source.${source}` as MessageKey, "en") : source;
}

type Vital = NonNullable<SharedRecord["vitals"]>[number];
function vitalText(v: Vital): string {
  switch (v.vital_type) {
    case "blood_pressure":
      return `${v.systolic ?? "-"}/${v.diastolic ?? "-"} mmHg${v.pulse_bpm ? ` (pulse ${v.pulse_bpm})` : ""}`;
    case "glucose":
      return `${v.glucose_mmol ?? "-"} mmol/L`;
    case "weight":
      return `${v.weight_kg ?? "-"} kg`;
    case "temperature":
      return `${v.temperature_c ?? "-"} C`;
    case "spo2":
      return `${v.spo2_pct ?? "-"}%`;
    case "pulse":
      return `${v.pulse_bpm ?? "-"} bpm`;
    default:
      return "-";
  }
}

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#1c2a25;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:34rem;margin:0 auto;padding:1.25rem}
.brand{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#0e7c52;margin:0}
h1{font-size:1.25rem;margin:.25rem 0 .25rem}h2{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#5b6b64;margin:1.5rem 0 .5rem}
.muted{color:#5b6b64;font-size:.875rem;margin:.1rem 0}.row{display:flex;justify-content:space-between;gap:.75rem;border:1px solid #dfe7e3;border-radius:.5rem;padding:.5rem .75rem;margin:.4rem 0}
.row small{color:#5b6b64;white-space:nowrap}.tag{display:inline-block;border:1px solid #dfe7e3;border-radius:999px;padding:.1rem .65rem;margin:.15rem .25rem .15rem 0;font-size:.875rem}
.alert{border-color:#f3b4b4;background:#fdf1f1}.flag{color:#b42318;font-weight:600;font-size:.8rem}.ok{color:#0e7c52;font-size:.8rem}
form{margin-top:1rem}input[type=password],input[type=text]{font:inherit;padding:.6rem .75rem;border:1px solid #9fb0a8;border-radius:.5rem;width:100%;max-width:14rem}
button{font:inherit;margin-top:.75rem;padding:.6rem 1rem;border:0;border-radius:.5rem;background:#0e7c52;color:#fff;cursor:pointer}
footer{margin-top:2rem;border-top:1px solid #dfe7e3;padding-top:.75rem}
@media (prefers-color-scheme:dark){body{background:#0f1714;color:#e6efe9}.muted,h2,.row small{color:#9fb0a8}.row,.tag,footer{border-color:#2a3a33}.alert{background:#2a1515;border-color:#6b2a2a}}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;
}

function msg(key: MessageKey, params?: Record<string, string>): string {
  return esc(t(key, "en", params));
}

function stateBody(r: Exclude<ShareOpenResult, { status: "ok" }>, token: string): string {
  const brand = `<p class="brand">TarragonHealth</p>`;
  switch (r.status) {
    case "ready":
      // Opening is a deliberate act: a POST from this button. A link-preview bot or mail scanner only ever GETs, so it reads nothing and spends no view.
      return `${brand}<h1>${msg("share.public.ready_title")}</h1><p class="muted">${msg("share.public.ready_body")}</p>${
        typeof r.views_left === "number" ? `<p class="muted">${msg("share.public.views_left", { count: String(Math.max(r.views_left, 0)) })}</p>` : ""
      }<form method="post" action="/share/${esc(encodeURIComponent(token))}"><button type="submit">${msg("share.public.ready_button")}</button></form>`;
    case "gone":
      return `${brand}<h1>${msg("share.public.gone_title")}</h1><p class="muted">${msg(`share.public.gone.${r.reason}` as MessageKey)}</p>`;
    case "locked":
      return `${brand}<h1>${msg("share.public.locked_title")}</h1><p class="muted">${msg("share.public.locked_body")}</p>`;
    case "not_found":
      return `${brand}<h1>${msg("share.public.not_available_title")}</h1><p class="muted">${msg("share.public.not_available")}</p>`;
    case "pin_required":
    case "pin_wrong": {
      const wrong =
        r.status === "pin_wrong"
          ? `<p class="flag" role="alert">${msg("share.public.pin_wrong")}${typeof r.attempts_left === "number" ? ` ${msg("share.public.pin_left", { count: String(r.attempts_left) })}` : ""}</p>`
          : "";
      // The PIN travels in a POST body, never in the URL, so it is not left in history or logs.
      return `${brand}<h1>${msg("share.public.pin_title")}</h1><p class="muted">${msg("share.public.pin_body")}</p>${wrong}<form method="post" action="/share/${esc(encodeURIComponent(token))}"><label for="pin" class="muted">${msg("share.public.pin_label")}</label><br><input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required><br><button type="submit">${msg("share.public.pin_submit")}</button></form>`;
    }
  }
}

function section(title: string, inner: string): string {
  return `<h2>${esc(title)}</h2>${inner}`;
}

function recordBody(rec: SharedRecord): string {
  const parts: string[] = [];
  parts.push(
    `<header><p class="brand">TarragonHealth</p><h1>${msg("share.public.title")}</h1><p class="muted">${msg("share.public.shared_by", { name: rec.full_name })}</p><p class="muted">${msg("share.public.expires", { date: fmtDate(rec.expires_at) })}</p>${
      typeof rec.views_left === "number" ? `<p class="muted">${msg("share.public.views_left", { count: String(Math.max(rec.views_left, 0)) })}</p>` : ""
    }</header>`
  );
  if (rec.vitals?.length) {
    parts.push(
      section(
        t("share.sections.vitals", "en"),
        rec.vitals
          .map(
            (v) =>
              `<div class="row"><span><strong>${esc(v.vital_type.replace(/_/g, " "))}</strong> ${esc(vitalText(v))} <small>(${esc(sourceLabel(v.source))})</small></span><small>${esc(fmtDateTime(v.taken_at))}</small></div>`
          )
          .join("")
      )
    );
  }
  if (rec.medications?.length) {
    parts.push(
      section(
        t("share.sections.medications", "en"),
        rec.medications
          .map((m) => `<div class="row"><span><strong>${esc(m.drug_name)}</strong> ${esc(m.dose ?? "")}${m.frequency ? ` <small>(${esc(m.frequency)})</small>` : ""}</span></div>`)
          .join("")
      )
    );
  }
  if (rec.conditions?.length) {
    parts.push(section(t("share.sections.conditions", "en"), rec.conditions.map((c) => `<span class="tag">${esc(c.replace(/_/g, " "))}</span>`).join("")));
  }
  if (rec.allergies?.length) {
    parts.push(
      section(
        t("share.sections.allergies", "en"),
        rec.allergies
          .map((a) => `<div class="row alert"><span><strong>${esc(a.allergen)}</strong> ${esc(a.reaction ?? "")}${a.severity ? ` <span class="flag">${esc(a.severity)}</span>` : ""}</span></div>`)
          .join("")
      )
    );
  }
  if (rec.lab_results?.length) {
    parts.push(
      section(
        t("share.sections.lab_results", "en"),
        rec.lab_results
          .map(
            (l) =>
              `<div class="row"><span><strong>${esc(l.code)}</strong> ${esc(l.value_text ?? l.value ?? "-")} ${esc(l.unit ?? "")}${l.reference_range_text ? ` <small>(ref ${esc(l.reference_range_text)})</small>` : ""}${l.abnormal_flag && l.abnormal_flag !== "normal" ? ` <span class="flag">${esc(l.abnormal_flag)}</span>` : ""}</span><small>${esc(fmtDate(l.taken_at))}</small></div>`
          )
          .join("")
      )
    );
  }
  if (rec.vaccinations?.length) {
    parts.push(
      section(
        t("share.sections.vaccinations", "en"),
        rec.vaccinations
          .map(
            (v) =>
              `<div class="row"><span><strong>${esc(v.vaccine_name ?? "Vaccine")}</strong>${v.dose_number ? ` dose ${esc(v.dose_number)}` : ""}${v.batch_number ? ` <small>batch ${esc(v.batch_number)}</small>` : ""}${v.verified ? ` <span class="ok">${msg("share.public.verified")}</span>` : ""}</span><small>${esc(fmtDate(v.date_administered))}</small></div>`
          )
          .join("")
      )
    );
  }
  if (rec.procedures?.length) {
    parts.push(
      section(
        t("share.sections.procedures", "en"),
        rec.procedures
          .map(
            (p) =>
              `<div class="row"><span><strong>${esc(p.name)}</strong>${p.facility ? ` <small>${esc(p.facility)}</small>` : ""}${p.verified_by_clinician ? ` <span class="ok">${msg("share.public.verified")}</span>` : ""}</span><small>${esc(p.performed_on ? fmtDate(p.performed_on) : (p.approximate_year ?? ""))}</small></div>`
          )
          .join("")
      )
    );
  }
  if (rec.family_history?.length) {
    parts.push(
      section(
        t("share.sections.family_history", "en"),
        rec.family_history
          .map(
            (f) =>
              `<div class="row"><span><strong>${esc(f.condition_name)}</strong> <small>${esc(f.relationship.replace(/_/g, " "))}${f.age_of_onset_years ? `, from age ${esc(f.age_of_onset_years)}` : ""}</small>${f.verified_by_clinician ? ` <span class="ok">${msg("share.public.verified")}</span>` : ""}</span></div>`
          )
          .join("")
      )
    );
  }
  const em = rec.emergency_info;
  if (em && (em.blood || em.emergency_contact)) {
    const lines: string[] = [];
    if (em.blood) lines.push(`<div class="row"><span>${msg("share.public.blood")}: <strong>${esc(em.blood.blood_group ?? "-")}</strong> / ${esc(em.blood.genotype ?? "-")}</span></div>`);
    if (em.emergency_contact) {
      lines.push(`<div class="row"><span>${msg("share.public.contact")}: <strong>${esc(em.emergency_contact.name)}</strong> ${esc(em.emergency_contact.phone)}${em.emergency_contact.relationship ? ` <small>(${esc(em.emergency_contact.relationship)})</small>` : ""}</span></div>`);
    }
    parts.push(section(t("share.sections.emergency_info", "en"), lines.join("")));
  }
  parts.push(`<footer><p class="muted">${msg("share.public.disclaimer")}</p></footer>`);
  return parts.join("");
}

export function renderSharePage(result: ShareOpenResult, token: string): string {
  if (result.status === "ok") return shell(t("share.public.title", "en"), recordBody(result.record));
  return shell(t("share.public.title", "en"), stateBody(result, token));
}

/** Headers for every response from the door: no caching, no referrer, no indexing, no script. */
export function shareHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

/** Narrow whatever the database returned to a ShareOpenResult. Anything unrecognised reads as not found (the safe direction). */
export function parseOpenResult(data: unknown): ShareOpenResult {
  if (!data || typeof data !== "object") return { status: "not_found" };
  const d = data as Record<string, unknown>;
  switch (d.status) {
    case "ok":
      return d.record && typeof d.record === "object" ? { status: "ok", record: d.record as SharedRecord } : { status: "not_found" };
    case "gone":
      return { status: "gone", reason: d.reason === "revoked" || d.reason === "view_cap" ? d.reason : "expired" };
    case "ready":
      return { status: "ready", views_left: typeof d.views_left === "number" ? d.views_left : null };
    case "pin_required":
      return { status: "pin_required" };
    case "pin_wrong":
      return { status: "pin_wrong", attempts_left: typeof d.attempts_left === "number" ? d.attempts_left : undefined };
    case "locked":
      return { status: "locked" };
    default:
      return { status: "not_found" };
  }
}
