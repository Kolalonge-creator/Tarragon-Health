import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import { getStoreWithSchema } from "./secure-db";

/**
 * Small per-person facts the pregnancy tools keep on the phone (S67): the last answer of the maternal go-live guard and the recent kick
 * counter history. These say a person is pregnant and how her baby moves, so they live in the ENCRYPTED store (cleared with it by
 * `destroyStore`), never in plain AsyncStorage. A copy an earlier build left in AsyncStorage is moved across the first time it is read,
 * then removed. A key is `<kind>:<subjectId>`.
 */
async function setup(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("create table if not exists local_pregnancy_kv (k text primary key, v text not null)");
}

export async function localGet(key: string, legacyAsyncStorageKey?: string): Promise<string | null> {
  try {
    const store = await getStoreWithSchema("pregnancy_kv", setup);
    const row = await store.getFirstAsync<{ v: string }>("select v from local_pregnancy_kv where k = ?", [key]);
    if (row) return row.v;
  } catch {
    return null;
  }
  if (legacyAsyncStorageKey) {
    try {
      const raw = await AsyncStorage.getItem(legacyAsyncStorageKey);
      if (raw !== null) {
        await localSet(key, raw);
        await AsyncStorage.removeItem(legacyAsyncStorageKey);
        return raw;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function localSet(key: string, value: string): Promise<void> {
  const store = await getStoreWithSchema("pregnancy_kv", setup);
  await store.runAsync("insert or replace into local_pregnancy_kv (k, v) values (?, ?)", [key, value]);
}
