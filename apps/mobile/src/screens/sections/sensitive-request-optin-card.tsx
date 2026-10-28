import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { loadSensitiveOptin, sensitiveOptinView, setSensitiveOptin, type SensitiveOptin } from "@/lib/sensitive-request-optin";
import { Card, ErrorText, MutedText, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";

/** Opt-in to automatic test requests for private tests. Hidden while the feature is not available (guard off) and the patient has not opted in. */
export function SensitiveRequestOptinCard() {
  const [state, setState] = useState<SensitiveOptin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await loadSensitiveOptin();
    if (res.ok) setState(res.data);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = sensitiveOptinView(state);
  if (view === "hidden") return null;
  const on = view === "on";

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await setSensitiveOptin(!on);
    setBusy(false);
    if (!res.ok) setError("We could not save that. Please try again.");
    await refresh();
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>Automatic requests for private tests</SectionLabel>
      <Card style={{ gap: 8 }}>
        <MutedText>
          Some tests are more private, such as tests for infections. When one is due, we can get the printable request ready for you, so you do not
          have to ask. The messages we send never say which test it is. The name appears only on the request itself, which only you can open.
        </MutedText>
        <MutedText>{on ? "This is on. We will get these requests ready for you." : "This is off. We will not prepare these requests unless you ask."}</MutedText>
        <SecondaryButton title={on ? "Turn off" : "Turn on"} onPress={toggle} disabled={busy} />
        <MutedText>You can change this at any time. Turning it off stops new requests; it does not remove any request you already have.</MutedText>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
    </View>
  );
}
