"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { formatKobo } from "@/lib/format-money";

/**
 * Admin view of Memberships paid in parts (S25b). Read only: it shows whether the platform module is on, how many plans are in each state,
 * the money still to come and the money already overdue, and the plans that need a person's eye (waiting for a first payment, or lapsed).
 * Switching the module on or off is a superadmin act with a stated reason (public.set_platform_module) and is deliberately not here.
 * A lapsed plan is also raised as an ops incident only when something goes wrong; a lapse itself is normal and lists here.
 */
const planSchema = z.object({
  plan_id: z.string(),
  order_id: z.string(),
  state: z.string(),
  patient_name: z.string().nullable().optional().default(null),
  parts: z.number().int(),
  paid_parts: z.number().int(),
  price_kobo: z.number().int(),
  next_due_at: z.string().nullable().optional().default(null),
  lapsed_at: z.string().nullable().optional().default(null),
  first_paid_at: z.string().nullable().optional().default(null),
});
const overviewSchema = z.object({
  module_on: z.boolean(),
  counts: z.record(z.string(), z.number()),
  outstanding_kobo: z.number(),
  overdue_kobo: z.number(),
  plans: z.array(planSchema),
});
export type InstalmentOverview = z.infer<typeof overviewSchema>;

export function parseOverview(data: unknown): InstalmentOverview | null {
  const r = overviewSchema.safeParse(data);
  return r.success ? r.data : null;
}

export function useInstalmentOverview() {
  return useQuery({
    queryKey: ["admin-instalment-overview"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("admin_instalment_overview");
      if (error) throw error;
      return parseOverview(data);
    },
  });
}

const STATE_LABEL: Record<string, string> = {
  awaiting_first: "Waiting for first payment",
  active: "Up to date",
  lapsed: "Lapsed (access paused)",
  completed: "Completed",
  cancelled: "Closed",
};

export function InstalmentsAdmin() {
  const q = useInstalmentOverview();
  const o = q.data ?? null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading && <p className="text-sm text-charcoal-ink/60">Loading...</p>}
          {q.isError && <p className="text-sm text-red-600">Could not load the overview.</p>}
          {!q.isLoading && !q.isError && o === null && <p className="text-sm text-red-600">The overview could not be read.</p>}
          {o && (
            <>
              <p className="text-sm" role="status">
                Paying in parts is <strong>{o.module_on ? "on" : "off"}</strong>.
                {o.module_on ? "" : " Nobody can start a new plan. Plans that already exist keep running."}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                {Object.entries(STATE_LABEL).map(([k, label]) => (
                  <div key={k}>
                    <dt className="text-charcoal-ink/60">{label}</dt>
                    <dd className="font-semibold">{o.counts[k] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-charcoal-ink/60">Still to come on open plans</dt>
                  <dd className="font-semibold">{formatKobo(o.outstanding_kobo)}</dd>
                </div>
                <div>
                  <dt className="text-charcoal-ink/60">Overdue right now</dt>
                  <dd className="font-semibold">{formatKobo(o.overdue_kobo)}</dd>
                </div>
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open plans</CardTitle>
        </CardHeader>
        <CardContent>
          {o && o.plans.length === 0 && <p className="text-sm text-charcoal-ink/60">No open plans.</p>}
          {o && o.plans.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {o.plans.map((p) => (
                <li key={p.plan_id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{p.patient_name ?? "Unknown patient"}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {STATE_LABEL[p.state] ?? p.state} &middot; {p.paid_parts} of {p.parts} paid &middot; {formatKobo(p.price_kobo)} in all
                    </p>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {p.state === "lapsed" && p.lapsed_at
                      ? `Lapsed ${formatPatientDate(p.lapsed_at)}`
                      : p.next_due_at
                        ? `Next due ${formatPatientDate(p.next_due_at)}`
                        : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
