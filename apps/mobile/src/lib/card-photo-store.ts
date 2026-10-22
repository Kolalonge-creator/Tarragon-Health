import { recordSyncError } from "./sync-diagnostics";

/**
 * Where a compressed card photo waits on the phone until the outbox can send it (S68b). The queue holds only the file's location; the bytes live
 * in the app's own document folder, which is private to the app. Injected so Jest never touches the real file system.
 */
export interface CardPhotoStore {
  /** Writes the bytes under a stable name and returns where. */
  save(name: string, bytes: Uint8Array): Promise<string>;
  /** Reads the file back, or null when it is gone. */
  load(uri: string): Promise<Uint8Array | null>;
  /** Best effort. A file that cannot be deleted stays in the app's own folder, which only this app can read. */
  remove(uri: string): Promise<void>;
  /** Deletes every waiting card photo (the lost-phone wipe). Best effort. */
  removeAll(): Promise<void>;
}

interface FsModule {
  File: new (...parts: unknown[]) => { uri: string; exists: boolean; create(opts?: { intermediates?: boolean; overwrite?: boolean }): void; write(data: Uint8Array): void; bytes(): Promise<Uint8Array>; delete(): void };
  Directory: new (...parts: unknown[]) => { exists: boolean; create(opts?: { intermediates?: boolean }): void };
  Paths: { document: unknown };
}

function fs(): FsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-file-system") as FsModule;
}

export const defaultCardPhotoStore: CardPhotoStore = {
  async save(name, bytes) {
    const { File, Directory, Paths } = fs();
    const dir = new Directory(Paths.document, "child-card-photos");
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(Paths.document, "child-card-photos", name);
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
    return file.uri;
  },
  async load(uri) {
    try {
      const { File } = fs();
      const file = new File(uri);
      if (!file.exists) return null;
      return await file.bytes();
    } catch (error) {
      recordSyncError("offline_outbox", "load_failed", error);
      return null;
    }
  },
  async remove(uri) {
    try {
      const { File } = fs();
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch (error) {
      recordSyncError("offline_outbox", "remove_failed", error);
    }
  },
  async removeAll() {
    try {
      const { Directory, Paths } = fs();
      const dir = new Directory(Paths.document, "child-card-photos");
      if (dir.exists) (dir as unknown as { delete(): void }).delete();
    } catch (error) {
      recordSyncError("offline_outbox", "remove_all_failed", error);
    }
  },
};

let active: CardPhotoStore = defaultCardPhotoStore;
/** The store the outbox sender uses. Test hook: Jest swaps in a fake so no real file is touched. */
export const getCardPhotoStore = (): CardPhotoStore => active;
export function __setCardPhotoStoreForTests(store: CardPhotoStore | null): void {
  active = store ?? defaultCardPhotoStore;
}
