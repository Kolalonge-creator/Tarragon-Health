import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadDiagnosticDetail, loadDiagnosticPartnerships, loadInvestigationOptions } from "@/lib/diagnostic-directory/load";
import {
  asNotice, AVAILABILITY, BAD_NOTICES, CREDENTIAL_STATUSES, LISTING_STATUSES, PERFORMED, REGULATORS,
  type Detail, type DetailBranch, type InvestigationOption, type Partnership,
} from "@/lib/diagnostic-directory/model";
import {
  addBranchAction, branchToDirectoryAction, closeIncidentAction, endPartnerAction, openIncidentAction, recordCredentialAction,
  saveServiceAction, setCredentialStatusAction, setPartnerAction, setStatusAction, verifyLocationAction,
} from "@/lib/diagnostic-directory/actions";
import { BranchFields, btn, card, input, lagosDate, Notice, reasonLabel, regulatorLabel } from "../ui";

export const metadata = { title: "Directory provider" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Diagnostic directory Phase 2b: one provider listing. Every form posts to an admin_dx_* database function, which checks the
 * caller, enforces the rules and writes the audit trail. Each test shows the exact reasons it cannot be recommended yet, straight
 * from private.diagnostic_service_eligibility, so the screen never decides eligibility itself.
 */
export default async function DiagnosticProviderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const notice = asNotice((await searchParams).n);
  const [loaded, options, partners] = await Promise.all([loadDiagnosticDetail(id), loadInvestigationOptions(), loadDiagnosticPartnerships(id)]);
  if (!loaded.ok && loaded.denied) redirect("/admin");
  if (!loaded.ok && loaded.missing) notFound();

  return (
    <div className="space-y-8">
      <Link href="/admin/ops/diagnostic-directory" className="text-sm text-brand-green hover:underline">{t("dxdir.back", locale)}</Link>
      {notice && <FlashClean />}
      {notice && <Notice notice={notice} bad={BAD_NOTICES.has(notice)} />}
      {!loaded.ok || !options.ok || !partners.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("dxdir.load_error", locale)}</p>
      ) : (
        <Provider d={loaded.data} tests={options.data} partners={partners.data} isAdmin={profile.role === "admin"} />
      )}
    </div>
  );
}

function Hidden({ values }: { values: Record<string, string> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

function StatusForm({ listingId, level, targetId, current }: { listingId: string; level: "provider" | "branch"; targetId: string; current: string | null }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.set_status", locale)}</summary>
      <form action={setStatusAction} className="mt-2 grid gap-2 sm:grid-cols-3">
        <Hidden values={{ listing_id: listingId, level, target_id: targetId }} />
        <select name="status" defaultValue={current ?? "draft"} className={input}>
          {LISTING_STATUSES.map((s) => <option key={s} value={s}>{t(`dxdir.status.${s}`, locale)}</option>)}
        </select>
        <input name="reason" required minLength={10} maxLength={500} placeholder={t("dxdir.reason", locale)} className={`${input} sm:col-span-2`} />
        <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.f.save", locale)}</button>
      </form>
    </details>
  );
}

function IncidentForm({ listingId, level, targetId }: { listingId: string; level: "provider" | "branch" | "service"; targetId: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-red-800">{t("dxdir.incident.open", locale)}</summary>
      <form action={openIncidentAction} className="mt-2 space-y-2">
        <Hidden values={{ listing_id: listingId, level, target_id: targetId }} />
        <label className="block text-xs text-charcoal-ink">
          {t("dxdir.incident.severity", locale)}
          <select name="severity" className={input}>
            <option value="serious">{t("dxdir.incident.serious", locale)}</option>
            <option value="routine">{t("dxdir.incident.routine", locale)}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-charcoal-ink">
          <input type="checkbox" name="suspends" /> {t("dxdir.incident.suspends", locale)}
        </label>
        <label className="block text-xs text-charcoal-ink">
          {t("dxdir.incident.description", locale)}
          <textarea name="description" required minLength={20} maxLength={2000} rows={3} className={input} />
        </label>
        <button type="submit" className={`${btn} bg-red-700 text-white`}>{t("dxdir.incident.open", locale)}</button>
      </form>
    </details>
  );
}

function Provider({ d, tests, partners, isAdmin }: { d: Detail; tests: InvestigationOption[]; partners: Partnership[]; isAdmin: boolean }) {
  const listed = d.branches.filter((b) => b.branch_listing_id !== null);
  const unlisted = d.branches.filter((b) => b.branch_listing_id === null);
  return (
    <>
      <section className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{d.name}</h1>
        <p className="text-sm text-charcoal-ink/70">
          {t(`dxdir.kind.${d.kind}`, locale)} · {t(d.contracted ? "dxdir.contracted" : "dxdir.not_contracted", locale)} ·{" "}
          {t("dxdir.provider_status", locale)}: <strong>{t(`dxdir.status.${d.directory_status}`, locale)}</strong>
          {d.status_reason ? ` (${d.status_reason})` : ""}
        </p>
        <StatusForm listingId={d.listing_id} level="provider" targetId={d.listing_id} current={d.directory_status} />
        <IncidentForm listingId={d.listing_id} level="provider" targetId={d.listing_id} />
      </section>

      <section aria-labelledby="dx-branches" className="space-y-3">
        <h2 id="dx-branches" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.branches", locale)}</h2>
        {listed.map((b) => <Branch key={b.location_id} d={d} b={b} tests={tests} partners={partners} isAdmin={isAdmin} />)}
        {unlisted.map((b) => (
          <div key={b.location_id} className={card}>
            <p className="text-sm font-medium text-charcoal-ink">{b.name} <span className="text-xs text-charcoal-ink/60">{b.address}, {b.state} · {t("dxdir.status.not_in_directory", locale)}</span></p>
            <form action={branchToDirectoryAction} className="mt-2 grid gap-2 sm:grid-cols-4">
              <Hidden values={{ listing_id: d.listing_id, location_id: b.location_id }} />
              <input name="town" defaultValue={b.town ?? ""} placeholder={t("dxdir.f.town", locale)} className={input} />
              <input name="lga" placeholder={t("dxdir.f.lga", locale)} className={input} />
              <input name="neighbourhood" placeholder={t("dxdir.f.neighbourhood", locale)} className={input} />
              <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("dxdir.branch.add_to_directory", locale)}</button>
            </form>
          </div>
        ))}
        {!d.contracted && (
          <details className={card}>
            <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.branch.add", locale)}</summary>
            <form action={addBranchAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Hidden values={{ listing_id: d.listing_id }} />
              <BranchFields />
              <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.f.create", locale)}</button>
            </form>
          </details>
        )}
      </section>

      <Credentials d={d} tests={tests} />
      <Incidents d={d} />
      <History d={d} />
    </>
  );
}

function Branch({ d, b, tests, partners, isAdmin }: { d: Detail; b: DetailBranch; tests: InvestigationOption[]; partners: Partnership[]; isAdmin: boolean }) {
  const branchId = b.branch_listing_id as string;
  const siblings = d.branches.filter((x) => x.branch_listing_id && x.branch_listing_id !== branchId);
  return (
    <article className={`${card} space-y-3`}>
      <header className="space-y-1">
        <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
          {b.name} <span className="ml-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`dxdir.status.${b.directory_status ?? "draft"}`, locale)}</span>
        </h3>
        <p className="text-sm text-charcoal-ink/70">
          {[b.address, b.neighbourhood, b.town, b.lga, b.state].filter(Boolean).join(", ")} · {b.phone ?? "-"}
          {b.latitude !== null && b.longitude !== null ? ` · ${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}` : ""}
        </p>
        {!b.open && <p className="text-xs font-semibold text-red-800">{t("dxdir.branch.closed", locale)}</p>}
        <p className="text-xs text-charcoal-ink/70">
          {b.location_verified_at
            ? t("dxdir.branch.location_checked", locale, { date: lagosDate(b.location_verified_at), name: b.location_verified_by ?? "-", source: b.location_source ?? "-" })
            : t("dxdir.branch.location_unchecked", locale)}
        </p>
      </header>

      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.branch.verify_location", locale)}</summary>
        <form action={verifyLocationAction} className="mt-2 space-y-2">
          <Hidden values={{ listing_id: d.listing_id, branch_listing_id: branchId }} />
          <input name="source" required minLength={5} maxLength={200} placeholder={t("dxdir.f.source", locale)} className={input} />
          <input name="note" required minLength={10} maxLength={500} placeholder={t("dxdir.f.note", locale)} className={input} />
          <label className="flex items-center gap-2 text-xs text-charcoal-ink"><input type="checkbox" name="hours_checked" /> {t("dxdir.f.hours_checked", locale)}</label>
          <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("dxdir.f.save", locale)}</button>
        </form>
      </details>
      <StatusForm listingId={d.listing_id} level="branch" targetId={branchId} current={b.directory_status} />
      <IncidentForm listingId={d.listing_id} level="branch" targetId={branchId} />
      <PartnerPanel listingId={d.listing_id} branchId={branchId} rows={partners.filter((x) => x.branch_listing_id === branchId)} isAdmin={isAdmin} />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-charcoal-ink">{t("dxdir.services", locale)}</h4>
        {b.services.length === 0 ? (
          <p className="text-xs text-charcoal-ink/60">{t("dxdir.services.none", locale)}</p>
        ) : (
          <ul className="space-y-2">
            {b.services.map((s) => (
              <li key={s.id} className="rounded-lg border border-charcoal-ink/10 p-2 text-sm">
                <p className="font-medium text-charcoal-ink">
                  {s.test} <span className="text-xs font-normal text-charcoal-ink/60">{t(`dxdir.availability.${s.availability}`, locale)} · {t(`dxdir.performed.${s.performed}`, locale)}</span>
                </p>
                {s.reasons.length === 0 ? (
                  <p className="text-xs font-semibold text-emerald-800">{t("dxdir.service.recommendable", locale)}</p>
                ) : (
                  <p className="text-xs text-amber-900">{t("dxdir.service.not_recommendable", locale)} {s.reasons.map(reasonLabel).join("; ")}</p>
                )}
                <p className="text-xs text-charcoal-ink/60">{t("dxdir.service.confirmed", locale, { date: lagosDate(s.confirmed_at), name: s.confirmed_by ?? "-", source: s.evidence_source })}</p>
                <IncidentForm listingId={d.listing_id} level="service" targetId={s.id} />
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.service.add", locale)}</summary>
          <form action={saveServiceAction} className="mt-2 grid gap-2 sm:grid-cols-2">
            <Hidden values={{ listing_id: d.listing_id, branch_listing_id: branchId }} />
            <label className="block text-xs text-charcoal-ink">{t("dxdir.f.test", locale)}
              <select name="concept_id" required className={input}>
                {tests.map((o) => <option key={o.id} value={o.id}>{o.display}</option>)}
              </select>
            </label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.f.availability", locale)}
              <select name="availability" className={input}>{AVAILABILITY.map((a) => <option key={a} value={a}>{t(`dxdir.availability.${a}`, locale)}</option>)}</select>
            </label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.f.performed", locale)}
              <select name="performed" className={input}>{PERFORMED.map((p) => <option key={p} value={p}>{t(`dxdir.performed.${p}`, locale)}</option>)}</select>
            </label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.f.performing_branch", locale)}
              <select name="performing_branch_listing_id" className={input}>
                <option value="">{t("dxdir.f.none", locale)}</option>
                <optgroup label={t("dxdir.f.performer.same_provider", locale)}>
                  {siblings.map((x) => <option key={x.location_id} value={x.branch_listing_id as string}>{x.name}</option>)}
                </optgroup>
                <optgroup label={t("dxdir.f.performer.other_provider", locale)}>
                  {d.other_branches.map((x) => <option key={x.branch_listing_id} value={x.branch_listing_id}>{x.label}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-charcoal-ink"><input type="checkbox" name="appointment_required" /> {t("dxdir.f.appointment_required", locale)}</label>
            <input name="preparation_note" maxLength={1000} placeholder={t("dxdir.f.preparation_note", locale)} className={input} />
            <input name="evidence_source" required minLength={5} maxLength={300} placeholder={t("dxdir.f.evidence_source", locale)} className={`${input} sm:col-span-2`} />
            <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.f.save", locale)}</button>
          </form>
        </details>
      </div>
    </article>
  );
}

/**
 * Tarragon Preferred Partner (DIR-1): a commercial relationship with one branch. It never makes a branch recommendable;
 * it only moves an already-eligible branch up when it is close to the nearest one. Only an admin may change it, and a
 * commission arrangement cannot be recorded without a legal review reference (the database refuses both otherwise).
 */
function PartnerPanel({ listingId, branchId, rows, isAdmin }: { listingId: string; branchId: string; rows: Partnership[]; isAdmin: boolean }) {
  const open = rows.find((r) => r.ended_at === null);
  return (
    <div className="rounded-lg border border-charcoal-ink/10 p-3 text-sm">
      <h4 className="font-semibold text-charcoal-ink">{t("dxdir.partner.title", locale)}</h4>
      <p className="text-xs text-charcoal-ink/70">{t("dxdir.partner.hint", locale)}</p>
      {open ? (
        <p className="mt-1 text-xs text-charcoal-ink">
          {t(open.in_force ? "dxdir.partner.in_force" : open.lapsed ? "dxdir.partner.lapsed" : "dxdir.partner.not_yet", locale, {
            from: lagosDate(open.starts_on), to: open.ends_on ? lagosDate(open.ends_on) : t("dxdir.partner.no_end", locale),
          })}
          {open.has_commission ? ` ${t("dxdir.partner.commission", locale, { ref: open.legal_review_reference ?? "-" })}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-xs text-charcoal-ink/60">{t("dxdir.partner.none", locale)}</p>
      )}
      {!isAdmin ? (
        <p className="mt-1 text-xs text-charcoal-ink/60">{t("dxdir.partner.admin_only", locale)}</p>
      ) : open && !open.lapsed ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-brand-green">{t("dxdir.partner.end", locale)}</summary>
          <form action={endPartnerAction} className="mt-2 space-y-2">
            <Hidden values={{ listing_id: listingId, partnership_id: open.id }} />
            <input name="reason" required minLength={10} maxLength={500} placeholder={t("dxdir.f.reason", locale)} className={input} />
            <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("dxdir.partner.end", locale)}</button>
          </form>
        </details>
      ) : (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-brand-green">{t("dxdir.partner.set", locale)}</summary>
          <form action={setPartnerAction} className="mt-2 grid gap-2 sm:grid-cols-2">
            <Hidden values={{ listing_id: listingId, branch_listing_id: branchId }} />
            <label className="block text-xs text-charcoal-ink">{t("dxdir.partner.starts_on", locale)}<input type="date" name="starts_on" required className={input} /></label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.partner.ends_on", locale)}<input type="date" name="ends_on" className={input} /></label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.partner.has_commission", locale)}
              <select name="has_commission" required className={input}>
                <option value="no">{t("dxdir.partner.commission_no", locale)}</option>
                <option value="yes">{t("dxdir.partner.commission_yes", locale)}</option>
              </select>
            </label>
            <label className="block text-xs text-charcoal-ink">{t("dxdir.partner.legal_review_reference", locale)}
              <input name="legal_review_reference" maxLength={200} className={input} />
            </label>
            <input name="note" required minLength={10} maxLength={1000} placeholder={t("dxdir.partner.note", locale)} className={`${input} sm:col-span-2`} />
            <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.partner.set", locale)}</button>
          </form>
        </details>
      )}
    </div>
  );
}

function Credentials({ d, tests }: { d: Detail; tests: InvestigationOption[] }) {
  const branchName = (id: string | null) => d.branches.find((b) => b.branch_listing_id === id)?.name ?? "-";
  return (
    <section aria-labelledby="dx-creds" className="space-y-3">
      <h2 id="dx-creds" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.credentials", locale)}</h2>
      {d.credentials.length === 0 && <p className="text-sm text-charcoal-ink/70">{t("dxdir.credentials.none", locale)}</p>}
      <ul className="grid gap-2">
        {d.credentials.map((c) => (
          <li key={c.id} className={`${card} space-y-1 text-sm`}>
            <p className="font-medium text-charcoal-ink">
              {regulatorLabel(c.regulator)} {c.identifier ?? ""}{" "}
              <span className="ml-1 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs">{t(`dxdir.cred.${c.effective_status}`, locale)}</span>
            </p>
            <p className="text-xs text-charcoal-ink/70">
              {c.level === "provider" ? t("dxdir.credential.level.provider", locale) : t("dxdir.credential.level.branch", locale, { name: branchName(c.branch_listing_id) })}
              {" · "}{c.issuer}{c.accreditation_body ? ` (${c.accreditation_body})` : ""}{c.state ? ` · ${c.state}` : ""}
              {c.expires_on ? ` · ${t("dxdir.credential.expires", locale, { date: lagosDate(c.expires_on) })}` : ""}
            </p>
            <p className="text-xs text-charcoal-ink/70">{t("dxdir.credential.scope", locale)}: {c.scope.length > 0 ? c.scope.join(", ") : t("dxdir.credential.scope_all", locale)}</p>
            {c.source_url && <p className="text-xs"><a href={c.source_url} target="_blank" rel="noreferrer noopener" className="text-brand-green underline">{c.source_url}</a></p>}
            {c.verified_at && <p className="text-xs text-charcoal-ink/70">{t("dxdir.credential.verified", locale, { date: lagosDate(c.verified_at), name: c.verified_by ?? "-", note: c.verification_note ?? "" })}</p>}
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.credential.check", locale)}</summary>
              <form action={setCredentialStatusAction} className="mt-2 grid gap-2 sm:grid-cols-3">
                <Hidden values={{ listing_id: d.listing_id, credential_id: c.id }} />
                <select name="status" defaultValue={c.status} className={input}>
                  {CREDENTIAL_STATUSES.map((s) => <option key={s} value={s}>{t(`dxdir.cred.${s}`, locale)}</option>)}
                </select>
                <input name="note" required minLength={10} maxLength={500} placeholder={t("dxdir.f.note", locale)} className={input} />
                <label className="block text-xs text-charcoal-ink">{t("dxdir.f.next_verify_due", locale)}<input type="date" name="next_verify_due" className={input} /></label>
                <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.f.save", locale)}</button>
              </form>
            </details>
          </li>
        ))}
      </ul>
      <details className={card}>
        <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.credential.add", locale)}</summary>
        <CredentialForm d={d} tests={tests} />
      </details>
    </section>
  );
}

/** One small form per target (the whole organisation, or one branch), so the level and target are never mismatched. */
function CredentialForm({ d, tests }: { d: Detail; tests: InvestigationOption[] }) {
  const branches = d.branches.filter((b) => b.branch_listing_id !== null);
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-charcoal-ink/70">{t("dxdir.credential.scope_hint", locale)}</p>
      {[{ level: "provider" as const, id: d.listing_id, label: t("dxdir.credential.level.provider", locale) },
        ...branches.map((b) => ({ level: "branch" as const, id: b.branch_listing_id as string, label: t("dxdir.credential.level.branch", locale, { name: b.name }) }))]
        .map((target) => (
          <details key={target.id} className="rounded-lg border border-charcoal-ink/10 p-2">
            <summary className="cursor-pointer text-sm text-charcoal-ink">{t("dxdir.credential.applies_to", locale)}: {target.label}</summary>
            <form action={recordCredentialAction} className="mt-2 grid gap-2 sm:grid-cols-2">
              <Hidden values={{ listing_id: d.listing_id, level: target.level, target_id: target.id }} />
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.regulator", locale)}
                <select name="regulator" className={input}>{REGULATORS.map((r) => <option key={r} value={r}>{regulatorLabel(r)}</option>)}</select>
              </label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.issuer", locale)}<input name="issuer" required minLength={2} maxLength={160} className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.accreditation_body", locale)}<input name="accreditation_body" maxLength={160} className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.state", locale)}<input name="state" maxLength={60} className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.identifier", locale)}<input name="identifier" maxLength={120} className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.source_url", locale)}<input name="source_url" type="url" required className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.issued_on", locale)}<input name="issued_on" type="date" className={input} /></label>
              <label className="block text-xs text-charcoal-ink">{t("dxdir.f.expires_on", locale)}<input name="expires_on" type="date" className={input} /></label>
              <label className="block text-xs text-charcoal-ink sm:col-span-2">{t("dxdir.credential.scope", locale)}
                <select name="scope_concept_ids" multiple size={6} className={input}>
                  {tests.map((o) => <option key={o.id} value={o.id}>{o.display}</option>)}
                </select>
              </label>
              <button type="submit" className={`${btn} bg-brand-green text-white sm:w-fit`}>{t("dxdir.f.save", locale)}</button>
            </form>
          </details>
        ))}
    </div>
  );
}

function Incidents({ d }: { d: Detail }) {
  return (
    <section aria-labelledby="dx-incidents" className="space-y-3">
      <h2 id="dx-incidents" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.incidents", locale)}</h2>
      {d.incidents.length === 0 && <p className="text-sm text-charcoal-ink/70">{t("dxdir.incidents.none", locale)}</p>}
      <ul className="grid gap-2">
        {d.incidents.map((i) => (
          <li key={i.id} className={`${card} space-y-1 text-sm`}>
            <p className="font-medium text-charcoal-ink">
              {t(i.severity === "serious" ? "dxdir.severity.serious" : "dxdir.severity.routine", locale)} · {t(`dxdir.incident.status.${i.status}`, locale)}
              {i.status === "open" && i.suspends ? ` · ${t("dxdir.incident.suspending", locale)}` : ""} · {lagosDate(i.opened_at)}
            </p>
            <p className="text-charcoal-ink/80">{i.description}</p>
            {i.decision && <p className="text-xs text-charcoal-ink/70">{i.decision}</p>}
            {i.status === "open" && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("dxdir.incident.close", locale)}</summary>
                <form action={closeIncidentAction} className="mt-2 space-y-2">
                  <Hidden values={{ listing_id: d.listing_id, incident_id: i.id }} />
                  <input name="decision" required minLength={10} maxLength={1000} placeholder={t("dxdir.incident.decision", locale)} className={input} />
                  <input name="corrective_action" maxLength={1000} placeholder={t("dxdir.incident.corrective_action", locale)} className={input} />
                  <label className="block text-xs text-charcoal-ink">{t("dxdir.incident.reinstate", locale)}
                    <select name="reinstate" className={input}>
                      <option value="yes">{t("dxdir.incident.reinstate.yes", locale)}</option>
                      <option value="no">{t("dxdir.incident.reinstate.no", locale)}</option>
                    </select>
                  </label>
                  <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("dxdir.incident.close", locale)}</button>
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const SUBJECTS = ["provider_listings", "branch_listings", "branch_services", "credentials", "listing_incidents", "credential_requirements"] as const;
const ACTIONS = ["created", "status", "location_verified", "details_updated", "confirmed", "recorded", "opened", "closed", "availability", "retired", "replaced"] as const;
const historySubject = (table: string) => {
  const key = table.replace(/^diagnostic_/, "");
  return (SUBJECTS as readonly string[]).includes(key) ? t(`dxdir.history.subject.${key as (typeof SUBJECTS)[number]}`, locale) : key;
};
const historyAction = (action: string) =>
  (ACTIONS as readonly string[]).includes(action) ? t(`dxdir.history.action.${action as (typeof ACTIONS)[number]}`, locale) : action;

function History({ d }: { d: Detail }) {
  return (
    <section aria-labelledby="dx-history" className="space-y-2">
      <h2 id="dx-history" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.history", locale)}</h2>
      {d.events.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("dxdir.history.none", locale)}</p>
      ) : (
        <ul className="space-y-1 text-xs text-charcoal-ink/80">
          {d.events.map((e, n) => (
            <li key={`${e.at}-${n}`}>
              {lagosDate(e.at)} · {e.actor ?? t("dxdir.history.someone", locale)} · {historySubject(e.subject_table)}: {historyAction(e.action)}
              {e.from || e.to ? ` (${t("dxdir.history.change", locale, { from: e.from ?? "-", to: e.to ?? "-" })})` : ""}{e.note ? `: ${e.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
