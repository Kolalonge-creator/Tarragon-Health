import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isHealthConnectAvailable } from "@/lib/health-connect";
import { syncHealthConnect, type HealthSyncResult } from "@/lib/health-sync";
import { colors } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/components";

/**
 * Android Health Connect card — the Android peer of apple-health-card.tsx,
 * same structure and copy tone deliberately so the two platforms read as
 * one feature rather than two. Replaces the "not yet built" placeholder
 * that lived on the Devices tab (devices-screen.tsx) before this bridge was
 * built; see health-connect.ts for the read path itself.
 *
 * Hides itself entirely on iOS and on any Android device where Health
 * Connect isn't available (not installed, or an old OS with no path to
 * install it), rather than showing a button that cannot work — same rule
 * apple-health-card.tsx follows.
 */
export function AndroidHealthConnectCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<HealthSyncResult | null>(null);

  useEffect(() => {
    let active = true;
    isHealthConnectAvailable().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setResult(null);
    try {
      setResult(await syncHealthConnect());
    } finally {
      setSyncing(false);
    }
  }, []);

  if (available !== true) return null;

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "#E8F3EE",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="fitness-outline" size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>Health Connect</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            Bring across readings you already track on your phone
          </Text>
        </View>
      </View>

      <MutedText>
        We read your blood pressure, blood sugar, weight, oxygen level, resting heart rate and
        steps. Your care team sees them alongside everything else on your record. We never write
        anything back to Health Connect, and you choose what to share on the next screen. Once
        you&apos;ve synced, we&apos;ll also keep checking for new readings in the background — tap
        Sync any time you want the latest right now.
      </MutedText>

      <PrimaryButton
        title={syncing ? "Syncing…" : "Sync Health Connect"}
        onPress={handleSync}
        disabled={syncing}
        loading={syncing}
      />

      {result ? <SyncMessage result={result} /> : null}
    </Card>
  );
}

function SyncMessage({ result }: { result: HealthSyncResult }) {
  if (result.status === "error") return <ErrorText>{result.message}</ErrorText>;

  if (result.status === "no_new_data") {
    return (
      <View style={{ gap: 4 }}>
        <MutedText>
          Nothing new to bring across. If you expected readings here, check that TarragonHealth has
          permission for them in Health Connect&apos;s app settings.
        </MutedText>
        {result.partial ? <PartialSyncNote /> : null}
      </View>
    );
  }

  if (result.status === "unavailable") {
    return <MutedText>Health Connect isn&apos;t available on this device.</MutedText>;
  }

  const saved = result.vitals + result.wearable;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.success, fontSize: 14, fontWeight: "600" }}>
        {saved === 0
          ? "Already up to date — these readings were on your record."
          : `Added ${saved} ${saved === 1 ? "reading" : "readings"} to your record.`}
      </Text>
      {result.partial ? <PartialSyncNote /> : null}
    </View>
  );
}

/** Shown when at least one reading type couldn't be checked this attempt
 * (see sync-diagnostics.ts) — kept low-key rather than an error, since the
 * sync still ran and a later attempt (manual or the background task) simply
 * retries the same delta. */
function PartialSyncNote() {
  return <MutedText>Some readings couldn&apos;t be checked this time — we&apos;ll try again.</MutedText>;
}
