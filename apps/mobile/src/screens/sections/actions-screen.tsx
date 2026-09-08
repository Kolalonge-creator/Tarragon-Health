import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  loadActionCentreItems,
  bucketActionItems,
  daysLabel,
  type ActionItem,
  type BucketedActionItems,
} from "@/lib/actions";
import type { SectionId } from "@/lib/sections";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText } from "@/ui/components";

function ActionRow({ item, onPress }: { item: ActionItem; onPress: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = item.dueDate !== null && item.dueDate < today;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}
    >
      <Ionicons
        name={item.icon as keyof typeof Ionicons.glyphMap}
        size={18}
        color={colors.muted}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>
          {item.type}
        </Text>
        <Text style={{ fontSize: 14, color: colors.ink }}>{item.title}</Text>
      </View>
      {item.dueDate ? (
        <Text
          style={{
            fontSize: 12,
            fontWeight: isOverdue ? "700" : "400",
            color: isOverdue ? colors.danger : colors.muted,
            alignSelf: "center",
          }}
        >
          {daysLabel(item.dueDate)}
        </Text>
      ) : (
        <View style={{ alignSelf: "center" }}>
          <Badge tone="brand">Awaiting you</Badge>
        </View>
      )}
    </Pressable>
  );
}

function Bucket({
  title,
  items,
  danger,
  onNavigate,
}: {
  title: string;
  items: ActionItem[];
  danger?: boolean;
  onNavigate: (section: SectionId) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: danger ? colors.danger : colors.ink }}>{title}</Text>
      <Card style={{ paddingVertical: 2 }}>
        {items.map((item, i) => (
          <View key={i} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
            <ActionRow item={item} onPress={() => onNavigate(item.target)} />
          </View>
        ))}
      </Card>
    </View>
  );
}

interface ActionsScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * Basic native My actions — the Action Centre (spec §76.5): every
 * outstanding task in one place, grouped by urgency, tapping through to the
 * relevant section. Today's doses (the checklist with Taken/Missed/etc
 * actions) stays on the Medications screen rather than being duplicated
 * here — a shortcut card links there instead.
 */
export function ActionsScreen({ patientId, onNavigate }: ActionsScreenProps) {
  const [buckets, setBuckets] = useState<BucketedActionItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadActionCentreItems(patientId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setBuckets(bucketActionItems(result.data));
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const isEmpty =
    buckets &&
    buckets.highPriority.length === 0 &&
    buckets.dueToday.length === 0 &&
    buckets.dueThisWeek.length === 0 &&
    buckets.upcoming.length === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>My actions</Text>
        <MutedText>Everything outstanding, in one place, grouped by how soon it needs you.</MutedText>
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}

      {isEmpty && (
        <Card>
          <MutedText>
            You&apos;re all caught up. Nothing outstanding right now. Keep logging readings and
            we&apos;ll flag anything that needs your attention.
          </MutedText>
        </Card>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => onNavigate("medications")}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name="checkmark-done-outline" size={20} color={colors.brand} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink, flex: 1 }}>
            See today&apos;s doses
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Card>
      </Pressable>

      {buckets && (
        <>
          <Bucket title="High priority" items={buckets.highPriority} danger onNavigate={onNavigate} />
          <Bucket title="Due today" items={buckets.dueToday} onNavigate={onNavigate} />
          <Bucket title="Due this week" items={buckets.dueThisWeek} onNavigate={onNavigate} />
          <Bucket title="Upcoming" items={buckets.upcoming} onNavigate={onNavigate} />
        </>
      )}
    </ScrollView>
  );
}
