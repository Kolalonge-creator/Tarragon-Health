import { fileUrl, haveKey, planDownloads, type BundleFeatures, type ClipFile, type Lang, type Manifest, type ReportIssue } from "@tarragon/audio";
import type { DownloadedFiles } from "./service";

/** The slice of `expo-file-system` and `expo-crypto` this store uses, so tests can stand in for them. */
export interface FileSystemPort {
  /** `file:///` uri of a downloaded clip (folder named by checksum), and whether it is on the phone. */
  locate(file: ClipFile): { uri: string; exists: boolean };
  /** Download to the located path. Resolves when the file is on the phone. */
  download(url: string, file: ClipFile): Promise<void>;
  /** sha256 hex of what is on the phone at the located path. */
  sha256(file: ClipFile): Promise<string>;
  remove(file: ClipFile): void;
}

/** Downloaded recordings on the phone, by file name and checksum. A re-recorded clip has a new checksum, so it is a new path. */
export function createDownloadedFiles(fs: FileSystemPort): DownloadedFiles {
  return {
    uriFor(file) {
      if (file.sha256 === null) return null;
      const where = fs.locate(file);
      return where.exists ? where.uri : null;
    },
  };
}

export interface DownloadContext {
  readonly lang: Lang;
  readonly signedUp: boolean;
  readonly onWifi: boolean;
  /** Low-data mode (spec D.1). The setting itself arrives with S34; callers pass it in. */
  readonly lowData: boolean;
}

export interface DownloadResult {
  readonly downloaded: number;
  readonly failed: number;
}

/**
 * Fetch the post-sign-up clips the person is missing, in their language, on Wi-Fi, never in low-data mode
 * (`planDownloads`). A file whose checksum does not match the manifest is deleted, never kept: a clip that is not
 * exactly the signed recording must not play. One failure never stops the rest and never throws.
 */
export async function downloadPostSignupClips(
  manifest: Manifest,
  ctx: DownloadContext,
  features: BundleFeatures,
  baseUrl: string | undefined,
  fs: FileSystemPort,
  report: ReportIssue,
): Promise<DownloadResult> {
  if (!baseUrl) return { downloaded: 0, failed: 0 };
  const have = new Set<string>();
  for (const clip of manifest.clips) for (const f of Object.values(clip.files)) if (f && f.sha256 !== null && fs.locate(f).exists) have.add(haveKey(f));
  let downloaded = 0;
  let failed = 0;
  for (const ref of planDownloads(manifest, { ...ctx, have }, features)) {
    const url = fileUrl(baseUrl, ref.file);
    if (!url) continue;
    try {
      await fs.download(url, ref.file);
      if ((await fs.sha256(ref.file)) !== ref.file.sha256) {
        fs.remove(ref.file);
        failed += 1;
        report({ code: "clip_checksum_mismatch", clipId: ref.clipId, lang: ref.key === "shared" ? null : ref.key, detail: ref.file.file });
        continue;
      }
      downloaded += 1;
    } catch (e) {
      failed += 1;
      try {
        fs.remove(ref.file);
      } catch {
        // nothing to clean up
      }
      report({ code: "clip_file_missing", clipId: ref.clipId, lang: ref.key === "shared" ? null : ref.key, detail: e instanceof Error ? e.message.slice(0, 120) : "download failed" });
    }
  }
  return { downloaded, failed };
}
