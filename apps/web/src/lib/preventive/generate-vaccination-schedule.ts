import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  computeVaccinationStatuses,
  type VaccinationCatalogRow,
  type VaccinationRecordRow,
} from "@/lib/rules/vaccination-status";

/**
 * (Re)generates public.vaccination_schedules for a patient — the persisted,
 * reminder-bearing projection of the pure computeVaccinationStatuses engine.
 *
 * The engine stays the single source of truth for *what* is due; this only
 * materialises its output so the plain-SQL daily reminder cron
 * (private.queue_vaccination_reminders) has rows to work from. Called at the
 * natural moments the answer changes: onboarding risk submit and each logged
 * dose.
 *
 * Reconciliation is tighten-only for due/overdue vaccines (never loosens an
 * existing due date, same rule as screening_schedules), and clears the active
 * reminder once a vaccine is no longer due:
 *   - due / overdue      → ensure an active pending row; tighten its due_date
 *   - up_to_date         → close any active row as 'completed' (dose logged)
 *   - not_yet_due / n/a  → close any active row as 'cancelled'
 *
 * Written through the service-role client for the same reason as
 * screening_schedules: due_date/status are the engine's computation, not a
 * value a patient session should set directly. Best-effort — a failure here
 * must never break onboarding or logging a dose, so it swallows errors.
 */
export async function generateVaccinationScheduleBestEffort(params: {
  patientId: string;
  organisationId: string;
  ageYears: number | null;
}): Promise<void> {
  const { patientId, organisationId, ageYears } = params;
  try {
    const supabase = createServiceRoleClient();

    const [{ data: catalog }, { data: records }, { data: existing }] = await Promise.all([
      supabase
        .from("vaccination_catalog")
        .select("id, code, name, recommended_age")
        .eq("is_active", true),
      supabase
        .from("vaccination_records")
        .select("vaccination_catalog_id, dose_number, date_administered")
        .eq("profile_id", patientId),
      supabase
        .from("vaccination_schedules")
        .select("id, vaccination_catalog_id, status, due_date")
        .eq("patient_id", patientId),
    ]);

    if (!catalog) return;

    const statuses = computeVaccinationStatuses(
      catalog as VaccinationCatalogRow[],
      (records ?? []) as VaccinationRecordRow[],
      { ageYears }
    );

    // Active (pending/booked) schedule per vaccine — at most one per the
    // partial unique index.
    const activeByCatalog = new Map<string, { id: string; due_date: string }>();
    for (const row of existing ?? []) {
      if (row.status === "pending" || row.status === "booked") {
        activeByCatalog.set(row.vaccination_catalog_id, { id: row.id, due_date: row.due_date });
      }
    }

    const inserts: {
      organisation_id: string;
      patient_id: string;
      vaccination_catalog_id: string;
      due_date: string;
      status: "pending";
    }[] = [];

    for (const entry of statuses) {
      const active = activeByCatalog.get(entry.catalogId);

      if (entry.status === "due" || entry.status === "overdue") {
        const dueDate = entry.nextDueDate ?? new Date().toISOString().slice(0, 10);
        if (active) {
          // Tighten only — never push a due date later.
          if (dueDate < active.due_date) {
            await supabase
              .from("vaccination_schedules")
              .update({ due_date: dueDate })
              .eq("id", active.id);
          }
        } else {
          inserts.push({
            organisation_id: organisationId,
            patient_id: patientId,
            vaccination_catalog_id: entry.catalogId,
            due_date: dueDate,
            status: "pending",
          });
        }
      } else if (active) {
        // No longer due — retire the active reminder. Up-to-date means the
        // dose was logged; not-yet-due / not-applicable means it shouldn't
        // have been active.
        await supabase
          .from("vaccination_schedules")
          .update({ status: entry.status === "up_to_date" ? "completed" : "cancelled" })
          .eq("id", active.id);
      }
    }

    if (inserts.length > 0) {
      await supabase.from("vaccination_schedules").insert(inserts);
    }
  } catch {
    // Best-effort projection — never surface to the caller.
  }
}
