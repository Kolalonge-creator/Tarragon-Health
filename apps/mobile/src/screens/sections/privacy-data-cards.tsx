import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  DELETION_KEPT,
  DELETION_REMOVED,
  deletionGraceDays,
  deletionRequestView,
  exportRequestView,
  formatLagosDate,
} from "@tarragon/shared";
import {
  cancelDeletionRequest,
  createDeletionRequest,
  createExportRequest,
  type DeletionRequestRow,
  type ExportRequestRow,
} from "@/lib/privacy";
import { PLATFORM_URL } from "@/lib/platform-url";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const OPEN_EXPORT = new Set(["pending", "under_review"]);
const OPEN_DELETION = new Set(["pending", "under_review", "approved_partial", "approved_full"]);
const POSITIVE = new Set(["completed", "fulfilled", "approved_partial", "approved_full"]);

/**
 * Ask for a copy of your data (OQ-50). A person on our team checks every request, so this is not instant: the card states the
 * timeline and the status, and when the copy is ready it opens the signed-in web page where the file is downloaded (the
 * download is a browser file; the database refuses it unless a request has been fulfilled).
 */
export function ExportRequestCard({
  userId,
  organisationId,
  requests,
  blocked,
  onChanged,
}: {
  userId: string;
  organisationId: string;
  requests: ExportRequestRow[];
  /** True when the list of requests failed to load: starting a new one is disabled rather than shown against an empty list. */
  blocked: boolean;
  onChanged: () => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOpen = requests.some((r) => OPEN_EXPORT.has(r.status));

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createExportRequest(organisationId, userId, note.trim() || undefined);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setNote("");
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Get a copy of your data</Text>
      <MutedText>
        Ask for everything we hold about you. A person on our team checks every request before anything is released, so it is not an
        instant download. We aim to have it ready within 30 days, and often sooner.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      {open ? (
        <>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={note}
            onChangeText={setNote}
            placeholder="Anything specific you need? (optional)"
            multiline
            numberOfLines={2}
            style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Send request" onPress={submit} loading={submitting} />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </>
      ) : (
        <SecondaryButton title={hasOpen ? "Request in progress" : "Request my data"} onPress={() => setOpen(true)} disabled={hasOpen || blocked} />
      )}
      {requests.map((r) => {
        const view = exportRequestView({ status: r.status, requested_at: r.requestedAt, due_at: r.dueAt, fulfilled_at: r.fulfilledAt });
        return (
          <View key={r.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink }}>{view.headline}</Text>
              <Badge tone={POSITIVE.has(r.status) ? "brand" : "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
            </View>
            <MutedText>{`Asked ${formatLagosDate(r.requestedAt)}. ${view.detail}`}</MutedText>
            {view.canDownload ? (
              <PrimaryButton
                title="Open the download page (sign in on the web)"
                onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/privacy`)}
              />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

/**
 * Close your account and erase what the law allows (OQ-50). A waiting period lets you change your mind and cancel; after it
 * a person reviews the request. Clinical records, the audit log and ledger entries are kept, and the card says so before asking.
 */
export function DeletionRequestCard({
  userId,
  organisationId,
  requests,
  blocked,
  onChanged,
}: {
  userId: string;
  organisationId: string;
  requests: DeletionRequestRow[];
  /** True when the list of requests failed to load: a pending request and its cancel button could be hidden, so asking is disabled. */
  blocked: boolean;
  onChanged: () => void;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOpen = requests.some((r) => OPEN_DELETION.has(r.status));

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createDeletionRequest(organisationId, userId, reason.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setReason("");
    onChanged();
  }

  async function cancel(id: string) {
    setError(null);
    setSubmitting(true);
    const result = await cancelDeletionRequest(id);
    setSubmitting(false);
    setConfirmCancel(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Close my account and erase my data</Text>
      <MutedText>
        {`You can ask us to close your account. We wait ${deletionGraceDays()} days first so you can change your mind, then our team reviews the request and tells you exactly what was done.`}
      </MutedText>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>What we remove</Text>
      {DELETION_REMOVED.map((t) => (
        <MutedText key={t}>{`• ${t}`}</MutedText>
      ))}
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>What we have to keep</Text>
      {DELETION_KEPT.map((t) => (
        <MutedText key={t}>{`• ${t}`}</MutedText>
      ))}
      <MutedText>The law and clinical safety require these, so closing your account does not erase them.</MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      {open ? (
        <>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={reason}
            onChangeText={setReason}
            placeholder="Anything you would like us to know? (optional)"
            multiline
            numberOfLines={3}
            style={[textInputStyle, { minHeight: 60, textAlignVertical: "top" }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title={`Yes, start the ${deletionGraceDays()}-day wait`} onPress={submit} loading={submitting} />
            <SecondaryButton title="Not now" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </>
      ) : (
        <SecondaryButton title={hasOpen ? "Request in progress" : "Close my account"} onPress={() => setOpen(true)} disabled={hasOpen || blocked} />
      )}
      {requests.map((r) => {
        const view = deletionRequestView({ status: r.status, requested_at: r.requestedAt, grace_ends_at: r.graceEndsAt });
        return (
          <View key={r.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.ink }}>{view.headline}</Text>
              <Badge tone={POSITIVE.has(r.status) ? "brand" : "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
            </View>
            <MutedText>{`Asked ${formatLagosDate(r.requestedAt)}. ${view.detail}`}</MutedText>
            {r.note && (r.status === "completed" || r.status === "approved_partial" || r.status === "denied") ? (
              <MutedText>{`Note from our team: ${r.note}`}</MutedText>
            ) : null}
            {view.canCancel ? (
              confirmCancel === r.id ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <SecondaryButton title="Yes, cancel my request" onPress={() => void cancel(r.id)} disabled={submitting} />
                  <SecondaryButton title="Keep it" onPress={() => setConfirmCancel(null)} disabled={submitting} />
                </View>
              ) : (
                <SecondaryButton title="Cancel this request" onPress={() => setConfirmCancel(r.id)} />
              )
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}
