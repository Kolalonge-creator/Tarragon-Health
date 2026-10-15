import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  dueListSchema,
  followupLimits,
  formatLagos,
  sentOffersSchema,
} from "@/lib/followups/followups";
import { OfferForm, WithdrawForm } from "./forms";

export const metadata = { title: "Monthly check-ins" };
export const dynamic = "force-dynamic";

/**
 * Monthly check-ins (two-tier item 3). Two audited reads only: the worklist of Members whose month needs times offered (or whose month
 * passed with none booked), and the offers this doctor has sent. A care coordinator is shown the worklist but cannot offer: the
 * database refuses it, so the page does not hide the refusal.
 */
export default async function FollowupsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const supabase = loose(await createClient());
  const [dueRes, sentRes] = await Promise.all([
    supabase.rpc("followups_due_worklist"),
    supabase.rpc("my_followup_offers_sent"),
  ]);
  const due = dueRes.error ? null : dueListSchema.safeParse(dueRes.data);
  const sent = sentRes.error ? null : sentOffersSchema.safeParse(sentRes.data);
  const limits = followupLimits();
  // Only a doctor can offer times; the database refuses a care coordinator, who still sees who is due (logistics only).
  const canOffer = sentRes.error?.code !== "42501";

  const members = due?.success
    ? due.data.map((d) => ({
        patientId: d.patient_id,
        label: `${d.first_name ?? "-"} (${t(d.kind === "missed" ? "followups.kind_missed" : "followups.kind_due", "en")}, ${t("followups.month", "en", { month: d.month_index })})`,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {t("followups.title", "en")}
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          {t("followups.subtitle", "en")}
        </p>
      </div>

      {!due?.success && (
        <p role="alert" className="text-sm text-red-600">
          {t("followups.load_error", "en")}
        </p>
      )}
      {due?.success && (
        <Card>
          <CardHeader>
            <CardTitle>
              {canOffer
                ? t("followups.offer_title", "en")
                : t("followups.due_title", "en")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {due.data.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">
                {t("followups.due_empty", "en")}
              </p>
            ) : !canOffer ? (
              <div className="space-y-2">
                <p className="text-sm text-charcoal-ink/60">
                  {t("followups.coordinator_note", "en")}
                </p>
                <ul className="space-y-1 text-sm">
                  {members.map((m) => (
                    <li key={m.patientId}>{m.label}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <OfferForm
                members={members}
                slotInputs={limits.maxSlots}
                shortestRoutine={limits.routineMin}
                longestRoutine={limits.routineMax}
                hint={t("followups.offer_hint", "en", {
                  min: limits.minSlots,
                  max: limits.maxSlots,
                  lead: limits.leadHours,
                })}
              />
            )}
          </CardContent>
        </Card>
      )}

      {canOffer && (
        <Card>
          <CardHeader>
            <CardTitle>{t("followups.sent_title", "en")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!sent?.success && (
              <p role="alert" className="text-sm text-red-600">
                {t("followups.load_error", "en")}
              </p>
            )}
            {sent?.success && sent.data.length === 0 && (
              <p className="text-sm text-charcoal-ink/60">
                {t("followups.sent_empty", "en")}
              </p>
            )}
            {sent?.success &&
              sent.data.map((o) => (
                <div
                  key={o.offer_id}
                  className="flex flex-wrap items-center gap-3 border-b border-charcoal-ink/10 pb-3 text-sm last:border-0"
                >
                  <span className="font-medium text-charcoal-ink">
                    {o.first_name ?? "-"}
                  </span>
                  <Badge
                    variant={
                      o.status === "open"
                        ? "blue"
                        : o.status === "picked"
                          ? "green"
                          : "grey"
                    }
                  >
                    {o.status === "open"
                      ? t("followups.sent.open", "en", {
                          when: formatLagos(o.expires_at),
                        })
                      : o.status === "picked"
                        ? t("followups.sent.picked", "en", {
                            when: o.booked_for
                              ? formatLagos(o.booked_for)
                              : "-",
                          })
                        : o.status === "withdrawn"
                          ? t("followups.sent.withdrawn", "en")
                          : t("followups.sent.expired", "en")}
                  </Badge>
                  <span>
                    {t("followups.sent.minutes", "en", {
                      minutes: o.call_minutes,
                    })}
                  </span>
                  {o.longer_requested && (
                    <Badge variant="amber">
                      {t("followups.longer_flag", "en")}
                    </Badge>
                  )}
                  <span className="text-charcoal-ink/60">
                    {o.slots.map((s) => formatLagos(s.starts_at)).join("  |  ")}
                  </span>
                  {o.status === "open" && (
                    <span className="ml-auto">
                      <WithdrawForm offerId={o.offer_id} />
                    </span>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
