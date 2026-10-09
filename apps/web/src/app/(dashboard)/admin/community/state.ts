/** What a form action tells the page. `result` is only ever set by the unmask lookup. */
export type ActionState =
  | { ok: boolean; message: string; result?: { profile_id: string; full_name: string | null } }
  | undefined;
