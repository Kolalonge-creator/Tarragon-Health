/**
 * Dark mode switch (decision DG-2: dark mode is built in Phase 0, with the kit).
 *
 * The infrastructure and every kit component support both schemes. This stays
 * false until the flagship screens (Home, Vitals, Medications, Messages) have
 * moved onto the kit, because the other ~65 screens still use the static light
 * `colors` object and would render half dark. While false the app forces the
 * light scheme at the OS level too, so native chrome (keyboards, alerts, the
 * status bar) matches. Turning it on is a one-line change here plus testing.
 */
export const DARK_MODE_ENABLED = false;
