/**
 * S54, decision D5 (founder): Tarragon offers NO home delivery for medicines. Pharmacy orders are pickup only, and the database
 * refuses anything else (`pharmacy_orders_pickup_only`). Every screen that used to offer, tell about or manage delivery reads this
 * constant, so bringing delivery back later is one deliberate change plus the OQ-16 schema work, never an accident.
 */
export const PHARMACY_DELIVERY_ENABLED = false as const;
