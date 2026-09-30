// One guard, shared with apps/web: refuse to run unless the configured Supabase
// URL is a local stack, so a mistaken run can never create data in production.
export { default } from "../../web/e2e-browser/global-setup";
