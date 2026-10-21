import { notFound } from "next/navigation";
import { VisitDesk } from "./visit-desk";

export const metadata = { title: "Collection counter: visit" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** S28e: the counter for several prescriptions sent together. The role gate is the pharmacist layout; the database checks the pharmacy and the code. */
export default async function VisitCounterPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  if (!UUID.test(visitId)) notFound();
  return <VisitDesk visitId={visitId} />;
}
