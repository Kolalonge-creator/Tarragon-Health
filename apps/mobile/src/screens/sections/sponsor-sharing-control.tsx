import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { Enums } from "@tarragon/shared";
import { loadMySponsorSharing, setSponsorSharing, type SponsorSharingPreference } from "@/lib/sponsor-care-report";
import { colors, radius } from "@/ui/theme";
import { Card, MutedText, SectionLabel } from "@/ui/components";

const LEVEL_COPY: Record<Enums<"sponsor_sharing_level">, { title: string; body: string }> = {
  none: {
    title: "Only that they paid",
    body: "They can see what they bought and whether you have used it. Nothing about how you are doing.",
  },
  activity: {
    title: "That, plus how it is going",
    body: "They also see how many readings you logged, that a doctor reviewed them, and when your next check is due. Never your actual numbers, results or diagnoses.",
  },
  full: {
    title: "That, plus your progress report",
    body: "Everything above, plus the quarterly progress report you can already download yourself.",
  },
};

const LEVELS: Enums<"sponsor_sharing_level">[] = ["none", "activity", "full"];

/**
 * The patient's side of the sponsor boundary — mirrors
 * apps/web/src/components/sponsor-care-report.tsx's SponsorSharingControl.
 * Deliberately framed as a decision the patient is making about a person,
 * not a privacy setting buried in a list. Default is 'none' and that is
 * stated, so nobody has to discover what is being shared after the fact.
 */
export function SponsorSharingControl({ organisationId }: { organisationId: string }) {
  const [preferences, setPreferences] = useState<SponsorSharingPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMySponsorSharing();
    if (result.ok) setPreferences(result.data);
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  async function choose(sponsorId: string, level: Enums<"sponsor_sharing_level">) {
    setSaving(sponsorId);
    const result = await setSponsorSharing({ organisationId, sponsorId, level });
    setSaving(null);
    if (result.ok) void refresh();
  }

  if (loading || preferences.length === 0) return null;

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
          What the people paying for your care can see
        </Text>
        <MutedText>
          Someone paying for your care can always see what they bought and whether you used it.
          Anything beyond that is your decision, and you can change it whenever you like.
        </MutedText>
      </View>
      {preferences.map((preference) => (
        <View key={preference.id} style={{ gap: 8 }}>
          <SectionLabel>{preference.sponsor?.full_name ?? "Someone supporting you"}</SectionLabel>
          <View style={{ gap: 6 }}>
            {LEVELS.map((level) => {
              const selected = preference.level === level;
              return (
                <Text
                  key={level}
                  onPress={() => !saving && choose(preference.sponsor_id, level)}
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? colors.brand : colors.border,
                    backgroundColor: selected ? colors.brandTint : "transparent",
                    borderRadius: radius.control,
                    padding: 10,
                    opacity: saving === preference.sponsor_id ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>
                    {selected ? "● " : "○ "}
                    {LEVEL_COPY[level].title}
                  </Text>
                  {"\n"}
                  <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 16 }}>{LEVEL_COPY[level].body}</Text>
                </Text>
              );
            })}
          </View>
        </View>
      ))}
    </Card>
  );
}
