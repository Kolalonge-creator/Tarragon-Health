import type { ClipFile } from "@tarragon/audio";
import type { FileSystemPort } from "./file-store";

/** The real `expo-file-system` and `expo-crypto`, loaded lazily (null where the native modules are missing). */
export function loadExpoFileSystem(): FileSystemPort | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fsMod = require("expo-file-system") as typeof import("expo-file-system");
    const crypto = require("expo-crypto") as typeof import("expo-crypto");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const dir = (file: ClipFile) => new fsMod.Directory(fsMod.Paths.document, "audio", (file.sha256 ?? "unrecorded").slice(0, 16));
    const at = (file: ClipFile) => new fsMod.File(dir(file), file.file);
    const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return {
      locate: (file) => {
        const f = at(file);
        return { uri: f.uri, exists: f.exists };
      },
      download: async (url, file) => {
        const d = dir(file);
        if (!d.exists) d.create({ intermediates: true, idempotent: true });
        await fsMod.File.downloadFileAsync(url, at(file), { idempotent: true });
      },
      sha256: async (file) => toHex(await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, await at(file).bytes())),
      remove: (file) => {
        const f = at(file);
        if (f.exists) f.delete();
      },
    };
  } catch {
    return null;
  }
}
