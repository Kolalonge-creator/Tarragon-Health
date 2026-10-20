import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { loadDocuments, rejectReading, requestReading, type DocumentListItem, type ReadingOutcome } from "@/lib/document-capture/capture";
import { formatPassportDate } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, EmptyState, InlineAlert, Screen } from "@/ui/kit";
import { LoadFailed, PassportHeader, StaleNotice } from "@/screens/sections/passport-parts";
import { AddFlow } from "./add-flow";
import { DocumentView } from "./document-view";

interface Props {
  userId: string;
  organisationId: string;
  /** Documents are the signed-in person's own. While acting for someone else the screen is not offered. */
  acting: boolean;
}

type ListState =
  | { kind: "loading" }
  | { kind: "failed"; offline: boolean; refused: boolean }
  | { kind: "ready"; docs: DocumentListItem[]; stale: { offline: boolean; savedAt: string } | null };

type View_ = { kind: "list" } | { kind: "add" } | { kind: "open"; doc: DocumentListItem };

function savedMessage(reading: ReadingOutcome): string {
  if (reading === "asked") return t("mpass.doc.saved_asked");
  if (reading === "failed") return t("mpass.doc.saved_ask_failed");
  return t("mpass.doc.saved_closed");
}

function stateLine(doc: DocumentListItem): string | null {
  if (doc.ocrState === null) return t("mpass.doc.state.none");
  if (doc.ocrState === "suggested") return t("mpass.doc.state.suggested");
  return t(`passport.documents.state.${doc.ocrState}` as MessageKey);
}

/**
 * Photos of paper results, prescriptions, vaccination cards and discharge summaries (S43, spec 2.3). The photo is always kept. While reading from
 * photos is switched off (it is), the photo is simply saved with your record and the screen says nothing was read. When it is switched on, details
 * are read into SUGGESTIONS that the person checks one by one: nothing is part of the record until it is kept, and a rejected reading leaves nothing.
 */
export function DocumentsScreen({ userId, organisationId, acting }: Props) {
  const { colors } = useTheme();
  const [view, setView] = useState<View_>({ kind: "list" });
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++latest.current;
      const r = await loadDocuments(userId);
      if (mine !== latest.current) return;
      if (quiet && (!r.ok || r.stale)) return;
      if (!r.ok) setList({ kind: "failed", offline: r.offline, refused: r.refused });
      else setList({ kind: "ready", docs: r.data, stale: r.stale ? { offline: r.offline, savedAt: r.savedAt } : null });
    },
    [userId]
  );

  useEffect(() => {
    if (!acting) void load();
  }, [acting, load]);

  const live = list.kind === "ready" && list.stale === null;

  async function readNow(id: string) {
    setMessage(null);
    setBusyId(id);
    const r = await requestReading(id);
    setBusyId(null);
    setMessage(r.ok ? { tone: "info", text: t("mpass.doc.asked_again") } : { tone: r.offline ? "info" : "danger", text: r.offline ? t("mpass.needs_connection") : t("mpass.doc.ask_failed") });
    await load(true);
  }

  async function notNow(id: string) {
    setMessage(null);
    setBusyId(id);
    const r = await rejectReading(id);
    setBusyId(null);
    if (r.ok) setMessage({ tone: "info", text: t("mpass.doc.rejected_done") });
    else setMessage({ tone: r.reason === "offline" ? "info" : "danger", text: r.reason === "offline" ? t("mpass.needs_connection") : t("mpass.save_failed") });
    await load(true);
  }

  if (acting) {
    return (
      <Screen edges={[]}>
        <PassportHeader title={t("passport.documents.title")} />
        <InlineAlert tone="info" message={t("passport.documents.own_only")} />
      </Screen>
    );
  }

  if (view.kind === "add") {
    return (
      <Screen edges={[]}>
        <AddFlow
          userId={userId}
          organisationId={organisationId}
          onCancel={() => setView({ kind: "list" })}
          onSaved={(reading) => {
            setMessage({ tone: "info", text: savedMessage(reading) });
            setView({ kind: "list" });
            void load(true);
          }}
        />
      </Screen>
    );
  }

  if (view.kind === "open") {
    return (
      <Screen edges={[]}>
        <DocumentView
          doc={view.doc}
          onBack={() => setView({ kind: "list" })}
          onChanged={(text) => {
            setMessage({ tone: "info", text });
            setView({ kind: "list" });
            void load(true);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PassportHeader title={t("passport.documents.title")} description={t("passport.documents.description")} />
      <Button title={t("mpass.doc.add")} onPress={() => setView({ kind: "add" })} />
      {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}

      {list.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {list.kind === "failed" ? <LoadFailed offline={list.offline} refused={list.refused} onRetry={() => void load()} /> : null}
      {list.kind === "ready" ? (
        <>
          {list.stale ? <StaleNotice offline={list.stale.offline} savedAt={list.stale.savedAt} /> : null}
          {list.stale ? <AppText variant="caption" tone="textMuted">{t("mpass.doc.details_online")}</AppText> : null}
          {list.docs.length === 0 ? (
            <EmptyState icon="vitals" title={t("passport.documents.none")} />
          ) : (
            list.docs.map((doc) => (
              <Card key={doc.id} style={{ gap: space.xs }}>
                <AppText variant="bodyStrong">{t(`passport.documents.type.${doc.documentType}` as MessageKey)}</AppText>
                <AppText variant="caption" tone="textMuted">
                  {formatPassportDate(doc.createdAt)}
                  {doc.filename ? ` · ${doc.filename}` : ""}
                </AppText>
                <AppText variant="caption" tone="textMuted">
                  {stateLine(doc)}
                </AppText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm }}>
                  {doc.ocrState === "pending" ? (
                    <>
                      <Button title={t("passport.documents.read_now")} variant="secondary" fullWidth={false} disabled={!live || busyId === doc.id} onPress={() => void readNow(doc.id)} />
                      <Button title={t("passport.documents.not_now")} variant="secondary" fullWidth={false} disabled={!live || busyId === doc.id} onPress={() => void notNow(doc.id)} />
                    </>
                  ) : null}
                  <Button
                    title={doc.ocrState === "suggested" ? t("mpass.doc.open") : doc.ocrState === "confirmed" ? t("mpass.doc.open_confirmed") : t("passport.documents.view_photo")}
                    variant={doc.ocrState === "suggested" ? "primary" : "secondary"}
                    fullWidth={false}
                    disabled={!live}
                    onPress={() => setView({ kind: "open", doc })}
                  />
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
