import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { resizeTarget } from "../written-questions/photo-resize";
import { IMAGE_JPEG_QUALITY, IMAGE_MAX_SIDE, type PreparedImage } from "./upload";

/**
 * Choosing and preparing the one picture of a post. The only module (besides the written-question photo code) that touches the picker
 * and the image manipulator.
 *
 *   - The system picker only: the member picks ONE picture themselves. The app never lists or scans the camera roll, and a picture is
 *     only ever opened when the member taps "Add a picture".
 *   - The picture is shrunk to at most 1600 px on its longest side and re-encoded as JPEG at quality 0.8. Re-encoding drops most
 *     camera details, but the phone does not promise that, so the SERVER strips location data from the file again (image-sanitise.ts).
 */
export type PickResult = { kind: "picked"; image: PreparedImage } | { kind: "cancelled" } | { kind: "failed" };

export async function pickAndPrepareImage(): Promise<PickResult> {
  try {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      allowsEditing: false,
      exif: false,
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) return { kind: "cancelled" };
    const asset = picked.assets[0]!;
    const context = ImageManipulator.manipulate(asset.uri);
    try {
      const target = resizeTarget(asset.width ?? null, asset.height ?? null, IMAGE_MAX_SIDE);
      if (target) context.resize(target);
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: IMAGE_JPEG_QUALITY });
      return { kind: "picked", image: { uri: saved.uri, width: saved.width, height: saved.height } };
    } finally {
      context.release();
    }
  } catch {
    return { kind: "failed" };
  }
}
