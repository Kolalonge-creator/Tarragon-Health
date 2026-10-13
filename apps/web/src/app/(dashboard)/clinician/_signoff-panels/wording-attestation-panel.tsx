import { t, type MessageKey } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { attestConditionAction } from "@/lib/go-live/actions";
import { C4_CODE, HOME_BP_GUARD, PATTERN_CODE, PATTERN_GUARD } from "@/lib/clinical/s06-s10-signoff-model";

const locale = DEFAULT_UI_LANGUAGE;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** The cuff and measuring guide a patient reads (C4). Read from the same message catalogue the phone and web use, so what is shown is what ships. */
const CUFF_KEYS = ["hc.cuff.device", "hc.cuff.fit", "hc.cuff.battery", "hc.cuff.arm", "hc.cuff.no_wrist", "hc.cuff.pregnancy"] as const satisfies readonly MessageKey[];
/** The sentences shown after a complete average. */
const BAND_KEYS = [
  "hc.band.above_home_level",
  "hc.band.borderline",
  "hc.band.within_home_target",
  "hc.target.above",
  "hc.target.within",
  "hc.target.suggestion",
] as const satisfies readonly MessageKey[];

/** The sentences around the check itself: how it works, progress, and what the patient is told when results are sent. */
const FLOW_KEYS = [
  "hc.intro",
  "hc.how",
  "hc.not_enough",
  "hc.enough",
  "hc.enough_more",
  "hc.server_short",
  "hc.sent",
  "hc.sent_detail",
  "hc.ended_short",
] as const satisfies readonly MessageKey[];

function Lines({ keys }: { keys: readonly MessageKey[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-ink">
      {keys.map((k) => (
        <li key={k}>{t(k, locale)}</li>
      ))}
    </ol>
  );
}

/**
 * The Chief Medical Officer's own attestation on a go-live guard (C4 cuff wording; C3 clinician-only flag). It shows the exact text first,
 * then one form that calls attest_go_live_condition through the same server action the go-live page uses, returning to the sign-off hub.
 * The database refuses anyone but an admin or the active CMO, and records the name and time. It switches nothing on.
 */
export function WordingAttestationPanel({ kind }: { kind: "c4" | "pattern" }) {
  const guard = kind === "c4" ? HOME_BP_GUARD : PATTERN_GUARD;
  const code = kind === "c4" ? C4_CODE : PATTERN_CODE;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-base font-semibold text-charcoal-ink">
          {t(kind === "c4" ? "s06s10.attest.c4.title" : "s06s10.attest.pattern.title", locale)}
        </h3>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t(kind === "c4" ? "s06s10.attest.c4.intro" : "s06s10.attest.pattern.intro", locale)}</p>
      </div>
      {kind === "c4" ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium text-charcoal-ink">{t("hc.cuff.title", locale)}</p>
            <Lines keys={CUFF_KEYS} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-charcoal-ink">{t("s06s10.attest.c4.bands_heading", locale)}</p>
            <Lines keys={BAND_KEYS} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-charcoal-ink">{t("s06s10.attest.c4.flow_heading", locale)}</p>
            <Lines keys={FLOW_KEYS} />
          </div>
        </>
      ) : null}
      <p className="text-xs text-charcoal-ink/60">{t("s06s10.attest.nothing_on", locale)}</p>
      <form action={attestConditionAction} className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
        <input type="hidden" name="viewer" value="cmo" />
        <input type="hidden" name="back" value="hub" />
        <input type="hidden" name="key" value={guard} />
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="met" value="1" />
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="read" required className="mt-1 h-5 w-5" />
          <span>{t("s06s10.attest.read", locale)}</span>
        </label>
        <label className="block text-xs text-charcoal-ink">
          {t("s06s10.attest.note", locale)}
          <input name="note" required minLength={10} maxLength={1000} placeholder={t("s06s10.attest.note_placeholder", locale)} className={field} />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        >
          {t("s06s10.attest.button", locale)}
        </button>
      </form>
    </div>
  );
}
