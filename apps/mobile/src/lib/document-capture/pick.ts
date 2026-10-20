import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { DOCUMENT_MAX_BYTES } from "./prepare";
import { rotatedSize, type Rotation } from "./crop";

/**
 * Choosing the picture or the PDF (S43m). The system pickers only: the app never lists or scans the camera roll, and a picture is only opened when
 * the person chooses it. The camera path asks for camera permission and says so plainly when it is refused.
 */
export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  filename: string;
}

export type PickImageResult = { kind: "picked"; image: PickedImage } | { kind: "cancelled" } | { kind: "denied" } | { kind: "failed" };

const OPTIONS = { mediaTypes: ["images"] as ImagePicker.MediaType[], allowsEditing: false, allowsMultipleSelection: false, exif: false, quality: 0.9 };

function toPicked(result: ImagePicker.ImagePickerResult, fallbackName: string): PickImageResult {
  if (result.canceled || result.assets.length === 0) return { kind: "cancelled" };
  const a = result.assets[0]!;
  if (!a.width || !a.height) return { kind: "failed" };
  return { kind: "picked", image: { uri: a.uri, width: a.width, height: a.height, filename: a.fileName ?? fallbackName } };
}

export async function takeDocumentPhoto(): Promise<PickImageResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "denied" };
    return toPicked(await ImagePicker.launchCameraAsync(OPTIONS), "photo.jpg");
  } catch {
    return { kind: "failed" };
  }
}

export async function chooseDocumentPhoto(): Promise<PickImageResult> {
  try {
    return toPicked(await ImagePicker.launchImageLibraryAsync(OPTIONS), "photo.jpg");
  } catch {
    return { kind: "failed" };
  }
}

export type PickPdfResult = { kind: "picked"; bytes: Uint8Array; filename: string } | { kind: "cancelled" } | { kind: "too_big" } | { kind: "not_pdf" } | { kind: "failed" };

/** True for bytes that start with the PDF signature. A file with a .pdf name that is not one is refused. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function choosePdf(): Promise<PickPdfResult> {
  try {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true, multiple: false });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return { kind: "cancelled" };
    if (typeof asset.size === "number" && asset.size > DOCUMENT_MAX_BYTES) return { kind: "too_big" };
    const bytes = new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
    if (bytes.length > DOCUMENT_MAX_BYTES) return { kind: "too_big" };
    if (!looksLikePdf(bytes)) return { kind: "not_pdf" };
    return { kind: "picked", bytes, filename: asset.name || "document.pdf" };
  } catch {
    return { kind: "failed" };
  }
}

/** A small copy turned as the person chose, for the crop screen's preview only (never saved, never sent). */
export async function renderPreview(uri: string, width: number, height: number, rotation: Rotation): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const context = ImageManipulator.manipulate(uri);
    try {
      if (rotation !== 0) context.rotate(rotation);
      const size = rotatedSize(width, height, rotation);
      context.resize(size.width >= size.height ? { width: Math.min(size.width, 800) } : { height: Math.min(size.height, 800) });
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      context.release();
    }
  } catch {
    return null;
  }
}
