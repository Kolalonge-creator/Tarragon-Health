/** @jest-environment jsdom */
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlaceAddress } from "@/lib/maps/place-address";

const fetchAutocompleteSuggestions = jest.fn();
const fetchFields = jest.fn();
let placesLib: unknown = null;

jest.mock("@vis.gl/react-google-maps", () => ({ useMapsLibrary: () => placesLib }));

import { AddressAutocompleteInput } from "./address-autocomplete-input";

class FakeToken {}
const fakePlace = {
  formattedAddress: "12 Adeola Odeku St, Victoria Island, Lagos, Nigeria",
  location: { lat: () => 6.4281, lng: () => 3.4219 },
  addressComponents: [
    { longText: "Lagos", shortText: "Lagos", types: ["locality"] },
    { longText: "Lagos State", shortText: "LA", types: ["administrative_area_level_1"] },
  ],
  fetchFields,
};
const prediction = { placeId: "p1", text: { text: "12 Adeola Odeku Street, Lagos" }, toPlace: () => fakePlace };

function Harness({ onSelect }: { onSelect: (a: PlaceAddress) => void }) {
  const [value, setValue] = useState("");
  return <AddressAutocompleteInput aria-label="Address" value={value} onChange={setValue} onSelect={onSelect} />;
}

beforeEach(() => {
  fetchAutocompleteSuggestions.mockReset().mockResolvedValue({ suggestions: [{ placePrediction: prediction }] });
  fetchFields.mockReset().mockResolvedValue({ place: fakePlace });
  placesLib = { AutocompleteSessionToken: FakeToken, AutocompleteSuggestion: { fetchAutocompleteSuggestions } };
});

describe("AddressAutocompleteInput", () => {
  it("suggests Nigerian addresses only, under one session token, and a pick fills address, coordinates and state", async () => {
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} />);
    const box = screen.getByRole("combobox", { name: "Address" });
    fireEvent.change(box, { target: { value: "12 Adeola" } });
    const option = await screen.findByRole("option", { name: "12 Adeola Odeku Street, Lagos" });
    const request = fetchAutocompleteSuggestions.mock.calls[0][0];
    expect(request).toMatchObject({ input: "12 Adeola", includedRegionCodes: ["ng"] });
    expect(request.sessionToken).toBeInstanceOf(FakeToken);
    expect(screen.getByText("Powered by Google")).toBeTruthy();

    fireEvent.mouseDown(option);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(fetchFields).toHaveBeenCalledWith({ fields: ["formattedAddress", "location", "addressComponents"] });
    expect(onSelect.mock.calls[0][0]).toMatchObject({ latitude: 6.4281, longitude: 3.4219, state: "Lagos", town: "Lagos" });
    expect((box as HTMLInputElement).value).toBe("12 Adeola Odeku St, Victoria Island, Lagos, Nigeria");
    // the picked text does not trigger another lookup (a pick changes the text twice)
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchAutocompleteSuggestions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not look anything up for fewer than three characters", async () => {
    render(<Harness onSelect={jest.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Address" }), { target: { value: "12" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchAutocompleteSuggestions).not.toHaveBeenCalled();
  });

  it("is a plain text box when the Maps key or the Places library is missing", async () => {
    placesLib = null;
    render(<Harness onSelect={jest.fn()} />);
    const box = screen.getByRole("combobox", { name: "Address" });
    fireEvent.change(box, { target: { value: "5 Allen Avenue, Ikeja" } });
    await new Promise((r) => setTimeout(r, 400));
    expect((box as HTMLInputElement).value).toBe("5 Allen Avenue, Ikeja");
    expect(fetchAutocompleteSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("stays a plain text box when the suggestion request fails", async () => {
    fetchAutocompleteSuggestions.mockRejectedValue(new Error("REQUEST_DENIED"));
    render(<Harness onSelect={jest.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Address" }), { target: { value: "12 Adeola" } });
    await waitFor(() => expect(fetchAutocompleteSuggestions).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
