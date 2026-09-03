import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type SystemHealthComponent = {
  key: string;
  label: string;
  status: "operational" | "degraded" | "down";
  detail: string;
  metric: Record<string, number> | null;
};

const STATUS_VARIANT: Record<SystemHealthComponent["status"], "green" | "amber" | "red"> = {
  operational: "green",
  degraded: "amber",
  down: "red",
};

const STATUS_LABEL: Record<SystemHealthComponent["status"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
};

/**
 * Module 30.19 — system health, derived from what the database can actually
 * observe about itself (notification/payment/integration/alert state) rather
 * than a status table somebody has to remember to update. See
 * public.ops_system_health() for how each component's status is computed.
 */
export function SystemHealthPanel({ components }: { components: SystemHealthComponent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System health</CardTitle>
        <CardDescription>
          Derived live from notification delivery, payment webhook processing, partner
          integration checks and the clinical alert pipeline, not a status page anyone has to
          remember to update.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {components.map((c) => (
            <div
              key={c.key}
              className="flex flex-col gap-2 rounded-xl border border-charcoal-ink/10 bg-white p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-charcoal-ink">{c.label}</span>
                <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              </div>
              <p className="text-xs text-charcoal-ink/60">{c.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
