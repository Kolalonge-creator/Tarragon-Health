import { PharmacistMessages } from "./pharmacist-messages";

export const metadata = { title: "Patient questions" };

/** S54 8.12: the pharmacy's side of the medicine chat. The layout already limits /pharmacist/* to partner pharmacies. */
export default function PharmacistMessagesPage() {
  return <PharmacistMessages />;
}
