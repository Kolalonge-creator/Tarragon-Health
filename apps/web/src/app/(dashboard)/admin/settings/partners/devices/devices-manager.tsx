"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useAllDeviceOfferings,
  useCreateDeviceOffering,
  useSetDeviceOfferingActive,
  useDeleteDeviceOffering,
  type DeviceOffering,
} from "@/lib/queries/device-offerings";

const DEVICE_TYPES: DeviceOffering["device_type"][] = [
  "bp_cuff",
  "glucometer",
  "scale",
  "thermometer",
  "pulse_oximeter",
];

/**
 * The device catalogue is link-out only — Tarragon doesn't sell or import
 * devices (CLAUDE.md). Every row here is "where a patient can buy this
 * model", not an item Tarragon fulfils. Condition-based recommendation shown
 * to patients is computed from this catalogue's device_type, never set here.
 */
export function DevicesManager() {
  const { data: offerings, isLoading } = useAllDeviceOfferings();
  const create = useCreateDeviceOffering();
  const toggle = useSetDeviceOfferingActive();
  const remove = useDeleteDeviceOffering();

  const [deviceType, setDeviceType] = useState<DeviceOffering["device_type"]>("bp_cuff");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [retailerName, setRetailerName] = useState("");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [priceNaira, setPriceNaira] = useState("");
  const [bleValidated, setBleValidated] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a device listing</CardTitle>
          <CardDescription>
            A retailer link for a specific make/model — patients are sent here to buy it
            themselves. Only mark &quot;Bluetooth pairing tested&quot; once this exact model has
            actually been paired against the Expo app on real hardware (see CLAUDE.md).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const naira = priceNaira.trim() === "" ? null : Number(priceNaira);
              create.mutate(
                {
                  deviceType,
                  make,
                  model,
                  retailerName: retailerName || null,
                  affiliateUrl,
                  priceKobo: naira == null ? null : Math.round(naira * 100),
                  imageUrl: null,
                  description: null,
                  bleValidated,
                  isActive,
                },
                {
                  onSuccess: () => {
                    setMake("");
                    setModel("");
                    setRetailerName("");
                    setAffiliateUrl("");
                    setPriceNaira("");
                    setBleValidated(false);
                    setIsActive(true);
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
                }
              );
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="dev-type">Device type</Label>
              <Select
                id="dev-type"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value as DeviceOffering["device_type"])}
              >
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dev-make">Make</Label>
              <Input id="dev-make" value={make} onChange={(e) => setMake(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dev-model">Model</Label>
              <Input id="dev-model" value={model} onChange={(e) => setModel(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dev-retailer">Retailer name</Label>
              <Input
                id="dev-retailer"
                value={retailerName}
                onChange={(e) => setRetailerName(e.target.value)}
                placeholder="e.g. Jumia"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="dev-url">Buy link</Label>
              <Input
                id="dev-url"
                type="url"
                value={affiliateUrl}
                onChange={(e) => setAffiliateUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dev-price">From price (₦, optional)</Label>
              <Input id="dev-price" type="number" min="0" value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={bleValidated} onChange={(e) => setBleValidated(e.target.checked)} />
              Bluetooth pairing tested on real hardware
            </label>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (visible to patients)
            </label>
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add device"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Device catalogue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading…</p>
          ) : (offerings ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No devices listed yet.</p>
          ) : (
            (offerings ?? []).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-charcoal-ink">
                    {d.make} {d.model}
                  </span>
                  <Badge variant="grey">{d.device_type.replace(/_/g, " ")}</Badge>
                  <Badge variant={d.is_active ? "green" : "grey"}>{d.is_active ? "Active" : "Inactive"}</Badge>
                  {d.ble_validated && <Badge variant="blue">BLE tested</Badge>}
                  {d.retailer_name && <span className="text-xs text-charcoal-ink/50">{d.retailer_name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: d.id, isActive: !d.is_active })}
                  >
                    {d.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${d.make} ${d.model}?`)) remove.mutate(d.id);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
