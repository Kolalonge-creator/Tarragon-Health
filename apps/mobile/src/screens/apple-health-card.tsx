import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isHealthKitAvailable } from "@/lib/healthkit";
import { syncAppleHealth, type HealthSyncResult } from "@/lib/health-sync";
import { colors } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton } from "@/ui/components";

/**
 * Apple Health card, shown above the Bluetooth device list.
 *
 * It sits on the Devices tab rather than in the WebView because HealthKit is
 * device-local: the web platform cannot reach it at all, which is the same
 * reason BLE pairing lives here. The card hides itself entirely on Android
 * and on any iOS device where HealthKit is unavailable, rather than showing
 * a button that cannot work.
 *
 * Copy follows the brand voice rules in docs/BRAND_GUIDE.md — warm, plain,
 * no alarm language, and honest that this reads and never writes.
 */
export function AppleHealthCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<HealthSyncResult | null>(null);

  useEffect(() => {
    let active = true;
    isHealthKitAvailable().then((value) => {
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
      setResult(await syncAppleHealth());
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
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>Apple Health</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            Bring across readings you already track on your iPhone
          </Text>
        </View>
      </View>

      <MutedText>
        We read your blood pressure, blood sugar, weight, oxygen level, resting heart rate and
        steps. Your care team sees them alongside everything else on your record. We never write
        anything back to Apple Health, and you choose what to share on the next screen. Once
        you&apos;ve synced, we&apos;ll also keep checking for new readings in the background; tap
        Sync any time you want the latest right now.
      </MutedText>

      <PrimaryButton
        title={syncing ? "Syncing…" : "Sync Apple Health"}
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
      <MutedText>
        Nothing new to bring across. If you expected readings here, check that TarragonHealth is
        turned on for them in the Health app under Sharing.
      </MutedText>
    );
  }

  if (result.status === "unavailable") {
    return <MutedText>Apple Health isn&apos;t available on this device.</MutedText>;
  }

  const saved = result.vitals + result.wearable;
  return (
    <Text style={{ color: colors.success, fontSize: 14, fontWeight: "600" }}>
      {saved === 0
        ? "Already up to date. These readings were on your record."
        : `Added ${saved} ${saved === 1 ? "reading" : "readings"} to your record.`}
    </Text>
  );
}
