import { useEffect, useMemo, useState } from "react";
import { AppState, Linking, ScrollView, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { RoomController, noteMessageKey, type RoomState } from "@/lib/consultation-room-controller";
import { answerScribeConsent, loadRoomView, reportNobodyCame, requestDialIn, requestJoin } from "@/lib/consultations";
import {
  canTellNobodyCame,
  canWithdrawScribe,
  formatWhen,
  isCareTeamIn,
  joinAvailability,
  roomPhase,
  shouldAskScribe,
  telUrl,
} from "@/lib/consultation-room-model";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, InlineAlert, Skeleton, SkeletonGroup } from "@/ui/kit";

interface ConsultationRoomScreenProps {
  encounterId: string;
  onBack: () => void;
}

/**
 * The patient's consultation room on the phone (S21 follow-up, OQ-158): the waiting room, the AI note-taker question, joining with
 * video or audio only (the server issues the link, which is handed to the Zoom app and never kept), the phone-call fallback, and
 * "tell us nobody came". Everything it does goes through the same database functions and room logic as the web room.
 *
 * NOT run on a real phone: there is no EAS dev-client build for this app yet. The state machine under it is covered by Jest
 * (src/lib/consultation-room-controller.test.ts); this file only draws that state.
 */
export function ConsultationRoomScreen({ encounterId, onBack }: ConsultationRoomScreenProps) {
  const { colors } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  const controller = useMemo(
    () =>
      new RoomController(encounterId, {
        loadRoom: loadRoomView,
        join: requestJoin,
        dialIn: requestDialIn,
        answerScribe: answerScribeConsent,
        reportNobodyCame,
        openUrl: (url) => Linking.openURL(url),
      }),
    [encounterId],
  );
  const [state, setState] = useState<RoomState>(controller.getState());

  useEffect(() => {
    const off = controller.subscribe(setState);
    setState(controller.getState());
    controller.start();
    // Nothing is polled while the app is in the background; it catches up the moment it returns.
    const sub = AppState.addEventListener("change", (s) => controller.setForeground(s === "active"));
    return () => {
      sub.remove();
      off();
      controller.stop();
    };
  }, [controller]);

  const { view } = state;
  const back = <Button title={tr("consult.mobile.back")} variant="ghost" fullWidth={false} onPress={onBack} />;

  if (state.loading) {
    return (
      <View style={{ flex: 1, padding: space.xl, gap: space.lg, backgroundColor: colors.canvas }}>
        {back}
        <SkeletonGroup label={tr("consult.mobile.loading")}>
          <Skeleton height={120} width="100%" />
        </SkeletonGroup>
      </View>
    );
  }

  if (!view) {
    return (
      <View style={{ flex: 1, padding: space.xl, gap: space.lg, backgroundColor: colors.canvas }}>
        {back}
        {state.offline ? (
          <>
            <InlineAlert tone="info" message={tr("consult.mobile.offline")} />
            <Button title={tr("consult.mobile.retry")} variant="secondary" onPress={() => void controller.refresh()} />
          </>
        ) : (
          <AppText variant="body" tone="textMuted">
            {tr("consult.mobile.not_found")}
          </AppText>
        )}
      </View>
    );
  }

  const phase = roomPhase(view);
  const noteText = state.note
    ? tr(noteMessageKey(state.note), { when: formatWhen(view.join_opens_at) })
    : null;

  if (phase !== "waiting_room") {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        {back}
        <Card style={{ gap: space.sm }}>
          <AppText variant="title" heading>
            {tr("consult.room.title")}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {formatWhen(view.scheduled_at)}
          </AppText>
          <AppText variant="body" accessibilityLiveRegion="polite">
            {tr(phase === "cancelled" ? "consult.room.cancelled" : "consult.room.ended")}
          </AppText>
        </Card>
      </ScrollView>
    );
  }

  const join = joinAvailability(view);
  const dial = state.dialIn;
  const firstNumber = dial?.numbers[0]?.number ?? null;
  const firstTel = firstNumber ? telUrl(firstNumber) : null;
  const otherNumbers = dial ? dial.numbers.slice(1).map((n) => n.number) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
      {back}

      {state.offline ? <InlineAlert tone="info" message={tr("consult.mobile.offline")} /> : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("consult.room.title")}
        </AppText>
        <AppText variant="caption" tone="textMuted">
          {tr("consult.room.when", { when: formatWhen(view.scheduled_at) })}
        </AppText>
        <AppText variant="body" accessibilityLiveRegion="polite">
          {tr(isCareTeamIn(view) ? "consult.room.connected" : "consult.room.waiting")}
        </AppText>
        {view.final_media_mode === "audio_only" ? <AppText variant="body">{tr("consult.room.mode_audio")}</AppText> : null}
        {!view.joinable ? (
          <AppText variant="body" tone="textMuted">
            {tr("consult.room.not_open", { when: formatWhen(view.join_opens_at) })}
          </AppText>
        ) : null}
        <Button
          title={tr("consult.room.join_video")}
          onPress={() => void controller.join("video")}
          disabled={!join.video || state.busy}
        />
        <Button
          title={tr("consult.room.join_audio")}
          variant="secondary"
          onPress={() => void controller.join("audio_only")}
          disabled={!join.audio || state.busy}
          accessibilityHint={tr("consult.room.audio_hint")}
        />
        {state.audioHint ? <AppText variant="body">{tr("consult.room.audio_hint")}</AppText> : null}
        {noteText ? <InlineAlert tone="info" message={noteText} /> : null}
      </Card>

      {shouldAskScribe(view) ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("consult.scribe.title")}
          </AppText>
          <AppText variant="body">{tr("consult.scribe.body")}</AppText>
          <Button title={tr("consult.scribe.allow")} onPress={() => void controller.answerScribe(true)} disabled={state.busy} />
          <Button title={tr("consult.scribe.decline")} variant="secondary" onPress={() => void controller.answerScribe(false)} disabled={state.busy} />
        </Card>
      ) : view.scribe.granted !== null ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="body" accessibilityLiveRegion="polite">
            {tr("consult.scribe.saved")}
          </AppText>
          {canWithdrawScribe(view) ? (
            <Button title={tr("consult.scribe.withdraw")} variant="secondary" onPress={() => void controller.answerScribe(false)} disabled={state.busy} />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <AppText variant="body">{tr("consult.room.call_me_hint")}</AppText>
        <Button title={tr("consult.room.call_me")} variant="secondary" onPress={() => void controller.phoneFallback()} disabled={state.busy} />
        {dial && firstNumber ? (
          <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
            <AppText variant="body">
              {tr(dial.passcode ? "consult.room.phone_steps" : "consult.room.phone_steps_nocode", {
                number: firstNumber,
                id: dial.meetingId,
                code: dial.passcode ?? "",
              })}
            </AppText>
            {firstTel ? (
              <Button
                title={tr("consult.mobile.call_number", { number: firstNumber })}
                onPress={() => void Linking.openURL(firstTel).catch(() => {})}
              />
            ) : null}
            <AppText variant="label">{tr("consult.mobile.meeting_id", { id: dial.meetingId })}</AppText>
            {dial.passcode ? <AppText variant="label">{tr("consult.mobile.passcode", { code: dial.passcode })}</AppText> : null}
            {otherNumbers.length > 0 ? (
              <AppText variant="caption" tone="textMuted">
                {tr("consult.room.phone_more_numbers")} {otherNumbers.join(", ")}
              </AppText>
            ) : null}
            <AppText variant="caption" tone="textMuted">
              {tr("consult.room.phone_cost")}
            </AppText>
          </View>
        ) : null}
      </Card>

      {canTellNobodyCame(view) ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {tr("consult.room.nobody_came")}
          </AppText>
          <AppText variant="body">{tr("consult.room.nobody_came_hint", { minutes: view.clinician_wait_minutes })}</AppText>
          <Button title={tr("consult.room.nobody_came_action")} variant="secondary" onPress={() => void controller.tellNobodyCame()} disabled={state.busy} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
