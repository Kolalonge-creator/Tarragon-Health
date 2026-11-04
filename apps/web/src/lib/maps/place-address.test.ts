import { describe, expect, it } from "@jest/globals";
import { placeToAddress, type PlaceAddressComponent } from "./place-address";

const c = (longText: string, ...types: string[]): PlaceAddressComponent => ({ longText, shortText: longText, types });
const at = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });

describe("placeToAddress", () => {
  it("fills address, coordinates, a canonical state and the town from a Lagos result", () => {
    const out = placeToAddress(
      {
        formattedAddress: "12 Adeola Odeku St, Victoria Island, Lagos 106104, Lagos, Nigeria",
        location: at(6.4281, 3.4219),
        addressComponents: [
          c("Victoria Island", "sublocality", "political"),
          c("Lagos", "locality", "political"),
          c("Eti-Osa", "administrative_area_level_2", "political"),
          c("Lagos State", "administrative_area_level_1", "political"),
          c("Nigeria", "country", "political"),
        ],
      },
      "12 Adeola",
    );
    expect(out).toEqual({
      address: "12 Adeola Odeku St, Victoria Island, Lagos 106104, Lagos, Nigeria",
      latitude: 6.4281,
      longitude: 3.4219,
      state: "Lagos",
      town: "Lagos",
    });
  });

  it("maps the Federal Capital Territory to the stored value Abuja and falls back to the LGA for the town", () => {
    const out = placeToAddress(
      {
        formattedAddress: "Wuse 2, Abuja, Nigeria",
        location: at(9.08, 7.47),
        addressComponents: [c("Abuja Municipal Area Council", "administrative_area_level_2"), c("Federal Capital Territory", "administrative_area_level_1")],
      },
      "Wuse",
    );
    expect(out.state).toBe("Abuja");
    expect(out.town).toBe("Abuja Municipal Area Council");
  });

  it("never guesses: an unrecognised first-level area leaves state null, and a missing location leaves coordinates null", () => {
    const out = placeToAddress(
      { formattedAddress: "Accra, Ghana", location: null, addressComponents: [c("Greater Accra Region", "administrative_area_level_1")] },
      "Accra",
    );
    expect(out.state).toBeNull();
    expect(out.latitude).toBeNull();
    expect(out.longitude).toBeNull();
  });

  it("keeps what the admin typed when Google returns no formatted address, and ignores a non-finite coordinate", () => {
    const out = placeToAddress({ formattedAddress: "  ", location: at(Number.NaN, 3), addressComponents: null }, " 5 Allen Avenue, Ikeja ");
    expect(out.address).toBe("5 Allen Avenue, Ikeja");
    expect(out.latitude).toBeNull();
    expect(out.town).toBeNull();
    expect(out.state).toBeNull();
  });
});
