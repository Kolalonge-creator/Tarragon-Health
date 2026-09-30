import { redirect } from "next/navigation";

/** proxy.ts sends "/" to the right place first; this is only the safe default if it ever does not. */
export default function ConsoleRootPage() {
  redirect("/login");
}
