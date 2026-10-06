import { notFound } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadCollection, loadPharmacies } from "@/lib/pharmacy-collection/load";
import { choosePharmacyAction, newCodeAction } from "@/lib/pharmacy-collection/actions";
import { asNotice, viewFor, type PharmacyOption } from "@/lib/pharmacy-collection/model";
import { FlashClean } from "@/components/go-live/flash-clean";

export const metadata = { title: "Collect your medicine" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "");
const button = "rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-navy";

function Chooser({ id, options, locale }: { id: string; options: PharmacyOption[]; locale: ReturnType<typeof resolveUiLanguage> }) {
  if (options.length === 0) return <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.none", locale)}</p>;
  return (
    <ul className="space-y-3">
      {options.map((o) => (
        <li key={o.location_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <div>
            <p className="font-semibold text-charcoal-ink">{o.partner_name}</p>
            <p className="text-sm text-charcoal-ink/70">{[o.location_name, o.address, o.state].filter(Boolean).join(", ")}</p>
          </div>
          <form action={choosePharmacyAction}>
            <input type="hidden" name="prescription" value={id} />
            <input type="hidden" name="partner" value={o.partner_id} />
            <input type="hidden" name="location" value={o.location_id} />
            <button type="submit" className={button}>{t("pharmcollect.pick", locale)}</button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/**
 * S28 (spec 9.6, 8.9): the patient picks a verified pharmacy to collect a signed prescription from and reads her collection code.
 * Collection only, no delivery, no payment here (she pays the pharmacy). The database decides everything; this page only shows it.
 */
export default async function CollectPage({ params, searchParams }: { params: Promise<{ prescriptionId: string }>; searchParams: Promise<{ n?: string }> }) {
  const { prescriptionId } = await params;
  if (!UUID.test(prescriptionId)) notFound();
  const profile = await getCurrentProfile();
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  const notice = asNotice((await searchParams).n);
  const collection = await loadCollection(prescriptionId);
  const view = collection.ok && collection.data ? viewFor(collection.data) : null;
  const pharmacies = view === "choose" || view === "code" ? await loadPharmacies(prescriptionId) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FlashClean />
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmcollect.title", locale)}</h2>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t("pharmcollect.intro", locale)}</p>
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "chosen" || notice === "new_code" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          {t(`pharmcollect.notice.${notice}`, locale)}
        </p>
      )}
      {!collection.ok || (collection.ok && !collection.data) ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>
      ) : view === "choose" ? (
        <section className="space-y-3">
          <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.choose", locale)}</h3>
          {pharmacies?.ok ? <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} /> : <p role="alert" className="text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>}
        </section>
      ) : view === "code" ? (
        <section className="space-y-4">
          <p className="font-semibold text-charcoal-ink">
            {t("pharmcollect.sent_to", locale, { pharmacy: [collection.data?.pharmacy_name, collection.data?.location_name].filter(Boolean).join(", ") })}
          </p>
          {collection.data?.address && <p className="text-sm text-charcoal-ink/70">{collection.data.address}</p>}
          <div className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/60">{t("pharmcollect.code_label", locale)}</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em] text-charcoal-ink" aria-label={t("pharmcollect.code_label", locale)}>
              {collection.data?.code ?? "-"}
            </p>
            <p className="mt-2 text-xs text-charcoal-ink/60">{t("pharmcollect.code_hint", locale)}</p>
            {collection.data?.code_expires_at && <p className="mt-1 text-xs text-charcoal-ink/60">{t("pharmcollect.valid_until", locale, { date: lagos(collection.data.code_expires_at) })}</p>}
          </div>
          {(collection.data?.locked || collection.data?.expired) && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{collection.data.locked ? t("pharmcollect.locked", locale) : t("pharmcollect.expired", locale)}</p>
          )}
          <form action={newCodeAction}>
            <input type="hidden" name="prescription" value={prescriptionId} />
            <button type="submit" className={button}>{t("pharmcollect.new_code", locale)}</button>
          </form>
          <section className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.change", locale)}</h3>
            <p className="text-xs text-charcoal-ink/60">{t("pharmcollect.change_hint", locale)}</p>
            {pharmacies?.ok && <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} />}
          </section>
        </section>
      ) : view === "collected" ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("pharmcollect.collected", locale)}</p>
      ) : (
        <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.not_open", locale)}</p>
      )}
    </div>
  );
}
