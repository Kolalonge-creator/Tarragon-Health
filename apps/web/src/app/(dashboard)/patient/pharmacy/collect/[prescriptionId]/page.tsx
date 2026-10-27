import { notFound } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { stockLine } from "@tarragon/medicines";
import { loadRunwayConfig } from "@/lib/medicines/runway-config";
import { loadCollection, loadHasControlledItem, loadOverview, loadPharmacies, loadSuggestion, loadVisit } from "@/lib/pharmacy-collection/load";
import { acceptSuggestionAction, choosePharmacyAction, declineSuggestionAction, newCodeAction, newVisitCodeAction, withdrawAction } from "@/lib/pharmacy-collection/actions";
import { alsoSendable, asNotice, viewFor, type OverviewItem, type PharmacyOption, type Suggestion, type VisitMember } from "@/lib/pharmacy-collection/model";
import { FlashClean } from "@/components/go-live/flash-clean";
import { PharmacyChatCard } from "@/components/partner-portal/pharmacy-chat-card";

export const metadata = { title: "Collect your medicine" };
export const dynamic = "force-dynamic";

/** The clock is read outside the component body (react-hooks/purity); the page is dynamic, so it is read on every request. */
function clockMs(): number {
  return Date.now();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "");
const button = "rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-navy";

/**
 * One form: a button per pharmacy and, when she has other medicines waiting to be sent, a tick box for each (S28e, OQ-275). Ticked ones go to the
 * same pharmacy under ONE collection code; the pharmacy still checks each medicine on its own. With no ticks it is the same single choice as before.
 */
function Chooser({ id, options, locale, forWhom, others }: { id: string; options: PharmacyOption[]; locale: typeof DEFAULT_UI_LANGUAGE; forWhom?: string; others: OverviewItem[] }) {
  if (options.length === 0) return <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.none", locale)}</p>;
  return (
    <form action={choosePharmacyAction} className="space-y-3">
      {/* The first submit button in a form is its default one: pressing Enter on a tick box would otherwise press the first pharmacy for her. A disabled
          default button makes Enter do nothing; only a pharmacy button she presses sends anything. */}
      <button type="submit" disabled aria-hidden="true" tabIndex={-1} className="hidden" />
      <input type="hidden" name="prescription" value={id} />
      {forWhom && <input type="hidden" name="for" value={forWhom} />}
      {others.length > 0 && (
        <fieldset className="space-y-1 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
          <legend className="px-1 font-semibold text-charcoal-ink">{t("pharmvisit.also_title", locale)}</legend>
          <p className="text-xs text-charcoal-ink/60">{t("pharmvisit.also_hint", locale)}</p>
          {others.map((o) => (
            <div key={o.prescription_id}>
              <label className="flex min-h-11 items-center gap-2 text-sm text-charcoal-ink">
                <input type="checkbox" name="also" value={o.prescription_id} />
                {o.medicine ?? "-"}
              </label>
              {/* OQ-276: the same plain note as for the page's own prescription, so she is told before she sends a controlled medicine, not at the counter */}
              {o.controlled ? <p className="pl-6 text-xs text-amber-900">{t("pharmvisit.controlled_item", locale)}</p> : null}
            </div>
          ))}
        </fieldset>
      )}
      <ul className="space-y-3">
        {options.map((o) => (
          <li key={o.location_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
            <div>
              <p className="font-semibold text-charcoal-ink">{o.partner_name}</p>
              <p className="text-sm text-charcoal-ink/70">{[o.location_name, o.address, o.state].filter(Boolean).join(", ")}</p>
            </div>
            <button type="submit" name="choice" value={`${o.partner_id}:${o.location_id}`} className={button}>{t("pharmcollect.pick", locale)}</button>
          </li>
        ))}
      </ul>
    </form>
  );
}

/**
 * S28e: what the pharmacy has said about stock, as a plain yes. There is no "no" here: a no is the "your pharmacy could not supply this" notice
 * below, which sends her to another pharmacy. No price is shown (OQ-283).
 */
function StockLine({ at, locale, nowMs }: { at: string | null; locale: Locale; nowMs: number }) {
  // Item 9: an answer older than the versioned limit (medicines.runway_and_stock_freshness) is never shown as available.
  const limits = loadRunwayConfig();
  const line = stockLine(at ? Date.parse(at) : null, nowMs, limits);
  if (line.kind === "ask_pharmacy") {
    return <p className="text-xs text-charcoal-ink/70">{t("pharmvisit.stock_ask", locale, { hours: limits.maxStockAgeHours })}</p>;
  }
  return (
    <p className="text-xs text-charcoal-ink/70">
      {at ? t("pharmvisit.stock_confirmed", locale, { date: lagos(at) }) : t("pharmvisit.stock_unknown", locale)} {at ? t("pharmvisit.stock_caveat", locale) : ""}
    </p>
  );
}

/** The medicines that share this visit's code, each with its own state. Shown only when the prescription was sent together with others. */
function VisitMembers({ members, thisId, locale, nowMs }: { members: VisitMember[]; thisId: string; locale: Locale; nowMs: number }) {
  if (members.length < 2) return null;
  return (
    <section aria-labelledby="visit-title" className="space-y-2 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
      <h3 id="visit-title" className="font-semibold text-charcoal-ink">{t("pharmvisit.covers", locale, { count: members.length })}</h3>
      <ul className="space-y-1 text-sm text-charcoal-ink">
        {members.map((m) => (
          <li key={m.prescription_id}>
            <span className={m.prescription_id === thisId ? "font-semibold" : ""}>{m.medicine ?? "-"}</span>
            {" "}<span className="text-charcoal-ink/70">{m.collected || m.state === "dispensed" ? t("pharmvisit.collected", locale) : m.other_pharmacy_needed ? t("pharmvisit.other_needed", locale) : t("pharmvisit.waiting", locale)}</span>
            {!m.collected && m.state === "sent" && !m.other_pharmacy_needed && <StockLine at={m.stock_confirmed_at} locale={locale} nowMs={nowMs} />}
          </li>
        ))}
      </ul>
      <p className="text-xs text-charcoal-ink/60">{t("pharmvisit.new_code_hint", locale)}</p>
    </section>
  );
}

/**
 * S54c: the pharmacy the care team suggested. It is only a suggestion: it says so, nothing is sent until she presses the button, and the
 * other ways (choose another, decline, take it anywhere) are always there. No price, ranking or earning is shown or implied here.
 */
function SuggestionCard({ id, suggestion, locale }: { id: string; suggestion: Suggestion; locale: Locale }) {
  return (
    <section aria-labelledby="suggestion-title" className="space-y-3 rounded-xl border border-brand-green/40 bg-emerald-50 p-4 dark:border-night-ink/25">
      <h3 id="suggestion-title" className="font-semibold text-charcoal-ink">{t("pharmsuggest.title", locale, { pharmacy: suggestion.partner_name })}</h3>
      <p className="text-sm text-charcoal-ink/70">{[suggestion.location_name, suggestion.address, suggestion.state].filter(Boolean).join(", ")}</p>
      <p className="text-xs text-charcoal-ink/70">{t("pharmsuggest.hint", locale)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <form action={acceptSuggestionAction}>
          <input type="hidden" name="prescription" value={id} />
          <input type="hidden" name="suggestion" value={suggestion.suggestion_id} />
          <button type="submit" className={button}>{t("pharmsuggest.accept", locale)}</button>
        </form>
        <a href="#chooser" className="text-sm font-semibold text-clinical-navy underline">{t("pharmsuggest.another", locale)}</a>
        <form action={declineSuggestionAction}>
          <input type="hidden" name="prescription" value={id} />
          <input type="hidden" name="suggestion" value={suggestion.suggestion_id} />
          <button type="submit" className="text-sm text-charcoal-ink/70 underline">{t("pharmsuggest.decline", locale)}</button>
        </form>
      </div>
    </section>
  );
}

/**
 * S28 (spec 9.6, 8.9): the patient picks a verified pharmacy to collect a signed prescription from and reads her collection code.
 * Collection only, no delivery, no payment here (she pays the pharmacy). The database decides everything; this page only shows it.
 */
export default async function CollectPage({ params, searchParams }: { params: Promise<{ prescriptionId: string }>; searchParams: Promise<{ n?: string; for?: string }> }) {
  const { prescriptionId } = await params;
  if (!UUID.test(prescriptionId)) notFound();
  const locale = DEFAULT_UI_LANGUAGE;
  const nowMs = clockMs();
  const query = await searchParams;
  const notice = asNotice(query.n);
  // `for` is the person a caregiver acts for; anything that is not an id is ignored, and the database checks the permission on every call
  const forWhom = query.for && UUID.test(query.for) ? query.for : undefined;
  const collection = await loadCollection(prescriptionId, forWhom);
  if (collection.ok && !collection.data) notFound();
  const view = collection.ok && collection.data ? viewFor(collection.data) : null;
  const off = !collection.ok && collection.off === true;
  const wantsChooser = view === "choose" || view === "code" || view === "repeat";
  // The reads below do not depend on each other, so they run together. A failed read of the suggestion just means the card is not shown (she can still
  // choose or take the prescription anywhere); OQ-276: a plain note before choosing, for a prescription that includes a controlled medicine (the
  // patient may still go ahead; the counter refuses it); S28e: her other waiting medicines (the tick boxes) and her own stock line.
  const [pharmacies, suggestion, controlledNote, overview] = await Promise.all([
    wantsChooser ? loadPharmacies(prescriptionId, forWhom) : null,
    view === "choose" ? loadSuggestion(prescriptionId) : null,
    wantsChooser ? loadHasControlledItem(prescriptionId, forWhom) : false,
    wantsChooser ? loadOverview(forWhom) : null,
  ]);
  const others: OverviewItem[] = overview?.ok ? alsoSendable(overview.data, prescriptionId) : [];
  const own = overview?.ok ? overview.data.find((i) => i.prescription_id === prescriptionId) ?? null : null;
  const visit = view === "code" && own?.visit_id ? await loadVisit(prescriptionId, forWhom) : null;
  const visitMembers: VisitMember[] = visit?.ok ? visit.data : [];
  // A failed extras read is said out loud, never shown as "nothing else is waiting" or "only this medicine": the page still works without it.
  const extrasFailed = overview !== null && !overview.ok && !overview.off;
  const membersFailed = visit !== null && !visit.ok;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FlashClean />
      <div>
        <h2 className="font-heading text-xl font-semibold text-charcoal-ink">{t("pharmcollect.title", locale)}</h2>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t("pharmcollect.intro", locale)}</p>
      </div>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice === "chosen" || notice === "chosen_many" || notice === "new_code" || notice === "withdrawn" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
          {t(`pharmcollect.notice.${notice}`, locale)}
        </p>
      )}
      {!off && extrasFailed && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmvisit.extras_failed", locale)}</p>}
      {!off && membersFailed && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmvisit.members_failed", locale)}</p>}
      {off ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmcollect.off", locale)}</p>
      ) : !collection.ok || (collection.ok && !collection.data) ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>
      ) : view === "choose" ? (
        <section className="space-y-3">
          {suggestion?.ok && suggestion.data ? <SuggestionCard id={prescriptionId} suggestion={suggestion.data} locale={locale} /> : null}
          <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.any_pharmacy", locale)}</p>
          <h3 id="chooser" className="font-semibold text-charcoal-ink">{t("pharmcollect.choose", locale)}</h3>
          {controlledNote && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmcollect.controlled_note", locale)}</p>}
          {pharmacies?.ok ? <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} forWhom={forWhom} others={others} /> : <p role="alert" className="text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>}
        </section>
      ) : view === "repeat" ? (
        <section className="space-y-3">
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("pharmcollect.collected", locale)}</p>
          <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.repeat", locale)}</h3>
          {controlledNote && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmcollect.controlled_note", locale)}</p>}
          <p className="text-xs text-charcoal-ink/60">{t("pharmcollect.repeat_hint", locale)}</p>
          {pharmacies?.ok ? <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} forWhom={forWhom} others={others} /> : <p role="alert" className="text-sm text-red-900">{t("pharmcollect.load_failed", locale)}</p>}
        </section>
      ) : view === "code" ? (
        <section className="space-y-4">
          {controlledNote && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmcollect.controlled_note", locale)}</p>}
          <p className="font-semibold text-charcoal-ink">
            {t("pharmcollect.sent_to", locale, { pharmacy: [collection.data?.pharmacy_name, collection.data?.location_name].filter(Boolean).join(", ") })}
          </p>
          {collection.data?.address && <p className="text-sm text-charcoal-ink/70">{collection.data.address}</p>}
          <p className="text-xs text-charcoal-ink/60">{t("medicines.mas.collect_prompt", locale)} {t("medicines.mas.caveat", locale)}</p>
          <div className="rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/25">
            <p className="text-xs uppercase tracking-wide text-charcoal-ink/60">{t("pharmcollect.code_label", locale)}</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em] text-charcoal-ink" aria-label={t("pharmcollect.code_label", locale)}>
              {collection.data?.code ?? "-"}
            </p>
            <p className="mt-2 text-xs text-charcoal-ink/60">{t("pharmcollect.code_hint", locale)}</p>
            {collection.data?.code_expires_at && <p className="mt-1 text-xs text-charcoal-ink/60">{t("pharmcollect.valid_until", locale, { date: lagos(collection.data.code_expires_at) })}</p>}
          </div>
          {collection.data?.other_pharmacy_needed ? (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("pharmcollect.other_needed", locale)}</p>
          ) : (
            visitMembers.length < 2 && own && <StockLine at={own.stock_confirmed_at} locale={locale} nowMs={nowMs} />
          )}
          <VisitMembers members={visitMembers} thisId={prescriptionId} locale={locale} nowMs={nowMs} />
          {/* the visit's lock is the authority for every medicine sent together, so her overview (which reads it) wins over the single-prescription flag */}
          {(own?.locked || collection.data?.locked || collection.data?.expired) && (
            <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{own?.locked || collection.data?.locked ? t("pharmcollect.locked", locale) : t("pharmcollect.expired", locale)}</p>
          )}
          <div className="flex flex-wrap gap-3">
            <form action={newCodeAction}>
              <input type="hidden" name="prescription" value={prescriptionId} />
              {forWhom && <input type="hidden" name="for" value={forWhom} />}
              <button type="submit" className={button}>{t("pharmcollect.new_code", locale)}</button>
            </form>
            {visitMembers.length >= 2 && (
              <form action={newVisitCodeAction}>
                <input type="hidden" name="prescription" value={prescriptionId} />
                {forWhom && <input type="hidden" name="for" value={forWhom} />}
                <button type="submit" className={button}>{t("pharmvisit.new_code_all", locale)}</button>
              </form>
            )}
          </div>
          <section className="space-y-3 border-t border-charcoal-ink/10 pt-4">
            <h3 className="font-semibold text-charcoal-ink">{t("pharmcollect.change", locale)}</h3>
            <p className="text-xs text-charcoal-ink/60">{t("pharmcollect.change_hint", locale)}</p>
            {pharmacies?.ok && <Chooser id={prescriptionId} options={pharmacies.data} locale={locale} forWhom={forWhom} others={others} />}
          </section>
          <section className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs text-charcoal-ink/60">{t("pharmcollect.withdraw_hint", locale)}</p>
            <form action={withdrawAction}>
              <input type="hidden" name="prescription" value={prescriptionId} />
              {forWhom && <input type="hidden" name="for" value={forWhom} />}
              <button type="submit" className="rounded-lg border border-clinical-navy px-3 py-1.5 text-sm font-semibold text-clinical-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clinical-navy">{t("pharmcollect.withdraw", locale)}</button>
            </form>
          </section>
        </section>
      ) : view === "collected" ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("pharmcollect.collected", locale)}</p>
      ) : (
        <p className="text-sm text-charcoal-ink/70">{t("pharmcollect.not_open", locale)}</p>
      )}
      {/* S74 (21.2): the in-app conversation with the pharmacy, once the prescription is with one. The patient only; a caregiver acting for the patient does not see it. */}
      {!off && !forWhom && collection.ok && collection.data && (view === "code" || view === "collected" || view === "repeat") && (
        <PharmacyChatCard prescriptionId={prescriptionId} locale={locale} />
      )}
    </div>
  );
}
