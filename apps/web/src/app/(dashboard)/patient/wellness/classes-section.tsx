"use client";

import {
  useUpcomingWellnessClasses,
  useMyClassRegistrations,
  useRegisterForWellnessClass,
  useMarkWellnessClassAttended,
} from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

function classDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ClassesSection({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: classes, isLoading } = useUpcomingWellnessClasses();
  const { data: registrations } = useMyClassRegistrations(patientId);
  const register = useRegisterForWellnessClass(patientId, organisationId ?? "");
  const markAttended = useMarkWellnessClassAttended(patientId);

  if (!organisationId) return null;

  const registeredClassIds = new Set((registrations ?? []).map((r) => r.class_id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.wellnessClass className="h-5 w-5 text-sprout-gold" strokeWidth={2} />
          Workout classes &amp; health workshops
        </CardTitle>
        <CardDescription>
          Live sessions from partner instructors and studios, coming soon in your area.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && (!classes || classes.length === 0) && (
          <p className="text-sm text-charcoal-ink/60">
            Nothing scheduled yet; we&apos;re working on bringing partner classes to your area.
          </p>
        )}
        {classes && classes.length > 0 && (
          <ul className="space-y-2">
            {classes.map((cls) => {
              const registration = (registrations ?? []).find((r) => r.class_id === cls.id);
              return (
                <li
                  key={cls.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-charcoal-ink/10 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{cls.title}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {classDateTime(cls.starts_at)} · {cls.duration_minutes} min ·{" "}
                      {cls.class_type === "virtual" ? "Virtual" : "In person"} · {cls.points_reward} pts
                    </p>
                  </div>
                  {!registration && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={register.isPending || registeredClassIds.has(cls.id)}
                      onClick={() => register.mutate(cls.id)}
                    >
                      Register
                    </Button>
                  )}
                  {registration && registration.status === "registered" && (
                    <Button
                      size="sm"
                      disabled={markAttended.isPending}
                      onClick={() => markAttended.mutate(registration.id)}
                    >
                      Mark attended
                    </Button>
                  )}
                  {registration && registration.status === "attended" && (
                    <Badge variant="green">Attended</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
