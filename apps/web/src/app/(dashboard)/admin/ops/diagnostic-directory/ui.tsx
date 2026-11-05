import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { REGULATORS, type Notice as NoticeCode } from "@/lib/diagnostic-directory/model";

const locale = DEFAULT_UI_LANGUAGE;

export const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
export const input = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
export const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card";

export const lagosDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "-";

export const regulatorLabel = (r: string) =>
  (REGULATORS as readonly string[]).includes(r) ? t(`dxdir.regulator.${r as (typeof REGULATORS)[number]}`, locale) : r;

/** A database eligibility reason code in plain words. Unknown codes are shown as they are rather than hidden. */
export function reasonLabel(code: string): string {
  if (code.startsWith("missing_credential:")) {
    return t("dxdir.reason.missing_credential", locale, { regulator: regulatorLabel(code.slice("missing_credential:".length)) });
  }
  if (code.startsWith("service_") && code !== "service_stale" && code !== "service_incident_open") {
    const status = code.slice("service_".length);
    const known = ["temporarily_unavailable", "external_referral", "awaiting_confirmation", "discontinued"];
    return t("dxdir.reason.service_status", locale, {
      status: known.includes(status) ? t(`dxdir.availability.${status as "discontinued"}`, locale).toLowerCase() : status,
    });
  }
  const known = [
    "provider_not_listed", "provider_incident_open", "branch_not_listed", "branch_closed", "branch_missing_phone",
    "branch_missing_coordinates", "branch_location_unverified", "branch_location_stale", "branch_incident_open", "service_stale",
    "service_incident_open", "performer_unknown", "performer_not_onsite", "performer_ineligible", "performer_chain",
  ] as const;
  return (known as readonly string[]).includes(code) ? t(`dxdir.reason.${code as (typeof known)[number]}`, locale) : code;
}

export function Notice({ notice, bad }: { notice: NoticeCode; bad: boolean }) {
  return (
    <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
      {t(`dxdir.notice.${notice}`, locale)}
    </p>
  );
}

function Field({ name, label, required, type = "text", ...rest }: { name: string; label: string; required?: boolean; type?: string; minLength?: number; maxLength?: number; step?: string; placeholder?: string; pattern?: string }) {
  return (
    <label className="block text-xs text-charcoal-ink">
      {label}
      <input name={name} type={type} required={required} className={input} {...rest} />
    </label>
  );
}

/** The branch fields shared by "add a facility" and "add another branch". */
export function BranchFields() {
  return (
    <>
      <Field name="branch_name" label={t("dxdir.f.branch_name", locale)} required minLength={2} maxLength={160} />
      <Field name="state" label={t("dxdir.f.state", locale)} required minLength={2} maxLength={60} />
      <Field name="town" label={t("dxdir.f.town", locale)} required minLength={2} maxLength={80} />
      <Field name="lga" label={t("dxdir.f.lga", locale)} maxLength={80} />
      <div className="sm:col-span-2">
        <Field name="address" label={t("dxdir.f.address", locale)} required minLength={5} maxLength={300} />
      </div>
      <Field name="phone" label={t("dxdir.f.phone", locale)} type="tel" pattern="^\+[1-9][0-9]{7,14}$" placeholder="+234" />
      <div className="grid grid-cols-2 gap-3">
        <Field name="latitude" label={t("dxdir.f.latitude", locale)} type="number" step="any" />
        <Field name="longitude" label={t("dxdir.f.longitude", locale)} type="number" step="any" />
      </div>
      <p className="text-xs text-charcoal-ink/60 sm:col-span-2">{t("dxdir.f.coords_hint", locale)}</p>
    </>
  );
}
