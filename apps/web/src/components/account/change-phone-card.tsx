import type { Locale } from "@tarragon/i18n";
import { getCurrentUser } from "@/lib/supabase/server";
import { phoneChangeOptions } from "@/lib/account/phone-change-options";
import { TEXT_CODES_ENABLED } from "@/lib/auth/text-codes";
import { ChangePhoneCardClient } from "./change-phone-card-client";

/**
 * Change the sign-in phone number (S03, S03b). A server component so the card knows, from Auth, which ways exist to confirm
 * the change (the confirmed current number, the verified email) without the browser ever being handed an address or a number.
 */
export async function ChangePhoneCard({ locale = "en" }: { locale?: Locale }) {
  // No texted codes are available yet, so a number change could never be confirmed: show nothing rather than a form that cannot finish.
  if (!TEXT_CODES_ENABLED) return null;
  const user = await getCurrentUser();
  const options = user ? phoneChangeOptions(user) : { needsConfirmation: false, oldPhone: null, email: null };
  return <ChangePhoneCardClient locale={locale} options={options} />;
}
