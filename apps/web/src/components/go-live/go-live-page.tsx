import { t, type Locale } from "@tarragon/i18n";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import { loadGuards, loadSignoffs } from "@/lib/go-live/load";
import {
  buildConfigRows,
  guardHasDrifted,
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
const today = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
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
  const rows = signoffs.ok ? buildConfigRows(PROPOSED_CONFIG, signoffs.data, today()) : [];
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
        <ul className="grid gap-4">
          {guards.data.map((g) => (
            <GuardCard key={g.key} g={g} viewer={writer} locale={locale} />
          ))}
        </ul>
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

function GuardCard({ g, viewer, locale }: { g: GuardStatus; viewer: Viewer | null; locale: Locale }) {
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

function ConfigCard({ r, viewer, locale }: { r: ConfigRow; viewer: Viewer; locale: Locale }) {
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
