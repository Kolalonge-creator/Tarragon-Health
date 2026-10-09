import { useRef, useState } from "react";
import { Image, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { MessageKey } from "@tarragon/i18n";
import { composerEffect, type ComposerEffect, type ComposerResult } from "@/lib/community/compose";
import { pickAndPrepareImage } from "@/lib/community/image-prep";
import { createRequestIds, imageAspectRatio, type PreparedImage } from "@/lib/community/upload";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Field } from "@/ui/kit";
import { Status, TextAction, useCopy } from "./common";

export interface ComposerSubmitArgs {
  body: string;
  /** Kept across retries after a network failure; new after a definite answer. */
  clientRequestId: string;
  /** Null when the group does not allow pictures (the caller never sees a picture then) or none was chosen. */
  image: PreparedImage | null;
}

/**
 * The box for a post, a reply, an edit or a question for the doctors. The length limit comes from the group (`maxChars`), never from
 * this file. A picture can be added only where the group allows pictures (`imagesAllowed`), one per post, and only on a new post or
 * reply, never on an edit or a question.
 */
export function Composer({
  maxChars,
  submit,
  onEffect,
  label,
  submitLabel,
  placeholder,
  initialText = "",
  imagesAllowed = false,
}: {
  maxChars: number;
  submit: (args: ComposerSubmitArgs) => Promise<ComposerResult>;
  /** Called after every answer, so the screen can refresh, show the safety card or close an editor. */
  onEffect: (effect: ComposerEffect) => void;
  label: MessageKey;
  submitLabel: MessageKey;
  placeholder?: MessageKey;
  initialText?: string;
  imagesAllowed?: boolean;
}) {
  const copy = useCopy();
  const { colors } = useTheme();
  const [text, setText] = useState(initialText);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const ids = useRef(createRequestIds(() => randomUUID())).current;

  const used = text.length;
  const tooLong = used > maxChars;
  const empty = text.trim().length === 0;

  async function addPicture() {
    setMessage(null);
    const picked = await pickAndPrepareImage();
    if (picked.kind === "picked") setImage(picked.image);
    else if (picked.kind === "failed") setMessage("community.compose.refused.bad_image");
  }

  async function onSubmit() {
    if (pending || empty || tooLong) return;
    setPending(true);
    setMessage(null);
    let result: ComposerResult;
    try {
      result = await submit({ body: text, clientRequestId: ids.current(), image: imagesAllowed ? image : null });
    } catch {
      // Could not reach the server: keep the text and the same request id so pressing Post again cannot double-post.
      result = { kind: "failed", message: "community.compose.refused.other", definite: false };
    }
    setPending(false);
    const effect = composerEffect(result);
    if (effect.settleRequestId) ids.settle();
    if (effect.clearText) setText("");
    if (effect.clearPicture) setImage(null);
    setMessage(effect.message);
    onEffect(effect);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Field
        label={copy(label)}
        value={text}
        onChangeText={setText}
        placeholder={placeholder ? copy(placeholder) : undefined}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        editable={!pending}
        error={tooLong ? copy("community.compose.refused.too_long") : null}
      />
      <AppText variant="caption" tone="textMuted" accessibilityLabel={copy("community.post.counter", { used, max: maxChars })}>
        {copy("community.post.counter", { used, max: maxChars })}
      </AppText>

      {imagesAllowed ? (
        <View style={{ gap: space.sm }}>
          {image ? (
            <View style={{ gap: space.sm }}>
              <Image
                source={{ uri: image.uri }}
                accessibilityLabel={copy("community.image.alt")}
                style={{
                  width: "100%",
                  aspectRatio: imageAspectRatio(image.width ?? 0, image.height ?? 0),
                  borderRadius: radii.md,
                  backgroundColor: colors.surfaceMuted,
                }}
                resizeMode="contain"
              />
              <AppText variant="caption" tone="textMuted">
                {copy("community.image.waiting")}
              </AppText>
              <TextAction label={copy("community.image.remove")} onPress={() => setImage(null)} tone="dangerText" disabled={pending} />
            </View>
          ) : (
            <>
              <TextAction label={copy("community.image.add")} onPress={() => void addPicture()} disabled={pending} />
              <AppText variant="caption" tone="textSubtle">
                {copy("community.image.help")}
              </AppText>
            </>
          )}
        </View>
      ) : null}

      <Button
        title={pending ? (image ? copy("community.image.uploading") : copy("community.post.posting")) : copy(submitLabel)}
        onPress={() => void onSubmit()}
        disabled={empty || tooLong}
        loading={pending}
      />
      <Status text={message ? copy(message) : null} />
    </View>
  );
}
