import { notFound } from "next/navigation";
import { CollectionDesk } from "./collection-desk";

export const metadata = { title: "Collection counter" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** S28: the counter for one prescription sent to this pharmacy. The role gate is the pharmacist layout; the database checks the pharmacy and the code. */
export default async function CounterPage({ params }: { params: Promise<{ prescriptionId: string }> }) {
  const { prescriptionId } = await params;
  if (!UUID.test(prescriptionId)) notFound();
  return <CollectionDesk prescriptionId={prescriptionId} />;
}
