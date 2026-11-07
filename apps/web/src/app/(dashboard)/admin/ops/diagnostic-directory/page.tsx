import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FlashClean } from "@/components/go-live/flash-clean";
import { loadDiagnosticOverview } from "@/lib/diagnostic-directory/load";
import { asNotice, BAD_NOTICES, type Overview } from "@/lib/diagnostic-directory/model";
import { createFacilityAction, startListingAction } from "@/lib/diagnostic-directory/actions";
import { BranchFields, btn, lagosDate, Notice, regulatorLabel } from "./ui";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Lab and imaging directory" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;

/**
 * Diagnostic directory Phase 2b: the verifier's work queue and the list of providers. Reading needs admin or the
 * directory.diagnostic.verify permission (checked in admin_dx_overview); a refusal sends the user back to /admin.
 */
export default async function DiagnosticDirectoryPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const notice = asNotice((await searchParams).n);
  const loaded = await loadDiagnosticOverview();
  if (!loaded.ok && loaded.denied) redirect("/admin");

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("dxdir.title", locale)}
        description={t("dxdir.intro", locale)}
        actions={<Link href="/admin/ops/diagnostic-directory/import" className="text-sm font-semibold text-brand-green hover:underline">{t("dxdir.import.link", locale)}</Link>}
      />
      {notice && <FlashClean />}
      {notice && <Notice notice={notice} bad={BAD_NOTICES.has(notice)} />}
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("dxdir.load_error", locale)}</p>
      ) : (
        <>
          <Queue queue={loaded.data.queue} />
          <Providers providers={loaded.data.providers} />
          <Unlisted unlisted={loaded.data.unlisted} />
          <AddFacility />
        </>
      )}
    </div>
  );
}

function QueueList({ title, items }: { title: string; items: { key: string; href: string | null; text: string }[] }) {
  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-3 dark:border-night-ink/15 dark:bg-night-card">
      <h3 className="text-sm font-semibold text-charcoal-ink">
        {title} <span className="ml-1 rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-charcoal-ink/60">{t("dxdir.queue.empty", locale)}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.key}>
              {i.href ? <Link href={i.href} className="text-brand-green underline-offset-2 hover:underline">{i.text}</Link> : i.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Queue({ queue }: { queue: Overview["queue"] }) {
  const href = (id: string | null) => (id ? `/admin/ops/diagnostic-directory/${id}` : null);
  return (
    <section aria-labelledby="dx-queue" className="space-y-3">
      <h2 id="dx-queue" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.queue", locale)}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <QueueList title={t("dxdir.queue.incidents_open", locale)} items={queue.incidents_open.map((i) => ({
          key: i.id, href: href(i.listing_id), text: `${t(i.severity === "serious" ? "dxdir.severity.serious" : "dxdir.severity.routine", locale)}: ${i.description.slice(0, 90)}`,
        }))} />
        <QueueList title={t("dxdir.queue.credentials_expiring", locale)} items={queue.credentials_expiring.map((c) => ({
          key: c.id, href: href(c.listing_id),
          text: `${regulatorLabel(c.regulator)} ${c.identifier ?? ""} ${lagosDate(c.expires_on)}${c.expired ? ` (${t("dxdir.queue.expired", locale)})` : ""}`,
        }))} />
        <QueueList title={t("dxdir.queue.credentials_pending", locale)} items={queue.credentials_pending.map((c) => ({
          key: c.id, href: href(c.listing_id), text: `${regulatorLabel(c.regulator)} ${c.identifier ?? ""}`,
        }))} />
        <QueueList title={t("dxdir.queue.services_overdue", locale)} items={queue.services_overdue.map((s) => ({
          key: s.id, href: href(s.listing_id), text: `${s.test} (${lagosDate(s.confirmed_at)})`,
        }))} />
        <QueueList title={t("dxdir.queue.performer_unknown", locale)} items={queue.performer_unknown.map((s) => ({
          key: s.id, href: href(s.listing_id), text: s.test,
        }))} />
      </div>
    </section>
  );
}

function Providers({ providers }: { providers: Overview["providers"] }) {
  return (
    <section aria-labelledby="dx-providers" className="space-y-3">
      <h2 id="dx-providers" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.providers", locale)}</h2>
      <DataTable
        caption={t("dxdir.providers", locale)}
        columns={[
          { header: t("dxdir.col.name", locale), sortable: true, className: "min-w-56" },
          { header: t("dxdir.col.kind", locale), sortable: true },
          { header: t("dxdir.col.status", locale), sortable: true },
          { header: t("dxdir.col.branches", locale), sortable: true, defaultDir: "desc" },
          { header: t("dxdir.col.services", locale), sortable: true, defaultDir: "desc" },
        ]}
        rows={providers.map((p): DataTableRow => ({
          key: p.listing_id,
          searchText: `${p.name} ${t(`dxdir.kind.${p.kind}`, locale)} ${t(`dxdir.status.${p.directory_status}`, locale)}`,
          // Branches and services sort by how many are listed or eligible, the figure that matters to a patient.
          sort: [p.name, t(`dxdir.kind.${p.kind}`, locale), t(`dxdir.status.${p.directory_status}`, locale), p.listed_branches, p.eligible_services],
          cells: [
            <span key="name">
              <Link href={`/admin/ops/diagnostic-directory/${p.listing_id}`} className="font-medium text-brand-green hover:underline">{p.name}</Link>
              <span className="ml-2 text-xs text-charcoal-ink/60">{t(p.contracted ? "dxdir.contracted" : "dxdir.not_contracted", locale)}</span>
            </span>,
            t(`dxdir.kind.${p.kind}`, locale),
            t(`dxdir.status.${p.directory_status}`, locale),
            `${p.listed_branches} / ${p.branches}`,
            `${p.eligible_services} / ${p.services}`,
          ],
        }))}
        searchLabel="Search providers"
        emptyMessage={t("dxdir.providers.none", locale)}
        noun={{ one: "provider", many: "providers" }}
      />
    </section>
  );
}

function Unlisted({ unlisted }: { unlisted: Overview["unlisted"] }) {
  if (unlisted.length === 0) return null;
  return (
    <section aria-labelledby="dx-unlisted" className="space-y-3">
      <h2 id="dx-unlisted" className="font-heading text-xl font-semibold text-charcoal-ink">{t("dxdir.unlisted", locale)}</h2>
      <ul className="grid gap-2">
        {unlisted.map((u) => (
          <li key={u.provider_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
            <span>
              {u.name} <span className="ml-1 text-xs text-charcoal-ink/60">{t(`dxdir.kind.${u.kind}`, locale)} · {t(u.contracted ? "dxdir.contracted" : "dxdir.not_contracted", locale)}</span>
            </span>
            <form action={startListingAction}>
              <input type="hidden" name="kind" value={u.kind} />
              <input type="hidden" name="provider_id" value={u.provider_id} />
              <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("dxdir.unlisted.start", locale)}</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddFacility() {
  return (
    <section aria-labelledby="dx-add" className="space-y-2">
      <details className="rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
        <summary id="dx-add" className="cursor-pointer font-heading text-lg font-semibold text-charcoal-ink">{t("dxdir.add_facility", locale)}</summary>
        <p className="mt-2 max-w-3xl text-sm text-charcoal-ink/70">{t("dxdir.add_facility.hint", locale)}</p>
        <form action={createFacilityAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-charcoal-ink">
            {t("dxdir.f.kind", locale)}
            <select name="kind" required className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm dark:border-night-ink/25">
              <option value="lab">{t("dxdir.kind.lab", locale)}</option>
              <option value="imaging">{t("dxdir.kind.imaging", locale)}</option>
            </select>
          </label>
          <label className="block text-xs text-charcoal-ink">
            {t("dxdir.f.name", locale)}
            <input name="name" required minLength={2} maxLength={160} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm dark:border-night-ink/25" />
          </label>
          <BranchFields />
          <div className="sm:col-span-2">
            <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("dxdir.f.create", locale)}</button>
          </div>
        </form>
      </details>
    </section>
  );
}
