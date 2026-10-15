import { getOpsModeStatus } from "@/lib/capacity/queries";
import { formatLagos } from "@/lib/rota/time";

/**
 * Tells a clinician that surge mode or a pause is on, because both change what their queue offers them. No reason and no names. Renders
 * nothing when neither is on or when the status cannot be read (the queue works the same without it).
 */
export async function OpsModeBanner() {
  const status = await getOpsModeStatus();
  if (!status || (!status.surge && !status.pause)) return null;
  return (
    <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      {status.surge ? (
        <p>
          Surge mode is on until {formatLagos(status.surge)}. Routine work can be taken by any eligible clinician and routine times are longer. Urgent pages work as before.
        </p>
      ) : null}
      {status.pause ? (
        <p>
          New sales and bookings are paused until {formatLagos(status.pause)}, and routine tasks are not being offered. Urgent pages, emergency guidance and any task you already hold are not affected.
        </p>
      ) : null}
    </div>
  );
}
