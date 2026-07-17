"use client";

import { usePatientTimeline, type TimelineEvent } from "@/lib/queries/hospital-admissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const EVENT_STYLE: Record<
  string,
  { label: string; variant: "green" | "amber" | "red" | "blue" | "grey" }
> = {
  hospital_admission: { label: "Hospital", variant: "amber" },
  emergency: { label: "Emergency", variant: "red" },
  vital: { label: "Reading", variant: "green" },
  symptom: { label: "Symptom", variant: "amber" },
  lab: { label: "Lab", variant: "blue" },
  care_plan: { label: "Care plan", variant: "blue" },
  medication: { label: "Medication", variant: "grey" },
};

function eventStyle(type: string | null) {
  const known = type ? EVENT_STYLE[type] : undefined;
  return known ?? { label: type ?? "Event", variant: "grey" as const };
}

export function PatientTimelineCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = usePatientTimeline(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your health timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your timeline.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing recorded yet.</p>
        )}
        {data && data.length > 0 && (
          <ol className="space-y-3">
            {data.map((event: TimelineEvent) => {
              const style = eventStyle(event.event_type);
              return (
                <li
                  key={`${event.source_table}-${event.event_id}`}
                  className="flex gap-3 border-l-2 border-charcoal-ink/10 pl-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={style.variant}>{style.label}</Badge>
                      <span className="text-sm font-medium text-charcoal-ink">
                        {event.title}
                      </span>
                    </div>
                    {event.detail && (
                      <p className="truncate text-xs text-charcoal-ink/70">{event.detail}</p>
                    )}
                  </div>
                  <span className="whitespace-nowrap text-xs text-charcoal-ink/60">
                    {event.event_at ? new Date(event.event_at).toLocaleDateString() : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
