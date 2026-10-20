import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { cleanPhoneName, PHONE_NAME_MAX, type PhoneView } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { lastTryAndCount, loadPhones, removePhone, savePhoneDetails, type ThisPhoneUnsent } from "@/lib/my-phones";
import { probeReachable } from "@/lib/reachability";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const formatWhen = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

interface Props {
  /** The signed-in person. This list is for this account only, never for someone being acted for. */
  userId: string;
  acting: boolean;
}

type Loaded = { state: "loading" } | { state: "failed"; offline: boolean } | { state: "ready"; phones: PhoneView[]; dropped: number };

export function MyPhonesScreen({ userId, acting }: Props) {
  const colors = useLegacyColors();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<{ id: string; counts: ThisPhoneUnsent | null; isThis: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (acting) return;
    const r = await loadPhones(userId);
    if (!mounted.current) return;
    if (r.ok) {
      setLoaded({ state: "ready", phones: r.phones, dropped: r.dropped });
      setStale(false);
      return;
    }
    const offline = !(await probeReachable(4000));
    if (!mounted.current) return;
    // A failed refresh after a change keeps the list the patient already has and says the refresh failed; it never replaces it with an error.
    setLoaded((prev) => (prev.state === "ready" ? prev : { state: "failed", offline }));
    setStale(true);
  }, [acting, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = async (ok: boolean, okText: string, failText: string) => {
    if (!mounted.current) return;
    setNotice({ error: !ok, text: ok ? okText : failText });
    if (ok) await load();
  };

  const saveName = async (id: string) => {
    setBusy(true);
    const ok = await savePhoneDetails(id, { label: cleanPhoneName(draft) }).finally(() => mounted.current && setBusy(false));
    if (ok && mounted.current) setEditing(null);
    await afterChange(ok, t("my_phones.saved"), t("my_phones.save_failed"));
  };

  const setShared = async (id: string, next: boolean) => {
    setBusy(true);
    const ok = await savePhoneDetails(id, { shared: next }).finally(() => mounted.current && setBusy(false));
    await afterChange(ok, t("my_phones.saved"), t("my_phones.save_failed"));
  };

  const askRemove = async (p: PhoneView) => {
    // For THIS phone: one last upload attempt first, then the real counts, before the patient confirms.
    setBusy(true);
    const counts = p.isThisPhone ? await lastTryAndCount(userId) : null;
    if (!mounted.current) return;
    setBusy(false);
    setRemoving({ id: p.deviceId, counts, isThis: p.isThisPhone });
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const outcome = await removePhone(removing.id, removing.isThis);
    // "cleared": this phone has wiped and signed out, so there is nothing left to reload or to say here.
    if (outcome === "cleared" || !mounted.current) return;
    setBusy(false);
    if (outcome === "failed") return afterChange(false, "", t("my_phones.remove_failed"));
    setRemoving(null);
    if (outcome === "filed_not_cleared") {
      setNotice({ error: true, text: t("my_phones.remove_this_waiting") });
      await load();
      return;
    }
    await afterChange(true, t("my_phones.remove_sent"), "");
  };

  const ink = { color: colors.ink };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>{t("my_phones.title")}</ScreenTitle>
        <MutedText>{t("my_phones.description")}</MutedText>
      </View>

      {acting ? (
        <Card>
          <MutedText>{t("my_phones.acting")}</MutedText>
        </Card>
      ) : loaded.state === "loading" ? (
        <ActivityIndicator accessibilityLabel={t("my_phones.title")} />
      ) : loaded.state === "failed" ? (
        <Card>
          <ErrorText>{loaded.offline ? t("my_phones.offline") : t("my_phones.failed")}</ErrorText>
          <SecondaryButton title={t("my_phones.retry")} onPress={() => void load()} />
        </Card>
      ) : (
        <>
          {loaded.dropped > 0 ? <MutedText>{t("my_phones.partial")}</MutedText> : null}
          {stale ? <ErrorText>{t("my_phones.stale")}</ErrorText> : null}
          {notice ? (
            <View accessibilityLiveRegion="polite">{notice.error ? <ErrorText>{notice.text}</ErrorText> : <MutedText>{notice.text}</MutedText>}</View>
          ) : null}
          {loaded.phones.length === 0 ? (
            <Card>
              <MutedText>{t("my_phones.empty")}</MutedText>
            </Card>
          ) : (
            loaded.phones.map((p) => {
              const manageable = p.status === "active" || p.status === "lapsed";
              return (
                <Card key={p.deviceId}>
                  <Text accessibilityRole="header" style={{ ...ink, fontWeight: "600", fontSize: 17 }}>
                    {p.name}
                    {p.isThisPhone ? `  (${t("my_phones.this_phone")})` : ""}
                    {p.shared ? `  (${t("my_phones.shared_badge")})` : ""}
                  </Text>
                  <MutedText>{t(`my_phones.status.${p.status}`)}</MutedText>
                  <Text style={ink}>{t("my_phones.last_seen", "en", { when: formatWhen(p.lastSeenAt) })}</Text>
                  {p.status === "active" ? <MutedText>{t("my_phones.lease", "en", { when: formatWhen(p.leaseExpiresAt) })}</MutedText> : null}
                  {p.status === "wiped" && p.unsentAtWipe !== null ? (
                    <Text style={ink}>
                      {p.unsentAtWipe === 0 ? t("my_phones.wiped_count_none") : t("my_phones.wiped_count", "en", { n: String(p.unsentAtWipe) })}
                      {p.urgentAtWipe ? ` ${t("my_phones.wiped_count_urgent", "en", { u: String(p.urgentAtWipe) })}` : ""}
                    </Text>
                  ) : null}

                  {manageable ? (
                    <View style={{ gap: 12, marginTop: 12 }}>
                      {editing === p.deviceId ? (
                        <View style={{ gap: 8 }}>
                          <Text style={ink}>{t("my_phones.rename_label")}</Text>
                          <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            maxLength={PHONE_NAME_MAX}
                            accessibilityLabel={t("my_phones.rename_label")}
                            style={{ ...ink, borderWidth: 1, borderColor: colors.border, borderRadius: 10, minHeight: 48, paddingHorizontal: 12 }}
                          />
                          <PrimaryButton title={t("my_phones.save")} onPress={() => void saveName(p.deviceId)} disabled={busy} />
                          <SecondaryButton title={t("my_phones.cancel")} onPress={() => setEditing(null)} />
                        </View>
                      ) : (
                        <SecondaryButton
                          title={t("my_phones.rename")}
                          onPress={() => {
                            setEditing(p.deviceId);
                            setDraft(p.nameIsDefault ? "" : p.name);
                          }}
                        />
                      )}

                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48 }}>
                        <Text style={{ ...ink, flex: 1, marginRight: 12 }}>{t("my_phones.shared_toggle")}</Text>
                        <Switch
                          value={p.shared}
                          disabled={busy}
                          onValueChange={(v) => void setShared(p.deviceId, v)}
                          accessibilityLabel={t("my_phones.shared_toggle")}
                        />
                      </View>
                      <MutedText>{t("my_phones.shared_hint")}</MutedText>

                      {removing?.id === p.deviceId ? (
                        <View accessibilityRole="alert" style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }}>
                          <Text style={{ ...ink, fontWeight: "600" }}>{t("my_phones.remove_title")}</Text>
                          <Text style={ink}>{t("my_phones.remove_body")}</Text>
                          <Text style={ink}>{t("my_phones.remove_last_try")}</Text>
                          <Text style={ink}>{t("my_phones.remove_urgent")}</Text>
                          {p.shared ? <Text style={ink}>{t("my_phones.remove_shared_warning")}</Text> : null}
                          {removing.isThis ? (
                            <>
                              {removing.counts ? (
                                <>
                                  <Text style={{ ...ink, fontWeight: "600" }}>
                                    {removing.counts.unsent === 0
                                      ? t("my_phones.remove_this_unsent_none")
                                      : t("my_phones.remove_this_unsent", "en", { n: String(removing.counts.unsent) })}
                                  </Text>
                                  {removing.counts.urgent > 0 ? (
                                    <Text style={ink}>{t("my_phones.remove_this_urgent", "en", { u: String(removing.counts.urgent) })}</Text>
                                  ) : null}
                                  {removing.counts.others > 0 ? (
                                    <Text style={ink}>{t("my_phones.remove_this_others", "en", { n: String(removing.counts.others) })}</Text>
                                  ) : null}
                                </>
                              ) : (
                                <Text style={{ ...ink, fontWeight: "600" }}>{t("my_phones.remove_this_unknown")}</Text>
                              )}
                              <Text style={ink}>{t("my_phones.remove_this_signout")}</Text>
                            </>
                          ) : null}
                          <PrimaryButton title={t("my_phones.remove_confirm")} onPress={() => void confirmRemove()} disabled={busy} />
                          <SecondaryButton title={t("my_phones.cancel")} onPress={() => setRemoving(null)} />
                        </View>
                      ) : (
                        <SecondaryButton title={t("my_phones.remove")} onPress={() => void askRemove(p)} disabled={busy} />
                      )}
                    </View>
                  ) : null}
                </Card>
              );
            })
          )}
        </>
      )}
    </ScrollView>
  );
}
