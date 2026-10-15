import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { draftFromRecognisedText, finalisePhotoReading, type ConfirmInput, type PhotoDeviceKind, type PhotoDraft, type PhotoReadingPayload } from "@tarragon/shared";
import type { PhotoReadingRequest } from "./api";

/**
 * Photo reading capture (S70a, 18.3). The camera and the text recognition stay on the phone: the photo is never uploaded and no cloud vision
 * model is involved. What leaves the phone is the numbers the person checked and ticked, nothing else.
 *
 * TEXT RECOGNITION IS A SEAM. This build ships no on-device recogniser, because one needs a new native module (for example an ML Kit text
 * recognition package, exact package to be confirmed) and a native module needs a fresh EAS build and a runtimeVersion bump before any OTA
 * publish. Neither was done here (docs/design/S70a.md). Until a recogniser is registered the screen still works: it shows the person's
 * photo beside empty boxes and they type what they see, then confirm it exactly as they would with a recogniser's suggestions. Nothing
 * downstream changes when one is registered.
 */
export interface TextRecogniser {
  /** Recognised lines of text in reading order. Must run on the device and must never send the image anywhere. */
  recognise(imageUri: string): Promise<string[]>;
}

let recogniser: TextRecogniser | null = null;

export function registerTextRecogniser(next: TextRecogniser | null): void {
  recogniser = next;
}

export function hasTextRecogniser(): boolean {
  return recogniser !== null;
}

export type TakePhotoResult = { ok: true; uri: string } | { ok: false; reason: "denied" | "cancelled" | "unavailable" };

/** Opens the camera. The picture is kept in the app's own cache and is never uploaded. */
export async function takeDevicePhoto(): Promise<TakePhotoResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: "denied" };
    const picked = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, allowsEditing: false });
    if (picked.canceled || !picked.assets[0]) return { ok: false, reason: "cancelled" };
    return { ok: true, uri: picked.assets[0].uri };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * A draft for the person to check. A recogniser that fails or finds nothing gives empty boxes, never an error: the person can always type it.
 */
export async function draftFromPhoto(kind: PhotoDeviceKind, imageUri: string): Promise<PhotoDraft> {
  if (!recogniser) return draftFromRecognisedText(kind, []);
  try {
    return draftFromRecognisedText(kind, await recogniser.recognise(imageUri));
  } catch {
    return draftFromRecognisedText(kind, []);
  }
}

/**
 * The request the server expects, from a confirmed reading. `confirmed: true` is only ever set here, after finalisePhotoReading has
 * refused anything the person has not ticked; there is no other way to build the request.
 */
export function buildPhotoRequest(reading: PhotoReadingPayload, takenAt: Date, subjectId?: string, clientReadingId: string = Crypto.randomUUID()): PhotoReadingRequest {
  const { vital_type: _ignored, ...rest } = reading;
  void _ignored;
  return {
    client_reading_id: clientReadingId,
    taken_at: takenAt.toISOString(),
    confirmed: true,
    ...(subjectId ? { patient_id: subjectId } : {}),
    reading: { vital_type: reading.vital_type, ...rest },
  };
}

export { finalisePhotoReading };
export type { ConfirmInput };
