import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON, type AppIconName, APP_ICON } from "@/lib/icons";

type ScheduleItem = {
  icon: AppIconName;
  /** Plain-language type label — the whole point of this card is that a
   * patient shouldn't have to know the difference between a "medication
   * review", a "preventive review", a "lifestyle check-in" and an "annual
   * doctor review" to understand that something is scheduled. */
  type: string;
  title: string;
  dueDate: string;
  href: string;
};

const MAX_ITEMS = 6;

/** "· 5 days left" style label, shared shape with the medicines-cabinet one. */
function daysLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

/** Same day-boundary arithmetic as daysLabel, so the two can never disagree
 * about whether an item is overdue. */
function isOverdue(dateStr: string): boolean {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  return target.getTime() < today.getTime();
}

function formatLabel(value: string): string {
  return value.split("_").join(" ");
}

/**
 * Data + date work lives outside the component body (react-hooks/purity).
 * Fans out across the six subsystems that each independently schedule a
 * "something is due" state for a patient (medication reviews, drug-triggered
 * lab monitoring, preventive/prevention reviews, lifestyle coaching
 * check-ins, the once-a-year Annual Doctor Review, and vaccinations) and
 * merges them into one sorted list with one plain-language label per kind —
 * pure synthesis over data the patient already owns under RLS, same
 * philosophy as NextBestAction, nothing new stored.
 */
async function resolveUpcomingSchedule(patientId: string): Promise<ScheduleItem[]> {
  const supabase = await createClient();

  const [medReview, labMonitoring, preventiveReview, lifestyleReview, annualReview, vaccination] =
    await Promise.all([
      supabase
        .from("medication_reviews")
        .select("id, due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("medication_lab_monitoring")
        .select("id, due_date, monitoring_label")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .not("due_date", "is", null)
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("preventive_reviews")
        .select("id, due_date")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("lpe_reviews")
        .select(
          "id, due_date, enrollment:lpe_enrollments!lpe_reviews_enrollment_id_fkey(condition)"
        )
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("annual_reviews")
        .select("id, due_date")
        .eq("patient_id", patientId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("vaccination_schedules")
        .select(
          "id, due_date, vaccination_catalog:vaccination_catalog!vaccination_schedules_vaccination_catalog_id_fkey(name)"
        )
        .eq("patient_id", patientId)
        .in("status", ["pending", "overdue"])
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const items: ScheduleItem[] = [];

  if (medReview.data) {
    items.push({
      icon: "medication",
      type: "Medication review",
      title: "Your medication is due for a review by your care team",
      dueDate: medReview.data.due_date,
      href: "#medications",
    });
  }
  if (labMonitoring.data?.due_date) {
    items.push({
      icon: "labs",
      type: "Lab test",
      title: `${labMonitoring.data.monitoring_label ?? "A lab test"} is coming up`,
      dueDate: labMonitoring.data.due_date,
      href: "#medications",
    });
  }
  if (preventiveReview.data) {
    items.push({
      icon: "preventive",
      type: "Prevention check-in",
      title: "A periodic health review with your care team is due",
      dueDate: preventiveReview.data.due_date,
      href: "#prevention",
    });
  }
  if (lifestyleReview.data) {
    const condition = (
      lifestyleReview.data.enrollment as { condition?: string } | null
    )?.condition;
    items.push({
      icon: "food",
      type: "Lifestyle coaching check-in",
      title: condition
        ? `Your ${formatLabel(condition)} lifestyle coaching review is due`
        : "Your lifestyle coaching review is due",
      dueDate: lifestyleReview.data.due_date,
      href: "#care",
    });
  }
  if (annualReview.data) {
    items.push({
      icon: "carePlan",
      type: "Annual doctor review",
      title: "Your once-a-year whole-body review with a doctor is due",
      dueDate: annualReview.data.due_date,
      href: "#prevention",
    });
  }
  if (vaccination.data) {
    const vaccineName = (
      vaccination.data.vaccination_catalog as { name?: string } | null
    )?.name;
    items.push({
      icon: "preventive",
      type: "Vaccination",
      title: vaccineName ? `${vaccineName} is due` : "A vaccination is due",
      dueDate: vaccination.data.due_date,
      href: "#prevention",
    });
  }

  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, MAX_ITEMS);
}

export async function CareScheduleCard({ patientId }: { patientId: string }) {
  const items = await resolveUpcomingSchedule(patientId);
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          What&apos;s coming up
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {items.map((item, i) => {
            const Icon = APP_ICON[item.icon] ?? SEMANTIC_ICON.carePlan;
            return (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-ink/50" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
                    {item.type}
                  </p>
                  <Link href={item.href} className="text-sm text-charcoal-ink hover:underline">
                    {item.title}
                  </Link>
                </div>
                {/* Overdue gets clinical amber emphasis; future dates stay
                    muted so the two states read differently at a glance. */}
                <span
                  className={
                    isOverdue(item.dueDate)
                      ? "shrink-0 whitespace-nowrap text-xs font-medium text-amber-700"
                      : "shrink-0 whitespace-nowrap text-xs text-charcoal-ink/50"
                  }
                >
                  {daysLabel(item.dueDate)}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
