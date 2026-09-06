/**
 * Form-field name for one SLA entry's minutes.
 *
 * Deliberately its own module rather than living beside the server action
 * that consumes it: actions.ts carries "use server", and a file with that
 * directive may only export async functions — exporting this sync helper
 * from there fails the build at runtime, not at typecheck. Both the action
 * and the manager UI import it here so the two cannot drift apart.
 */
export function slaFieldName(tier: string, pathway: string): string {
  return `sla__${tier}__${pathway}`;
}
