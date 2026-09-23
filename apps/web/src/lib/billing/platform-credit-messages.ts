/**
 * Shared copy for the platform_credit_topups kill switch (see
 * 20260922185100_platform_credit_topups_kill_switch.sql). Kept in its own
 * plain module — not lib/platform-modules.ts, which carries `import
 * "server-only"` — so it can be imported from both server code (the web
 * action, the mobile route) and platform-credit-card.tsx, a client
 * component. A string constant has no reason to be server-only, and
 * splitting it out here is what actually keeps the three surfaces in sync:
 * co-locating it with `isPlatformModuleEnabled` looked convenient but a
 * client component importing that module would fail to build at all.
 */
export const PLATFORM_CREDIT_TOPUPS_DISABLED_MESSAGE =
  "Adding funds isn't available right now. Your existing Platform Credit balance and spending are not affected.";
