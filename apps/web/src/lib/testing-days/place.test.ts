import { filterDaysByPlace, hoursLabel, mapLink, placeOptions } from "./model";

const days = [
  { state: "Lagos", city: "Ikeja" },
  { state: " lagos ", city: "Lekki" },
  { state: "FCT", city: "Abuja" },
  { state: null, city: "Ibadan" },
];

describe("place filter for testing days", () => {
  it("offers each place with a day once, whatever its spelling, sorted", () => {
    expect(placeOptions(days)).toEqual({ states: ["FCT", "Lagos"], cities: ["Abuja", "Ibadan", "Ikeja", "Lekki"] });
  });
  it("matches state and city without caring about case or spaces, and keeps everything for an empty choice", () => {
    expect(filterDaysByPlace(days, { state: "LAGOS" }).map((d) => d.city)).toEqual(["Ikeja", "Lekki"]);
    expect(filterDaysByPlace(days, { state: "lagos", city: "lekki" }).map((d) => d.city)).toEqual(["Lekki"]);
    expect(filterDaysByPlace(days, {})).toHaveLength(4);
    expect(filterDaysByPlace(days, { state: "Kano" })).toHaveLength(0);
  });
});

describe("hoursLabel and mapLink", () => {
  it("shows opening and closing time", () => {
    expect(hoursLabel("09:00:00", "15:30:00")).toBe("09:00 to 15:30");
    expect(hoursLabel("09:00:00", null)).toBe("from 09:00");
    expect(hoursLabel(null, null)).toBe("");
  });
  it("builds a map search from the venue address only", () => {
    const href = mapLink({ venue_name: "Civic Centre", address: "1 Ave & Co", city: "Lagos", state: "Lagos" });
    expect(href).toBe("https://www.google.com/maps/search/?api=1&query=Civic%20Centre%2C%201%20Ave%20%26%20Co%2C%20Lagos%2C%20Lagos");
  });
});
