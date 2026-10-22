import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  childEventsFromRows,
  childLogSettings,
  cleanCaregiverLabel,
  type ChildEventKind,
  type ChildEventRow,
  type ChildFeedType,
  type ScheduleCatalogRow,
  type ScheduleRecordRow,
} from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";

/**
 * Reads and writes for the daily child log on the web (S68b). The web has no offline queue (see OQ-342): a tap is written straight to the child's
 * table and, if it fails, the screen says so and the person taps again. The phone is where "saved on this phone" lives.
 *
 * child_daily_events is a new table and not in the generated client types yet (the types are spliced from the live project, which holds other
 * branches' schema, see CLAUDE.md), so it is read and written through a narrow shape and validated by childEventsFromRows, not cast to `any`.
 */
interface UntypedDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string, o: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: { message?: string } | null }> } };
    };
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
}

export const childEventsKey = (childId: string) => ["child-daily-events", childId] as const;
export const childVaccinesKey = (childId: string) => ["child-vaccine-data", childId] as const;

export function useChildDailyEvents(childId: string) {
  return useQuery({
    queryKey: childEventsKey(childId),
    enabled: !!childId,
    queryFn: async (): Promise<ChildEventRow[]> => {
      const client = createClient() as unknown as UntypedDb;
      const { data, error } = await client
        .from("child_daily_events")
        .select("id, kind, feed_type, occurred_at, logged_by_label, corrects_id, client_id")
        .eq("patient_id", childId)
        .order("occurred_at", { ascending: false })
        .limit(childLogSettings().settings.timeline_limit);
      if (error) throw new Error(error.message ?? "child log read failed");
      return childEventsFromRows(data);
    },
  });
}

export type LogTapResult = "saved" | "not_open" | "failed";

export interface LogChildEventInput {
  childId: string;
  organisationId: string;
  kind: ChildEventKind;
  feedType: ChildFeedType | null;
  loggedBy: string;
}

/** One tap. The client id makes a retry after a lost reply a duplicate (23505), which counts as saved. */
export function useLogChildEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogChildEventInput): Promise<LogTapResult> => {
      const client = createClient() as unknown as UntypedDb;
      const now = new Date().toISOString();
      const { error } = await client.from("child_daily_events").insert({
        organisation_id: input.organisationId,
        patient_id: input.childId,
        client_id: crypto.randomUUID(),
        kind: input.kind,
        feed_type: input.kind === "feed" ? (input.feedType ?? "other") : null,
        occurred_at: now,
        client_recorded_at: now,
        logged_by_label: cleanCaregiverLabel(input.loggedBy),
      });
      if (!error || error.code === "23505") return "saved";
      return error.code === "55000" || /not open yet/i.test(error.message ?? "") ? "not_open" : "failed";
    },
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: childEventsKey(input.childId) });
    },
  });
}

export interface ChildVaccineRows {
  catalog: ScheduleCatalogRow[];
  records: (ScheduleRecordRow & { id: string; verifiedBy: string | null; verifiedAt: string | null })[];
}

export function useChildVaccineData(childId: string) {
  return useQuery({
    queryKey: childVaccinesKey(childId),
    enabled: !!childId,
    queryFn: async (): Promise<ChildVaccineRows> => {
      const supabase = createClient();
      const [catalog, records] = await Promise.all([
        supabase.from("vaccination_catalog").select("id, code, name, recommended_age").eq("is_active", true).like("code", "child_%"),
        supabase
          .from("vaccination_records")
          .select("id, vaccination_catalog_id, dose_number, date_administered, verification_status, verified_by, verified_at")
          .eq("profile_id", childId),
      ]);
      if (catalog.error) throw catalog.error;
      if (records.error) throw records.error;
      return {
        catalog: catalog.data,
        records: records.data.map((r) => ({
          id: r.id,
          vaccination_catalog_id: r.vaccination_catalog_id,
          dose_number: r.dose_number,
          date_administered: r.date_administered,
          verification_status: r.verification_status,
          verifiedBy: r.verified_by,
          verifiedAt: r.verified_at,
        })),
      };
    },
  });
}
