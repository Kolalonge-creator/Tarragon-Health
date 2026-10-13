import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AccessReviewPage } from "@/components/security/access-review-page";

export const metadata = { title: "Record access review" };
export const dynamic = "force-dynamic";

export default async function AdminAccessReview() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return <AccessReviewPage />;
}
