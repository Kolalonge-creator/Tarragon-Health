/**
 * S68b: the daily child log and the S68 writes that used to be online-only go through the one offline outbox (idempotent by client id).
 * Pure logic with the network, the file system and the camera replaced by fakes.
 */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import { logChildGrowth, pendingChildEvents, queueLifecycle, queueMotherFeed, takeCardPhoto, tapChildEvent, type CardPhotoDeps, type ChildDetail } from "./child-log";
import { sendCardPhoto, cardPhotoPath } from "./child-log-send";
import { wipeThisPhone } from "./device-lease";
import { __setCardPhotoStoreForTests, type CardPhotoStore } from "./card-photo-store";
import type { CardPhotoPayload, ChildEventPayload } from "./child-log-payloads";

jest.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: "jpeg" } }));
jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn() }));

const mockInserts: { table: string; row: Record<string, unknown> }[] = [];
const mockRpcs: { fn: string; args?: Record<string, unknown> }[] = [];
const mockUploads: { bucket: string; path: string; bytes: number }[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;
let mockRpcError: { code?: string; message?: string } | null = null;
let mockRpcData: unknown = null;
let mockUploadError: { message?: string; statusCode?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        mockInserts.push({ table, row });
        return { error: mockInsertError };
      },
    }),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      mockRpcs.push({ fn, args });
      // my_lifecycle is the read the sender makes to recognise a replay; only record_lifecycle_event fails in these tests.
      return fn === "my_lifecycle" ? { data: mockRpcData, error: null } : { data: null, error: mockRpcError };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Uint8Array) => {
          mockUploads.push({ bucket, path, bytes: body.length });
          return { error: mockUploadError };
        },
      }),
    },
  },
}));

const CHILD: ChildDetail = { profileId: "child-1", firstName: "Ada", access: "manage", dateOfBirth: "2026-08-01", sex: "female", organisationId: "org-1" };
const VIEWER: ChildDetail = { ...CHILD, access: "view" };

beforeEach(() => {
  __resetOutboxForTests();
  __setCardPhotoStoreForTests(null);
  mockInserts.length = 0;
  mockRpcs.length = 0;
  mockUploads.length = 0;
  mockInsertError = null;
  mockRpcError = null;
  mockRpcData = null;
  mockUploadError = null;
});

describe("one tap on the daily log", () => {
  it("is on the phone before any network call, then goes to the child's table with the client id as the idempotency key", async () => {
    const payload: ChildEventPayload = { kind: "nappy_wet", feed_type: null, occurred_at: "2026-10-22T08:00:00.000Z", logged_by_label: "Mum", organisation_id: "org-1" };
    const item = await enqueue({ kind: "child_event", subjectId: "child-1", payload, recordedAt: payload.occurred_at });
    expect(mockInserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
    const r = await flushOutbox();
    expect(r.synced).toBe(1);
    expect(mockInserts[0]).toMatchObject({ table: "child_daily_events", row: { patient_id: "child-1", client_id: item.clientId, kind: "nappy_wet", logged_by_label: "Mum", organisation_id: "org-1" } });
  });

  it("tapChildEvent: sent when the network is there, and the label is cleaned", async () => {
    expect(await tapChildEvent(CHILD, "feed", "breast", " <b>Aunty</b>  Ngozi ")).toBe("sent");
    expect(mockInserts[0]?.row).toMatchObject({ kind: "feed", feed_type: "breast", logged_by_label: "b Aunty /b Ngozi" });
    expect(await getPendingCount()).toBe(0);
  });

  it("a non-feed tap never carries a feed type; a feed with none defaults to other", async () => {
    await tapChildEvent(CHILD, "sleep_start", "bottle", "");
    await tapChildEvent(CHILD, "feed", null, "");
    expect(mockInserts[0]?.row).toMatchObject({ kind: "sleep_start", feed_type: null, logged_by_label: null });
    expect(mockInserts[1]?.row).toMatchObject({ kind: "feed", feed_type: "other" });
  });

  it("with no signal it is 'saved on this phone', stays queued and is not lost", async () => {
    mockInsertError = { message: "network request failed" };
    expect(await tapChildEvent(CHILD, "nappy_dirty", null, "Dad")).toBe("on_phone");
    expect(await getPendingCount()).toBe(1);
    mockInsertError = null;
    const r = await flushOutbox();
    expect(r.synced).toBe(1);
    expect(await getPendingCount()).toBe(0);
  });

  it("a replay after a lost reply (unique violation) is a duplicate, not a second record and not an error", async () => {
    mockInsertError = { code: "23505", message: "duplicate key value" };
    expect(await tapChildEvent(CHILD, "nappy_wet", null, "")).toBe("sent");
    expect(await getPendingCount()).toBe(0);
  });

  it("while the daily log is not open the entry is withdrawn, not queued for ever", async () => {
    mockInsertError = { code: "55000", message: "The daily log is not open yet" };
    expect(await tapChildEvent(CHILD, "feed", "breast", "")).toBe("not_open");
    expect(await getPendingCount()).toBe(0);
  });

  it("a view-only caregiver cannot log, and nothing is queued", async () => {
    expect(await tapChildEvent(VIEWER, "feed", "breast", "")).toBe("view_only");
    expect(await logChildGrowth(VIEWER, { weightKg: 5, heightCm: null }, "")).toBe("view_only");
    expect(await getPendingCount()).toBe(0);
  });

  it("lists the pending tap on the child's timeline until the server has it", async () => {
    mockInsertError = { message: "network request failed" };
    await tapChildEvent(CHILD, "nappy_wet", null, "Mum");
    const pending = await pendingChildEvents("child-1");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "nappy_wet", pendingOnPhone: true, loggedBy: "Mum" });
    expect(await pendingChildEvents("other-child")).toEqual([]);
  });
});

describe("the S68 writes that used to be online-only", () => {
  it("growth is queued and sent raw: the phone never computes a z-score", async () => {
    expect(await logChildGrowth(CHILD, { weightKg: 5.4, heightCm: 60, muacMm: 130, measurePosition: "recumbent" }, "Mum")).toBe("sent");
    expect(mockInserts[0]?.table).toBe("child_growth_measurements");
    expect(mockInserts[0]?.row).toMatchObject({ patient_id: "child-1", weight_kg: 5.4, height_cm: 60, muac_mm: 130, measure_position: "recumbent", bilateral_oedema: false });
    expect(Object.keys(mockInserts[0]?.row ?? {}).some((k) => /_z$|nutrition|plausib/.test(k))).toBe(false);
  });

  it("an empty growth entry is refused before it is queued", async () => {
    expect(await logChildGrowth(CHILD, { weightKg: null, heightCm: null }, "")).toBe("failed");
    expect(await getPendingCount()).toBe(0);
  });

  it("the mother's feed log is queued for her own id", async () => {
    expect(await queueMotherFeed("user-1", "org-1", { feed_type: "breast_left", duration_minutes: 10, amount_ml: null })).toBe("sent");
    expect(mockInserts[0]).toMatchObject({ table: "breastfeeding_feed_log", row: { patient_id: "user-1", feed_type: "breast_left", duration_minutes: 10 } });
  });

  it("a confirmed life-stage event goes through the existing function", async () => {
    expect(await queueLifecycle("user-1", "pregnancy_confirmed", "2026-10-22")).toBe("sent");
    expect(mockRpcs[0]).toEqual({ fn: "record_lifecycle_event", args: { p_kind: "pregnancy_confirmed", p_occurred_on: "2026-10-22" } });
  });

  it("a replayed life-stage event is success when the person is already at the stage it leads to, and a rejection otherwise", async () => {
    mockRpcError = { code: "22023", message: "That change is not available from this stage" };
    mockRpcData = [{ stage: "pregnant" }];
    expect(await queueLifecycle("user-1", "pregnancy_confirmed", "2026-10-22")).toBe("sent");
    mockRpcData = [{ stage: "tracking" }];
    expect(await queueLifecycle("user-1", "pregnancy_confirmed", "2026-10-22")).toBe("on_phone");
    const items = await listOutbox();
    expect(items[0]?.state).toBe("rejected");
  });

  it("a pregnancy loss is never queued: it stays online-only", async () => {
    expect(await queueLifecycle("user-1", "pregnancy_loss_recorded", "2026-10-22")).toBe("failed");
    expect(await getPendingCount()).toBe(0);
    expect(mockRpcs).toHaveLength(0);
  });
});

function fakeStore(initial: Record<string, Uint8Array> = {}): CardPhotoStore & { files: Map<string, Uint8Array> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async save(name, bytes) {
      files.set(`file:///cards/${name}`, bytes);
      return `file:///cards/${name}`;
    },
    async load(uri) {
      return files.get(uri) ?? null;
    },
    async remove(uri) {
      files.delete(uri);
    },
    async removeAll() {
      files.clear();
    },
  };
}

/** A tiny but well-formed JPEG: SOI, a comment segment carrying GPS-like text, SOS, one byte of data, EOI. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x06, 0x47, 0x50, 0x53, 0x21, 0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9]);

describe("the paper card photo", () => {
  function deps(store: CardPhotoStore, bytes: Uint8Array | null = JPEG): CardPhotoDeps {
    __setCardPhotoStoreForTests(store);
    return {
      capture: async () => (bytes ? { uri: "file:///cache/shot.jpg", width: 3000, height: 4000 } : null),
      resize: async () => "file:///cache/small.jpg",
      read: async () => JPEG,
      store,
    };
  }

  it("is compressed, stripped of metadata, stored in the app's own folder and queued; the queue holds the location, not the bytes", async () => {
    const store = fakeStore();
    mockInsertError = { message: "network request failed" };
    expect(await takeCardPhoto(CHILD, "Mum", deps(store))).toBe("on_phone");
    const [item] = await listOutbox("card_photo");
    const payload = item?.payload as CardPhotoPayload;
    expect(payload.file_uri.startsWith("file:///cards/")).toBe(true);
    expect(JSON.stringify(item?.payload)).not.toContain("255");
    const saved = store.files.get(payload.file_uri)!;
    expect(Array.from(saved.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(saved)).not.toContain(0x47); // the comment segment (GPS-like text) is gone
    expect(item?.subjectId).toBe("child-1");
  });

  it("uploads to <uploader>/<child>/<client id>.jpg, then writes the record, then removes the file", async () => {
    const store = fakeStore();
    expect(await takeCardPhoto(CHILD, "Mum", deps(store))).toBe("sent");
    expect(mockUploads).toHaveLength(1);
    expect(mockUploads[0]?.bucket).toBe("child-card-photos");
    const photoInsert = mockInserts.find((i) => i.table === "child_card_photos");
    expect(mockUploads[0]?.path).toBe(`user-1/child-1/${photoInsert?.row.client_id as string}.jpg`);
    expect(photoInsert?.row).toMatchObject({ patient_id: "child-1", storage_path: mockUploads[0]?.path, logged_by_label: "Mum" });
    expect(store.files.size).toBe(0);
  });

  it("an upload that already exists (a replay) is treated as done and the record insert still happens once", async () => {
    mockUploadError = { message: "The resource already exists", statusCode: "409" };
    mockInsertError = { code: "23505", message: "duplicate key" };
    const store = fakeStore();
    expect(await takeCardPhoto(CHILD, "", deps(store))).toBe("sent");
    expect(store.files.size).toBe(0);
  });

  it("a cancelled camera or an unusable picture queues nothing", async () => {
    const store = fakeStore();
    expect(await takeCardPhoto(CHILD, "", deps(store, null))).toBe("cancelled");
    expect(await takeCardPhoto(CHILD, "", { ...deps(store), read: async () => Uint8Array.from([1, 2, 3]) })).toBe("unusable");
    expect(await getPendingCount()).toBe(0);
    expect(store.files.size).toBe(0);
  });

  it("when the entry is withdrawn as 'not open yet' the photo file is deleted too", async () => {
    const store = fakeStore();
    mockInsertError = { code: "55000", message: "The card photo is not open yet" };
    expect(await takeCardPhoto(CHILD, "", deps(store))).toBe("not_open");
    expect(await getPendingCount()).toBe(0);
    expect(store.files.size).toBe(0);
  });

  it("the lost-phone wipe deletes every waiting card photo", async () => {
    const store = fakeStore({ "file:///cards/a.jpg": JPEG, "file:///cards/b.jpg": JPEG });
    __setCardPhotoStoreForTests(store);
    await wipeThisPhone("lease_expired", null);
    expect(store.files.size).toBe(0);
  });

  it("a view-only caregiver cannot add a photo", async () => {
    expect(await takeCardPhoto(VIEWER, "", deps(fakeStore()))).toBe("view_only");
  });

  it("a photo that has disappeared from the phone is a visible rejection, not a silent drop", async () => {
    const out = await sendCardPhoto("user-1", "child-1", "c1", { file_uri: "file:///gone.jpg", size_bytes: 10, logged_by_label: null, organisation_id: "org-1" }, fakeStore());
    expect(out).toMatchObject({ ok: false, code: "22023" });
    expect(cardPhotoPath("u", "c", "x")).toBe("u/c/x.jpg");
  });
});
