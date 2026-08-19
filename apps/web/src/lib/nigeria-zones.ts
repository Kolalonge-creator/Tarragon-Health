/**
 * Nigeria's 6 geopolitical zones, each holding the `NIGERIAN_STATES` values
 * that belong to it (see nigeria-states.ts — `value` matches
 * service_regions.state exactly, including "Abuja" for the FCT).
 *
 * Used to lay the coverage map out by zone rather than attempting precise
 * state-boundary geometry: zone membership and each zone's compass position
 * relative to the others are settled facts, unlike hand-traced borders. The
 * grid position below (row, col) places zones roughly where they sit on a
 * real map — North West/Central/East across the top, South West/South/East
 * across the bottom — without claiming to render an accurate silhouette.
 */
export const NIGERIA_ZONES = [
  {
    id: "north_west",
    label: "North West",
    row: 1,
    col: 1,
    states: ["Sokoto", "Kebbi", "Zamfara", "Katsina", "Kano", "Jigawa", "Kaduna"],
  },
  {
    id: "north_central",
    label: "North Central",
    row: 1,
    col: 2,
    states: ["Niger", "Abuja", "Kwara", "Kogi", "Benue", "Plateau", "Nasarawa"],
  },
  {
    id: "north_east",
    label: "North East",
    row: 1,
    col: 3,
    states: ["Yobe", "Borno", "Bauchi", "Gombe", "Adamawa", "Taraba"],
  },
  {
    id: "south_west",
    label: "South West",
    row: 2,
    col: 1,
    states: ["Lagos", "Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
  },
  {
    id: "south_south",
    label: "South South",
    row: 2,
    col: 2,
    states: ["Delta", "Edo", "Rivers", "Bayelsa", "Cross River", "Akwa Ibom"],
  },
  {
    id: "south_east",
    label: "South East",
    row: 2,
    col: 3,
    states: ["Anambra", "Enugu", "Ebonyi", "Imo", "Abia"],
  },
] as const;
