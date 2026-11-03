/** The "Create an account" link on the sign-in page: the sanitised destination rides along, and a supporter stays a supporter. */
export function signupHrefFor(safeRedirect: string | null, supporter: boolean): string {
  const params = new URLSearchParams();
  if (supporter) params.set("intent", "support");
  if (safeRedirect) params.set("redirect", safeRedirect);
  const q = params.toString();
  return q ? `/signup?${q}` : "/signup";
}
