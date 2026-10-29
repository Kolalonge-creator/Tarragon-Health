import { t, type Locale } from "@tarragon/i18n";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { loadGuards, loadSignoffs } from "@/lib/go-live/load";
import {
  buildConfigRows,
  groupGuards,
  guardHasDrifted,
  guardIsOpen,
  isFeature,
  lagosToday,
  openRows,
  viewerMaySwitchOn,
  viewerOwns,
  type ConfigRow,
  type GuardStatus,
  type Viewer,
} from "@/lib/go-live/model";
import { attestConditionAction, signoffConfigAction, switchGuardAction } from "@/lib/go-live/actions";
import { FlashClean } from "./flash-clean";

const lagos = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const button = "rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * The go-live guards dashboard and the PROPOSED-value sign-off list (S37). One component for two doors: /admin/go-live for the
 * founder (the admin account) and /clinician/go-live for the Chief Medical Officer, whose clinician login cannot open /admin.
 * What each viewer may do is decided by the database; the buttons are only shown to the person who may press them.
 *
 * A guard that blocks nothing yet says so in words, so nobody believes a feature is protected when it is not.
 */
export async function GoLivePage({
  viewer,
  locale,
  notice,
  detail,
  ok,
}: {
  viewer: Viewer | "ops";
  locale: Locale;
  notice?: string;
  detail?: string;
  ok?: boolean;
}) {
  // S36b: operations users see the guards and nothing else, and no button. The database refuses their writes regardless.
  const writer: Viewer | null = viewer === "ops" ? null : viewer;
  const [guards, signoffs] = await Promise.all([loadGuards(), writer ? loadSignoffs() : Promise.resolve({ ok: true as const, data: [] })]);
  const rows = signoffs.ok ? buildConfigRows(PROPOSED_CONFIG, signoffs.data, lagosToday()) : [];
  const open = openRows(rows);
  const noticeText = notice && /^golive\.(done|error)\./.test(notice) ? t(notice as Parameters<typeof t>[0], locale) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("golive.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("golive.intro", locale)}</p>
      </div>

      {noticeText && <FlashClean />}
      {noticeText && (
        <p role={ok ? "status" : "alert"} className={`rounded-xl border p-3 text-sm ${ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {noticeText}
          {detail ? ` ${detail}` : ""}
        </p>
      )}

      {!guards.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("golive.load_error", locale)}</p>
      ) : (
        <GuardSections guards={guards.data} viewer={writer} locale={locale} />
      )}

      {writer && (
      <section aria-labelledby="proposed-values" className="space-y-3">
        <div>
          <h2 id="proposed-values" className="font-heading text-xl font-semibold text-charcoal-ink">{t("golive.config.title", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("golive.config.intro", locale)}</p>
          {signoffs.ok && <p className="mt-1 text-sm font-medium text-charcoal-ink">{t("golive.config.counts", locale, { open: open.length, total: rows.length })}</p>}
        </div>
        {!signoffs.ok ? (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("golive.load_error", locale)}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("golive.config.empty", locale)}</p>
        ) : (
          <ul className="grid gap-3">
            {rows.map((r) => (
              <ConfigCard key={`${r.key}@${r.version}`} r={r} viewer={writer as Viewer} locale={locale} />
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}

/**
 * G-01 layout (2026-10-29): the nine master switches first, each with the features that stand under it, then the features that stand on
 * their own. A master keeps its conditions and its role. A feature is one card with its state, why it is closed (its master, or a hold
 * with the reason), and a switch either viewer may press.
 */
function GuardSections({ guards, viewer, locale }: { guards: GuardStatus[]; viewer: Viewer | null; locale: Locale }) {
  const { groups, standalone } = groupGuards(guards);
  return (
    <div className="space-y-8">
      <section aria-labelledby="masters" className="space-y-3">
        <div>
          <h2 id="masters" className="font-heading text-xl font-semibold text-charcoal-ink">{t("golive.section.masters", locale)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("golive.section.masters.intro", locale)}</p>
        </div>
        <ul className="grid gap-4">
          {groups.map(({ master, features }) => (
            <li key={master.key} className="space-y-3">
              <GuardCard g={master} viewer={viewer} locale={locale} />
              {features.length > 0 && (
                <details className="ml-4 rounded-xl border border-dashed border-charcoal-ink/15 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">
                    {t("golive.section.under", locale, { master: master.label, count: features.length })}
                  </summary>
                  <ul className="mt-3 grid gap-3">
                    {features.map((f) => (
                      <FeatureCard key={f.key} g={f} master={master} viewer={viewer} locale={locale} />
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
      {standalone.length > 0 && (
        <section aria-labelledby="standalone" className="space-y-3">
          <div>
            <h2 id="standalone" className="font-heading text-xl font-semibold text-charcoal-ink">{t("golive.section.standalone", locale)}</h2>
            <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("golive.feature.intro", locale)}</p>
          </div>
          <ul className="grid gap-3">
            {standalone.map((f) => (
              <FeatureCard key={f.key} g={f} master={null} viewer={viewer} locale={locale} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One feature (G-01): state, why it is closed, and a switch for either viewer. Its conditions are advisory and are not listed here. */
function FeatureCard({ g, master, viewer, locale }: { g: GuardStatus; master: GuardStatus | null; viewer: Viewer | null; locale: Locale }) {
  const open = guardIsOpen(g);
  const held = !g.is_on && !!g.held_reason;
  const parentOff = g.is_on && master !== null && !master.is_on;
  const stateKey = open ? "golive.state.open" : held ? "golive.state.held" : "golive.state.closed";
  const badge = open ? "bg-emerald-100 text-emerald-900" : held ? "bg-amber-100 text-amber-900" : "bg-charcoal-ink/10 text-charcoal-ink";
  return (
    <li id={g.key} data-kind="feature" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-base font-semibold text-charcoal-ink">{g.label}</h3>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge}`}>{t(stateKey, locale)}</span>
      </div>
      <p className="font-mono text-xs text-charcoal-ink/50">{g.key}</p>
      <p className="text-sm text-charcoal-ink">
        <span className="font-medium">{t("golive.blocks", locale)}:</span> {g.blocks}
      </p>
      {g.enforced_in.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("golive.enforced.none", locale)}</p>}
      {parentOff && master && (
        <p className="rounded-lg bg-charcoal-ink/5 px-3 py-2 text-sm text-charcoal-ink">{t("golive.feature.parent_off", locale, { master: master.label })}</p>
      )}
      {held && g.held_reason && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">{t("golive.state.held", locale)}:</span> {g.held_reason}
        </p>
      )}
      {viewer === null ? (
        <p className="text-xs text-charcoal-ink/70">{t("golive.readonly", locale)}</p>
      ) : (
        <form action={switchGuardAction} className="space-y-2">
          <input type="hidden" name="viewer" value={viewer} />
          <input type="hidden" name="key" value={g.key} />
          {g.is_on ? (
            <>
              <label className="block text-xs text-charcoal-ink">
                {t("golive.feature.hold.note", locale)}
                <input name="note" required minLength={20} maxLength={1000} className={field} />
              </label>
              <button type="submit" name="on" value="0" className={`${button} border border-red-300 text-red-900`}>{t("golive.feature.hold", locale)}</button>
            </>
          ) : (
            <>
              <label className="block text-xs text-charcoal-ink">
                {t("golive.feature.open.note", locale)}
                <input name="note" required maxLength={1000} className={field} />
              </label>
              {/* Enter in the note field submits this form; opening needs the box ticked as well, same as a master, so a stray Enter cannot open a feature. */}
              <label className="flex items-start gap-2 text-xs text-charcoal-ink">
                <input type="checkbox" name="confirm" required className="mt-0.5" />
                {t("golive.feature.open.confirm", locale)}
              </label>
              <button type="submit" name="on" value="1" className={`${button} bg-brand-green text-white`}>{t("golive.feature.open", locale)}</button>
            </>
          )}
        </form>
      )}
      {g.recent.length > 0 && (
        <ul className="space-y-1 text-xs text-charcoal-ink/80">
          {g.recent.slice(0, 2).map((r, i) => (
            <li key={`${r.at}-${i}`}>
              {t("golive.last_change", locale, {
                what: r.action === "switched_on" ? t("golive.action.switched_on", locale) : t("golive.action.switched_off", locale),
                who: r.by ?? "?",
                when: lagos(r.at),
              })}
              {r.note ? `. ${r.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function GuardCard({ g, viewer, locale }: { g: GuardStatus; viewer: Viewer | null; locale: Locale }) {
  if (isFeature(g)) return <FeatureCard g={g} master={null} viewer={viewer} locale={locale} />;
  const mayOn = viewer !== null && viewerMaySwitchOn(g, viewer);
  const drift = guardHasDrifted(g);
  return (
    <li id={g.key} className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-base font-semibold text-charcoal-ink">{g.label}</h3>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${g.is_on ? "bg-emerald-100 text-emerald-900" : "bg-charcoal-ink/10 text-charcoal-ink"}`}>
          {g.is_on ? t("golive.state.on", locale) : t("golive.state.off", locale)}
        </span>
      </div>
      <p className="font-mono text-xs text-charcoal-ink/50">{g.key}</p>
      <p className="text-sm text-charcoal-ink">
        <span className="font-medium">{t("golive.blocks", locale)}:</span> {g.blocks}
      </p>
      <div className="text-sm text-charcoal-ink">
        <p className="font-medium">{t("golive.enforced.title", locale)}</p>
        {g.enforced_in.length > 0 ? (
          <p className="font-mono text-xs">{g.enforced_in.join(", ")}</p>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("golive.enforced.none", locale)}</p>
        )}
        {g.not_enforced_in && (
          <p className="mt-1 text-xs text-charcoal-ink/70">
            <span className="font-medium">{t("golive.not_enforced", locale)}:</span> {g.not_enforced_in}
          </p>
        )}
      </div>
      {drift && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{t("golive.drift", locale)}</p>}

      <div>
        <p className="text-sm font-medium text-charcoal-ink">{t("golive.conditions", locale)}</p>
        <ul className="mt-1 space-y-2">
          {g.conditions.map((c) => (
            <li key={c.code} className="rounded-lg bg-charcoal-ink/5 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-charcoal-ink">{c.label}</span>
                <span className={`text-xs font-semibold ${c.met ? "text-emerald-800" : "text-red-800"}`}>
                  {c.met ? t("golive.cond.met", locale) : t("golive.cond.unmet", locale)}
                </span>
              </div>
              <p className="text-xs text-charcoal-ink/60">
                {c.source === "data" ? t("golive.cond.source.data", locale) : c.source === "attestation" ? t("golive.cond.source.attestation", locale) : t("golive.cond.source.switch", locale)}
                {c.detail ? `: ${c.detail}` : ""}
              </p>
              {/* S47: the code name of a condition a person records, so the CMO can find it, name it in a note and attest it. */}
              {c.source === "attestation" && (
                <p className="text-xs text-charcoal-ink/60">
                  {t("golive.cond.code", locale)} <code data-testid="attestation-code" className="rounded bg-charcoal-ink/10 px-1 font-mono">{c.code}</code>
                </p>
              )}
              {c.source === "attestation" && viewer !== null && (
                <form action={attestConditionAction} className="mt-2 space-y-2">
                  <input type="hidden" name="viewer" value={viewer} />
                  <input type="hidden" name="key" value={g.key} />
                  <input type="hidden" name="code" value={c.code} />
                  <label className="block text-xs text-charcoal-ink">
                    {t("golive.cond.attest.note", locale)}
                    <input name="note" required minLength={10} maxLength={1000} className={field} />
                  </label>
                  {/* The withdrawing button comes first in the page: pressing Enter in the note field submits the FIRST button, and an
                      accidental Enter must never assert that something was checked. */}
                  <div className="flex flex-wrap gap-2">
                    {c.met && <button type="submit" name="met" value="0" className={`${button} border border-charcoal-ink/20 text-charcoal-ink`}>{t("golive.cond.attest.withdraw", locale)}</button>}
                    <button type="submit" name="met" value="1" className={`${button} bg-brand-green text-white`}>{t("golive.cond.attest.confirm", locale)}</button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>

      {viewer === null ? (
        <p className="text-xs text-charcoal-ink/70">{t("golive.readonly", locale)}</p>
      ) : (
      <form action={switchGuardAction} className="space-y-2">
        <input type="hidden" name="viewer" value={viewer} />
        <input type="hidden" name="key" value={g.key} />
        {g.is_on ? (
          <>
            <label className="block text-xs text-charcoal-ink">
              {t("golive.switch.note", locale)}
              <input name="note" maxLength={1000} className={field} />
            </label>
            <button type="submit" name="on" value="0" className={`${button} border border-red-300 text-red-900`}>{t("golive.switch.off", locale)}</button>
          </>
        ) : mayOn ? (
          <>
            <label className="block text-xs text-charcoal-ink">
              {t("golive.switch.note", locale)}
              <input name="note" required maxLength={1000} className={field} />
            </label>
            {/* Enter in the note field submits this form. Switching on needs the box ticked (the browser refuses to submit without it and
                the action checks it again), so a stray Enter cannot make a clinical feature live. */}
            <label className="flex items-start gap-2 text-xs text-charcoal-ink">
              <input type="checkbox" name="confirm" required disabled={!g.all_met} className="mt-0.5" />
              {t("golive.switch.confirm", locale)}
            </label>
            <button type="submit" name="on" value="1" disabled={!g.all_met} className={`${button} bg-brand-green text-white`}>{t("golive.switch.on", locale)}</button>
            {!g.all_met && <p className="text-xs text-charcoal-ink/70">{t("golive.switch.blocked", locale)}</p>}
          </>
        ) : (
          <p className="text-xs text-charcoal-ink/70">{g.switch_role === "cmo" ? t("golive.switch.who.cmo", locale) : t("golive.switch.who.admin", locale)}</p>
        )}
      </form>
      )}

      <div>
        <p className="text-sm font-medium text-charcoal-ink">{t("golive.recent", locale)}</p>
        {g.recent.length === 0 ? (
          <p className="text-xs text-charcoal-ink/60">{t("golive.recent.none", locale)}</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-charcoal-ink/80">
            {g.recent.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                {t("golive.last_change", locale, {
                  what: r.action === "switched_on" ? t("golive.action.switched_on", locale) : t("golive.action.switched_off", locale),
                  who: r.by ?? "?",
                  when: lagos(r.at),
                })}
                {r.note ? `. ${r.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** One proposed value with its confirm control. Also used by the sign-off hub (back="hub" returns the Chief Medical Officer there). */
export function ConfigCard({ r, viewer, locale, back }: { r: ConfigRow; viewer: Viewer; locale: Locale; back?: "hub" }) {
  const mine = viewerOwns(r.owner, viewer);
  const done = r.status === "signed" || r.status === "confirmed_in_registry";
  const statusText =
    r.status === "confirmed_in_registry"
      ? t("golive.config.status.registry", locale)
      : r.status === "signed" && r.signoff
        ? t("golive.config.status.signed", locale, { who: r.signoff.signed_by_name ?? "?", when: lagos(r.signoff.signed_at) })
        : r.status === "changes_requested" && r.signoff
          ? t("golive.config.status.changes", locale, { who: r.signoff.signed_by_name ?? "?", when: lagos(r.signoff.signed_at) })
          : r.status === "stale"
            ? t("golive.config.status.stale", locale)
            : t("golive.config.status.awaiting", locale);
  return (
    <li id={r.key} className="rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold text-charcoal-ink">{r.key}</h3>
        <span className="text-xs text-charcoal-ink/60">
          {t("golive.config.col.owner", locale)}: {r.owner} · {t("golive.config.col.version", locale)} {r.version}
        </span>
      </div>
      <p className="mt-1 break-words font-mono text-xs text-charcoal-ink/70">
        {t("golive.config.col.value", locale)}: {r.valueText.length > 400 ? `${r.valueText.slice(0, 400)}...` : r.valueText}
      </p>
      <p className={`mt-2 text-sm font-medium ${done ? "text-emerald-800" : r.status === "awaiting" ? "text-charcoal-ink" : "text-amber-900"}`}>{statusText}</p>
      {r.signoff?.note && <p className="text-xs text-charcoal-ink/70">{r.signoff.note}</p>}
      {!done &&
        (mine ? (
          <form action={signoffConfigAction} className="mt-3 space-y-2">
            <input type="hidden" name="viewer" value={viewer} />
            {back ? <input type="hidden" name="back" value={back} /> : null}
            <input type="hidden" name="key" value={r.key} />
            <input type="hidden" name="version" value={r.version} />
            <label className="block text-xs text-charcoal-ink">
              {t("golive.config.note", locale)}
              <input name="note" maxLength={1000} className={field} />
            </label>
            {/* Asking for a change comes first in the page: Enter in the note field submits the FIRST button, and an accidental Enter must
                never record a confirmation (a change request with no note is refused). */}
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="decision" value="changes_requested" className={`${button} border border-charcoal-ink/20 text-charcoal-ink`}>{t("golive.config.ask_change", locale)}</button>
              <button type="submit" name="decision" value="confirmed" className={`${button} bg-brand-green text-white`}>{t("golive.config.confirm", locale)}</button>
            </div>
          </form>
        ) : (
          <p className="mt-2 text-xs text-charcoal-ink/60">{t("golive.config.only_owner", locale)}</p>
        ))}
    </li>
  );
}
