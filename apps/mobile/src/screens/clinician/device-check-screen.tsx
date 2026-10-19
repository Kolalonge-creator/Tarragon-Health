import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { DEVICE_GUIDES, GENERAL_DEVICE_STEPS } from "@tarragon/shared";
import { AppText, Button, Card, Chip, InlineAlert } from "@/ui/kit";
import { space } from "@/ui/design";
import { PAGE_CHANNEL_ID, readPageChannelState, type PageChannelState } from "@/lib/paging/page-channel";
import { channelSettingsIntent, DO_NOT_DISTURB_ACCESS_ACTION, guideSummary } from "@/lib/paging/device-check-model";

const ANDROID_PACKAGE = "com.tarragonhealth.app";

/**
 * Battery and alarm set-up for this phone (S19e): the maker steps for Tecno, Infinix, Xiaomi and Samsung (the same text the web Device
 * check shows, from @tarragon/shared), the state of the alarm channel as the phone reports it, and shortcuts to the settings screens
 * that matter. The steps are what the phone makers publish; they are untested on real handsets and menu names change, so the test page
 * on the On call screen is the real check. Never run on a real device.
 */
export function DeviceCheckScreen({ onBack }: { onBack: () => void }) {
  const [brand, setBrand] = useState<string>(DEVICE_GUIDES[0]?.brand ?? "");
  const [channel, setChannel] = useState<PageChannelState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const guide = DEVICE_GUIDES.find((g) => g.brand === brand) ?? DEVICE_GUIDES[0];

  useEffect(() => {
    void readPageChannelState().then(setChannel);
  }, []);

  const open = async (action: () => Promise<unknown>) => {
    setNote(null);
    try {
      await action();
    } catch {
      setNote("That settings screen could not be opened. Open your phone's Settings, then Apps, then TarragonHealth.");
    }
  };

  const android = Platform.OS === "android";
  return (
    <View style={{ gap: space.lg }}>
      <Button title="Back to On call" variant="ghost" onPress={onBack} fullWidth={false} />
      <AppText variant="headline" heading>
        Battery and alarm set-up
      </AppText>
      <AppText variant="body" tone="textMuted">
        Pages reach you by notification, in the app and by email. Phones often stop apps in the background to save battery. Follow the steps for your phone, then send yourself a test page from the On call screen.
      </AppText>
      {note ? <InlineAlert message={note} tone="warn" /> : null}

      {android ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title" heading>
            Alarm channel on this phone
          </AppText>
          {channel === null ? (
            <AppText variant="body" tone="textMuted">
              The phone did not say. Open the notification settings below to check it yourself.
            </AppText>
          ) : (
            <>
              <AppText variant="body">{channel.exists ? (channel.loud ? "Pages are set to sound loudly." : "Pages are set quieter than intended. Turn the sound up in the channel settings.") : "The alarm channel has not been created yet. Reopen the app while signed in."}</AppText>
              <AppText variant="body">{channel.overridesDoNotDisturb ? "Pages may come through Do Not Disturb." : "Pages will NOT come through Do Not Disturb yet. Allow Do Not Disturb access for TarragonHealth, then allow the channel to override it."}</AppText>
            </>
          )}
          <Button title="Open alarm channel settings" variant="secondary" onPress={() => void open(() => Linking.sendIntent(channelSettingsIntent(ANDROID_PACKAGE, PAGE_CHANNEL_ID).action, channelSettingsIntent(ANDROID_PACKAGE, PAGE_CHANNEL_ID).extras))} />
          <Button title="Open Do Not Disturb access" variant="secondary" onPress={() => void open(() => Linking.sendIntent(DO_NOT_DISTURB_ACCESS_ACTION))} />
        </Card>
      ) : (
        <Card style={{ gap: space.sm }}>
          <AppText variant="body">On iPhone, allow TarragonHealth in every Focus you use, and keep Time Sensitive notifications on. Pages cannot yet sound through a silenced phone.</AppText>
          <Button title="Open notification settings" variant="secondary" onPress={() => void open(() => Linking.openSettings())} />
        </Card>
      )}

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          Steps for your phone
        </AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityRole="radiogroup">
          {DEVICE_GUIDES.map((g) => (
            <Chip key={g.brand} label={g.brand} selected={g.brand === brand} onPress={() => setBrand(g.brand)} />
          ))}
        </View>
        {guide ? (
          <>
            <AppText variant="body" tone="textMuted">
              {guideSummary(guide)}
            </AppText>
            {guide.steps.map((s, i) => (
              <AppText key={s} variant="body">{`${i + 1}. ${s}`}</AppText>
            ))}
          </>
        ) : null}
        <Button title="Open app settings" variant="secondary" onPress={() => void open(() => Linking.openSettings())} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <AppText variant="title" heading>
          For every phone
        </AppText>
        {GENERAL_DEVICE_STEPS.map((s) => (
          <AppText key={s} variant="body">{`• ${s}`}</AppText>
        ))}
        <AppText variant="body" tone="textMuted">
          These steps are the ones phone makers publish. Menu names change between versions and they have not been tested on every handset, so trust the test page over this list.
        </AppText>
      </Card>
    </View>
  );
}
