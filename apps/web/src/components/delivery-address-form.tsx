"use client";

import { useState } from "react";
import { deliveryAddressSchema } from "@/lib/validation/delivery-address";
import { useSetPharmacyOrderDeliveryAddress } from "@/lib/queries/logistics-partners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Patient sets their own delivery address on their own pharmacy order.
 * Zod-validated client-side (street, area, state/LGA, phone confirmation);
 * the mutation itself goes through the narrow
 * set_pharmacy_order_delivery_address RPC (pharmacy_orders' UPDATE RLS is
 * staff-only), which re-validates ownership server-side.
 */
export function DeliveryAddressForm({
  orderId,
  onSaved,
}: {
  orderId: string;
  onSaved?: (state: string) => void;
}) {
  const [street, setStreet] = useState("");
  const [area, setArea] = useState("");
  const [state, setState] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const setAddress = useSetPharmacyOrderDeliveryAddress();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = deliveryAddressSchema.safeParse({ street, area, state, phone });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setAddress.mutate(
      { orderId, address: result.data },
      { onSuccess: () => onSaved?.(result.data.state) }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`street-${orderId}`}>Street address</Label>
          <Input
            id={`street-${orderId}`}
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="12 Admiralty Way"
          />
          {fieldErrors.street && <p className="text-xs text-red-600">{fieldErrors.street}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`area-${orderId}`}>Area / neighbourhood</Label>
          <Input
            id={`area-${orderId}`}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Lekki Phase 1"
          />
          {fieldErrors.area && <p className="text-xs text-red-600">{fieldErrors.area}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`state-${orderId}`}>State / LGA</Label>
          <Input
            id={`state-${orderId}`}
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Lagos"
          />
          {fieldErrors.state && <p className="text-xs text-red-600">{fieldErrors.state}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`phone-${orderId}`}>Confirm phone number</Label>
          <Input
            id={`phone-${orderId}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+2348012345678"
          />
          {fieldErrors.phone && <p className="text-xs text-red-600">{fieldErrors.phone}</p>}
        </div>
      </div>
      {setAddress.isError && (
        <p className="text-xs text-red-600">Could not save this address. Try again.</p>
      )}
      <Button type="submit" size="sm" disabled={setAddress.isPending}>
        {setAddress.isPending ? "Saving…" : "Save delivery address"}
      </Button>
    </form>
  );
}
