import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import {
  loadPatientTimeline,
  humaniseSummary,
  TIMELINE_EVENT_STYLE,
  type TimelineEvent,
  type TimelineEventType,
} from "@/lib/timeline";
import { isClinicalTier } from "@tarragon/shared";
import { formatDoctorName } from "@/lib/doctor-name";
import type { SectionId } from "@/lib/sections";
import { colors, spacing } from "@/ui/theme";
import { Card, ErrorText, GroupedList, GroupedListRow, MutedText, SecondaryButton, ScreenTitle } from "@/ui/components";

const PAGE_SIZE = 20;

// Mirrors apps/web/src/components/patient-timeline.tsx's EVENT_LINK_SUBPATH --
// deliberately partial, an event type with no obvious single destination
// stays unlinked rather than guessing a wrong one.
const EVENT_LINK_SECTION: Partial<Record<TimelineEventType, SectionId>> = {
  lab_abnormal: "labs",
  lab_completed: "labs",
  imaging_report_uploaded: "labs",
  screening_due: "prevention",
  screening_completed: "prevention",
  vaccination_recorded: "prevention",
  medication_missed: "medications",
  medication_started: "medications",
  medication_stopped: "medications",
  medication_dispensed: "medications",
  medication_received: "medications",
  referral_status_changed: "care",
  referral_created: "care",
  referral_outcome_recorded: "care",
  escalation_raised: "care",
  escalation_resolved: "care",
  message_posted: "messages",
  care_plan_updated: "healthSummary",
  condition_recorded: "healthSummary",
  condition_status_changed: "healthSummary",
  document_uploaded: "healthSummary",
};

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Same null-gating as ActorAttribution on web: a real clinical_staff row
// isn't the same as a real doctor -- a Care Coordinator carries one too.
// No credential number, specialty, or years-of-experience here -- per
// docs/CLINICAL_TRUST_MODEL_SPEC.md's 2026-09-25/2026-09-26 correction,
// per-case attribution is name-only ("Dr. First Last"); mobile has no
// doctor-profile-page equivalent to link that detail to.
export function actorSubtitle(actor: TimelineEvent["actor"]): string | undefined {
  if (!actor?.full_name) return undefined;
  if (!isClinicalTier(actor)) return "By your care team";
  return `By ${formatDoctorName(actor.full_name)}`;
}

interface TimelineScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

export function TimelineScreen({ patientId, onNavigate }: TimelineScreenProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = useCallback(
    async (nextLimit: number, isMore: boolean) => {
      if (isMore) setLoadingMore(true);
      else setLoading(true);
      const result = await loadPatientTimeline(patientId, nextLimit);
      if (result.ok) {
        setEvents(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
      if (isMore) setLoadingMore(false);
      else setLoading(false);
    },
    [patientId]
  );

  useEffect(() => {
    void load(PAGE_SIZE, false);
  }, [load]);

  const hasMore = events.length === limit;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Full activity timeline</ScreenTitle>
        <MutedText>Every update to your record, newest first.</MutedText>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : error ? (
        <ErrorText>{error}</ErrorText>
      ) : events.length === 0 ? (
        <Card>
          <MutedText>No activity yet. Readings, medications and results will appear here.</MutedText>
        </Card>
      ) : (
        <>
          <GroupedList>
            {events.map((event) => {
              const style = TIMELINE_EVENT_STYLE[event.event_type];
              const section = EVENT_LINK_SECTION[event.event_type];
              const subtitleParts = [
                event.summary ? humaniseSummary(event.summary) : null,
                formatWhen(event.occurred_at),
                actorSubtitle(event.actor),
              ].filter(Boolean);
              return (
                <GroupedListRow
                  key={event.id}
                  title={event.title}
                  subtitle={subtitleParts.join(" · ")}
                  trailing={section ? "chevron" : "none"}
                  onPress={section ? () => onNavigate(section) : undefined}
                  leading={
                    <View
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 5,
                        backgroundColor: style.dot,
                        marginTop: 2,
                      }}
                    />
                  }
                />
              );
            })}
          </GroupedList>
          {hasMore ? (
            <SecondaryButton
              title="Load more"
              loading={loadingMore}
              onPress={() => {
                const next = limit + PAGE_SIZE;
                setLimit(next);
                void load(next, true);
              }}
            />
          ) : (
            <Text style={{ textAlign: "center", color: colors.faint, fontSize: 13 }}>
              You&apos;ve reached the beginning of your record.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
