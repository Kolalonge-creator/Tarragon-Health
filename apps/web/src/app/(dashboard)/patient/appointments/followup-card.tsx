import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLagos, myFollowupsSchema, visibleOfferSlots } from "@/lib/followups/followups";
import { AskLongerForm, SlotPicker } from "./followup-picker";

/**
 * Your monthly check-in (two-tier item 3). One read (public.my_followups): the Member's months and the times the care team has offered
 * right now. Nothing is shown to someone who is not a Member. A failed read says so, and never looks like "no times waiting".
 * The care team is not named (OQ-129): the card says "your care team".
 */
export async function FollowupCard({ patientId, isSelf }: { patientId: string; isSelf: boolean }) {
  const supabase = loose(await createClient());
  const res = await supabase.rpc("my_followups", { p_patient: isSelf ? null : patientId });
  const parsed = res.error ? null : myFollowupsSchema.safeParse(res.data);
  if (!parsed?.success) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p role="alert" className="text-sm text-red-600">
            {t("followups.patient.load_error", "en")}
          </p>
        </CardContent>
      </Card>
    );
  }
  const { entitlement, offers } = parsed.data;
  const isMember = entitlement !== null && (entitlement.current !== null || entitlement.remaining > 0 || entitlement.consumed > 0 || offers.length > 0);
  if (!isMember) return null;

  const now = new Date();
  const open = offers.map((o) => ({ offer: o, slots: visibleOfferSlots(o, now) })).filter((x) => x.slots.length > 0);
  const booked = entitlement.current?.state === "booked" ? entitlement.current : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("followups.patient.title", "en")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">{t("followups.patient.subtitle", "en")}</p>
        {entitlement.current && (
          <p className="text-xs text-charcoal-ink/60">
            {t("followups.patient.month", "en", { month: entitlement.current.month_index })}
            {entitlement.consumed > 0 ? `. ${t("followups.patient.done_count", "en", { done: entitlement.consumed })}` : ""}
          </p>
        )}
        {booked && booked.encounter_id && <AskLongerForm encounterId={booked.encounter_id} />}
        {open.length === 0 && !booked && <p className="text-sm text-charcoal-ink/70">{t("followups.patient.none", "en")}</p>}
        {open.map(({ offer, slots }) => (
          <div key={offer.offer_id} className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">{t("followups.patient.waiting", "en")}</p>
            <p className="text-xs text-charcoal-ink/60">{t("followups.patient.expires", "en", { when: formatLagos(offer.expires_at) })}</p>
            <SlotPicker minutes={offer.call_minutes} slots={slots.map((s) => ({ slotId: s.slot_id, label: formatLagos(s.starts_at) }))} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
