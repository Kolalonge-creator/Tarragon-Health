/**
 * Extracts a fixed set of string fields from a FormData object, for echoing
 * submitted values back to the client after a failed action-bound <form>
 * submission. React resets every uncontrolled field once a `useActionState`
 * action returns — success or failure — so without echoing them back, a
 * visitor has to retype the whole form over one bad field (see signup's and
 * the patient location form's own fixes for the concrete failure this
 * caused). A missing or non-string entry (e.g. a File on a field that
 * should never carry one) is simply left out rather than throwing or
 * coercing to "null"/"undefined" text.
 */
export function pickFormValues<K extends string>(
  formData: FormData,
  keys: readonly K[]
): Partial<Record<K, string>> {
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
