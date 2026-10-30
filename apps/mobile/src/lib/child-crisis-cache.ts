import { getStoreWithSchema } from "./secure-db";
import { recordSyncError } from "./sync-diagnostics";

/**
 * The last KNOWN crisis state per child (S68b review fix). The "go to the nearest clinic now" lead comes from the latest growth result, which is
 * read from the server. A failed or offline read must never hide a crisis the phone already knew about, so every successful read records
 * whether the latest result was severe, and a failed read falls back to that record. It lives in the encrypted store (wiped with it by the lost
 * phone wipe) and holds only a child id, a flag and a time: no measurement.
 */
async function db() {
  return getStoreWithSchema("child_crisis", async (d) => {
    await d.execAsync("create table if not exists child_crisis (child_id text primary key, severe integer not null, at text not null);");
  });
}

export async function rememberChildCrisis(childId: string, severe: boolean, now: Date = new Date()): Promise<void> {
  try {
    const d = await db();
    await d.runAsync("insert into child_crisis (child_id, severe, at) values (?, ?, ?) on conflict(child_id) do update set severe = excluded.severe, at = excluded.at", [childId, severe ? 1 : 0, now.toISOString()]);
  } catch (error) {
    recordSyncError("offline_outbox", "rememberChildCrisis", error);
  }
}

/** Child ids whose latest known result was severe. A store that cannot be read gives an empty set (nothing known), never an error. */
export async function knownCrisisChildren(): Promise<Set<string>> {
  try {
    const d = await db();
    const rows = await d.getAllAsync<{ child_id: string }>("select child_id from child_crisis where severe = 1");
    return new Set(rows.map((r) => r.child_id));
  } catch (error) {
    recordSyncError("offline_outbox", "knownCrisisChildren", error);
    return new Set();
  }
}
