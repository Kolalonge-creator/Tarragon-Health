import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON, type AppIconName, APP_ICON } from "@/lib/icons";

type NextAction = {
  icon: AppIconName;
  title: string;
  body: string;
  href: string;
  cta: string;
};

/**
 * "Next best action" — one clear card at the top of the patient dashboard,
 * the single most copied engagement pattern across the digital-health leaders
 * (Teladoc care navigation, Livongo, Omada). Pure synthesis over data the
 * patient already owns under RLS — nothing new is computed or stored, and
 * safety surfaces (EmergencyAlert / DangerSymptomCheck) always render above
 * this card, so it never competes with an emergency.
 *
 * Priority order (first match wins):
 *   1. overdue/pending screening past due     → book it
 *   2. a video-consult slot offer awaiting me → pick a time
 *   3. an open medicines check-in             → answer it
 *   4. a refill due within 7 days             → sort the refill
 *   5. no vitals reading in the last 7 days   → log today's reading
 *   6. everything current                     → gentle "you're up to date"
 */
/** Data + date work lives outside the component body (react-hooks/purity). */
async function resolveNextAction(patientId: string): Promise<NextAction> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [screening, consult, checkin, refill, recentVital] = await Promise.all([
    supabase
      .from("screening_schedules")
      .select("id, due_date, screen_type:screen_types(name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"])
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("video_consultations")
      .select("id")
      .eq("patient_id", patientId)
      .is("patient_confirmed_at", null)
      .not("proposed_slots", "is", null)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medication_adherence_checkins")
      .select("id")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", today)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("medications")
      .select("id, drug_name, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .not("refill_date", "is", null)
      .lte("refill_date", in7days)
      .order("refill_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("vitals_readings")
      .select("id")
      .eq("patient_id", patientId)
      .gte("taken_at", sevenDaysAgo)
      .limit(1)
      .maybeSingle(),
  ]);

  let action: NextAction;
  if (screening.data) {
    const screenName = screening.data.screen_type?.name ?? "screening";
    action = {
      icon: "preventive",
      title: `Your ${screenName} is due`,
      body: "Booking takes about a minute, and an early catch is the whole point of screening.",
      href: "#prevention",
      cta: "Book it now",
    };
  } else if (consult.data) {
    action = {
      icon: "booking",
      title: "Your doctor offered times for a video call",
      body: "Pick whichever works for you — it only takes a tap to confirm.",
      href: "#care",
      cta: "Pick a time",
    };
  } else if (checkin.data) {
    action = {
      icon: "medication",
      title: "A 2-minute medicines check-in is waiting",
      body: "Tell us how the medicine is going — it helps your care team spot problems early.",
      href: "#medications",
      cta: "Answer now",
    };
  } else if (refill.data) {
    action = {
      icon: "medication",
      title: `${refill.data.drug_name} is due for a refill soon`,
      body: "Sort the refill now so you never run out.",
      href: "#medications",
      cta: "Sort my refill",
    };
  } else if (!recentVital.data) {
    action = {
      icon: "bp",
      title: "Log a reading today",
      body: "A fresh reading keeps your care team's picture of you current — it takes under a minute.",
      href: "#vitals",
      cta: "Log a reading",
    };
  } else {
    action = {
      icon: "preventive",
      title: "You're up to date",
      body: "Nothing is waiting on you right now. Keep logging readings and we'll flag anything that needs attention.",
      href: "#vitals",
      cta: "Log another reading",
    };
  }
  return action;
}

export async function NextBestAction({ patientId }: { patientId: string }) {
  const action = await resolveNextAction(patientId);
  const Icon = APP_ICON[action.icon] ?? SEMANTIC_ICON.preventive;

  return (
    <Card className="border-brand-green/30 bg-brand-green/[0.04]">
      <CardContent className="flex items-start gap-3 py-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">
            Next best step
          </p>
          <p className="text-sm font-semibold text-charcoal-ink">{action.title}</p>
          <p className="text-sm text-charcoal-ink/70">{action.body}</p>
          <Link
            href={action.href}
            className="inline-block text-sm font-medium text-brand-green hover:underline"
          >
            {action.cta} →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
