/**
 * Whether the automatic-renewal box starts ticked, on EVERY checkout (web and mobile). It starts UNTICKED: renewal charges a card without a
 * further action from the person, so the tick must be an explicit, affirmative choice made at the moment of payment. Counsel has not been
 * asked whether a pre-ticked box is acceptable for Nigerian card-on-file payments, and an unticked default is the safe reading of
 * consumer-protection norms. This is the ONE place to change it, and only after that advice. A test pins it.
 */
export const RENEWAL_CONSENT_TICKED_BY_DEFAULT = false;
