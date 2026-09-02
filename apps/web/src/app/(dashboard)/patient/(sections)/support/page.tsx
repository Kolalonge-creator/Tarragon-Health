import { GroupDirectoryPage } from "@/app/(dashboard)/patient/group-directory-page";

/** Directory for the "Support" band. See group-directory-page.tsx for why the
 * four of these are one implementation behind four thin routes. */
export default function Page() {
  return <GroupDirectoryPage group="Support" />;
}
