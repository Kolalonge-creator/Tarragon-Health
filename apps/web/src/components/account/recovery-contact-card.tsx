import { createClient } from "@/lib/supabase/server";
import { RecoveryContactPanel, type CircleChoice, type RecoveryContactView } from "./recovery-contact-panel";

/**
 * The patient's recovery contact (S03b): ONE confirmed Care Circle member who can help if they are ever locked out. Reuses the
 * Care Circle (my_care_circle, care_circle_members); there is no second contact list. A server component so the choices come
 * from the database for the signed-in patient, never from the browser.
 */
export async function RecoveryContactCard() {
  const supabase = await createClient();
  const [contact, circle] = await Promise.all([supabase.rpc("my_recovery_contact"), supabase.rpc("my_care_circle")]);
  const current = (contact.data ?? null) as RecoveryContactView | null;
  const members = ((circle.data as { members?: { member_id: string; name: string; relationship: string }[] } | null)?.members ?? []).map(
    (m): CircleChoice => ({ memberId: m.member_id, name: m.name, relationship: m.relationship }),
  );
  return <RecoveryContactPanel current={current} members={members} />;
}
