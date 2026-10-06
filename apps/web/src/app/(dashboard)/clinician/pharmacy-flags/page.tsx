import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadPrescriberFlags } from "@/lib/pharmacy-flags/load";
import { itemLine, kindKey } from "@/lib/pharmacy-flags/model";

export const metadata = { title: "Pharmacy messages" };
export const dynamic = "force-dynamic";

const lagos = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * S36h: the prescriber's side of a pharmacy flag. Reading is a logged clinical read (INV-10, one audit row per page view); the function shows only
 * flags on prescriptions this clinician signed or for patients they are tied to. Read only: nothing here changes a prescription.
 */
export default async function PharmacyFlagsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "clinician") redirect("/clinician");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  const flags = await loadPrescriberFlags();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("pharmflag.clinician.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("pharmflag.clinician.intro", locale)}</p>
      </div>
      {!flags.ok ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmflag.clinician.load_failed", locale)}</p>
      ) : flags.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("pharmflag.clinician.empty", locale)}</p>
      ) : (
        <ul className="space-y-4">
          {flags.data.map((f) => (
            <li key={f.flag_id} className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-charcoal-ink">{f.patient_name ?? "-"}</p>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{t(kindKey(f.kind), locale)}</span>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-charcoal-ink">
                {f.items.map((it, i) => (
                  <li key={i}>{itemLine(it)}</li>
                ))}
              </ul>
              <p className="mt-3 whitespace-pre-wrap text-sm text-charcoal-ink">{f.reason}</p>
              <p className="mt-2 text-xs text-charcoal-ink/60">
                {t("pharmflag.clinician.from", locale, { pharmacy: f.pharmacy_name ?? "-" })} · {lagos(f.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
