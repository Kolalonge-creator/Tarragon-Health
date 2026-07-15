"use client";

import { useState, type FormEvent } from "react";
import {
  useAdminFacilities,
  useCreateFacility,
  useUpdateFacility,
  useFacilityServices,
  useCreateFacilityService,
  useUpdateFacilityService,
  useDeleteFacilityService,
} from "@/lib/queries/facility-admin";
import { facilitySchema, facilityServiceSchema, FACILITY_TYPES } from "@/lib/validation/facility-admin";
import { koboToNaira, nairaToKobo } from "@tarragon/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const FACILITY_TYPE_LABEL: Record<(typeof FACILITY_TYPES)[number], string> = {
  hospital: "Hospital",
  lab: "Lab",
  pharmacy: "Pharmacy",
  radiology: "Radiology",
  optician: "Optician",
  vaccination_centre: "Vaccination centre",
};

export function FacilityManager() {
  const facilities = useAdminFacilities();
  const createFacility = useCreateFacility();
  const updateFacility = useUpdateFacility();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof FACILITY_TYPES)[number]>("hospital");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    const parsed = facilitySchema.safeParse({
      name,
      type,
      state,
      city,
      contact_phone: contactPhone || undefined,
      contact_email: contactEmail || undefined,
      address: address || undefined,
      hours: hours || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    createFacility.mutate(parsed.data, {
      onSuccess: () => {
        setName("");
        setState("");
        setCity("");
        setContactPhone("");
        setContactEmail("");
        setAddress("");
        setHours("");
        setLatitude("");
        setLongitude("");
      },
    });
  }

  const mutationError = (createFacility.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a facility</CardTitle>
          <CardDescription>Appears immediately in the patient-facing directory.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_name">Name</Label>
                <Input
                  id="new_facility_name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_type">Type</Label>
                <Select
                  id="new_facility_type"
                  value={type}
                  onChange={(e) => setType(e.target.value as (typeof FACILITY_TYPES)[number])}
                >
                  {FACILITY_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {FACILITY_TYPE_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_state">State</Label>
                <Input
                  id="new_facility_state"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_city">City</Label>
                <Input
                  id="new_facility_city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_phone">Contact phone (optional)</Label>
                <Input
                  id="new_facility_phone"
                  placeholder="+234XXXXXXXXXX"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_email">Contact email (optional)</Label>
                <Input
                  id="new_facility_email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_facility_address">Address (optional)</Label>
              <Input id="new_facility_address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_facility_hours">Opening hours (optional)</Label>
              <Input
                id="new_facility_hours"
                placeholder="e.g. Mon-Sat 8am-6pm"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_latitude">Latitude (optional)</Label>
                <Input
                  id="new_facility_latitude"
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new_facility_longitude">Longitude (optional)</Label>
                <Input
                  id="new_facility_longitude"
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                />
              </div>
            </div>
            {displayError && <p className="text-sm text-red-600">{displayError}</p>}
            <Button type="submit" disabled={createFacility.isPending}>
              {createFacility.isPending ? "Adding…" : "Add facility"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facilities</CardTitle>
        </CardHeader>
        <CardContent>
          {facilities.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {facilities.isError && <p className="text-sm text-red-600">Could not load facilities.</p>}
          {!facilities.isLoading && !facilities.isError && facilities.data?.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No facilities yet — add one above.</p>
          )}
          {facilities.data && facilities.data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {facilities.data.map((facility) => (
                <li key={facility.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-charcoal-ink">{facility.name}</p>
                      <p className="text-xs text-charcoal-ink/60">
                        {FACILITY_TYPE_LABEL[facility.type]} — {facility.city}, {facility.state}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={facility.is_active ? "green" : "grey"}>
                        {facility.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {facility.verified && <Badge variant="blue">Verified</Badge>}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={updateFacility.isPending}
                        onClick={() =>
                          updateFacility.mutate({ id: facility.id, verified: !facility.verified })
                        }
                      >
                        {facility.verified ? "Unverify" : "Verify"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={updateFacility.isPending}
                        onClick={() =>
                          updateFacility.mutate({ id: facility.id, is_active: !facility.is_active })
                        }
                      >
                        {facility.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedId(expandedId === facility.id ? null : facility.id)}
                      >
                        {expandedId === facility.id ? "Hide services" : "Manage services"}
                      </Button>
                    </div>
                  </div>
                  {expandedId === facility.id && <FacilityServicesManager facilityId={facility.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FacilityServicesManager({ facilityId }: { facilityId: string }) {
  const services = useFacilityServices(facilityId);
  const createService = useCreateFacilityService();
  const updateService = useUpdateFacilityService();
  const deleteService = useDeleteFacilityService();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceNaira, setPriceNaira] = useState("");

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const parsed = facilityServiceSchema.safeParse({
      facility_id: facilityId,
      name,
      description: description || undefined,
      price_kobo: priceNaira ? nairaToKobo(Number(priceNaira)) : undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    createService.mutate(parsed.data, {
      onSuccess: () => {
        setName("");
        setDescription("");
        setPriceNaira("");
      },
    });
  }

  const mutationError =
    (createService.error as Error | null)?.message ??
    (updateService.error as Error | null)?.message ??
    (deleteService.error as Error | null)?.message ??
    null;
  const displayError = validationError ?? mutationError;

  return (
    <div className="space-y-3 rounded-md bg-charcoal-ink/5 p-3">
      {services.isLoading && <p className="text-sm text-charcoal-ink/60">Loading services…</p>}
      {services.isError && <p className="text-sm text-red-600">Could not load services.</p>}
      {services.data && services.data.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">No services listed yet.</p>
      )}
      {services.data && services.data.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10">
          {services.data.map((service) => (
            <li key={service.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="text-sm text-charcoal-ink">
                  {service.name}
                  {service.price_kobo != null && (
                    <span className="text-charcoal-ink/60">
                      {" "}
                      — ₦{koboToNaira(service.price_kobo).toLocaleString()}
                    </span>
                  )}
                </p>
                {service.description && (
                  <p className="text-xs text-charcoal-ink/60">{service.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={service.is_active ? "green" : "grey"}>
                  {service.is_active ? "Active" : "Inactive"}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={updateService.isPending}
                  onClick={() =>
                    updateService.mutate({
                      id: service.id,
                      facility_id: facilityId,
                      is_active: !service.is_active,
                    })
                  }
                >
                  {service.is_active ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={deleteService.isPending}
                  onClick={() => deleteService.mutate({ id: service.id, facilityId })}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`service_name_${facilityId}`}>Service name</Label>
          <Input
            id={`service_name_${facilityId}`}
            placeholder="e.g. HbA1c test"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`service_price_${facilityId}`}>Price (₦, optional)</Label>
          <Input
            id={`service_price_${facilityId}`}
            type="number"
            min={0}
            value={priceNaira}
            onChange={(e) => setPriceNaira(e.target.value)}
            className="w-32"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`service_description_${facilityId}`}>Description (optional)</Label>
          <Input
            id={`service_description_${facilityId}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={createService.isPending}>
          Add service
        </Button>
      </form>
      {displayError && <p className="text-sm text-red-600">{displayError}</p>}
    </div>
  );
}
