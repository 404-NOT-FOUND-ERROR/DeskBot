/**
 * Where a broadcast is happening.
 *
 * The town used to have a single stage: anyone who investigated or joined in
 * walked to the fountain, whatever had been announced, because the plaza was
 * the only "somewhere is happening" the code knew. A fire at the bakery drew a
 * crowd to the fountain.
 *
 * So the round now asks one extra question - where is this happening? - and
 * routes the citizens who go and look to that place instead. It is a property
 * of the announcement rather than of any one citizen, so it costs one question
 * per round rather than one per person.
 */
import { PLACES, QUARTERS, type Place, type PlaceId } from "./town.ts";

/** Reads as a phrase in the option text: "the bell tower in the Willow Quarter". */
function describe(place: Place): string {
  const quarter = QUARTERS.find((q) => q.id === place.quarter);
  const where = quarter ? ` in the ${quarter.label}` : "";

  switch (place.kind) {
    case "plaza":
      return `${place.label}: the open square with the fountain at the centre of town. Also the answer when the announcement concerns the whole town rather than one spot, or when it names no place at all.`;
    case "landmark":
      return `${place.label}: the bell tower${where}.`;
    case "home":
      return `${place.label}: a row of houses where people live${where}.`;
    default:
      return `${place.label}: a workplace${where}.`;
  }
}

/** Option set for the location question, one entry per place on the map. */
export const LOCATION_CRITERIA: Record<string, string> = Object.fromEntries(
  PLACES.map((place) => [place.id, describe(place)]),
);

/** The place used when nothing better is known: town-wide news gathers at the square. */
export const DEFAULT_LOCATION: PlaceId = "plaza";

export function isPlaceId(value: unknown): value is PlaceId {
  return typeof value === "string" && PLACES.some((place) => place.id === value);
}

/** Narrows an answer to a real place, falling back to the square. */
export function locationOrDefault(value: unknown): PlaceId {
  return isPlaceId(value) ? value : DEFAULT_LOCATION;
}

/**
 * Words that point at a place, beyond the words already in its label. Used only
 * by the offline simulation: with no model to ask, it reads the broadcast for
 * the same cues a person would.
 */
const PLACE_WORDS: Partial<Record<string, string[]>> = {
  plaza: ["fountain", "square", "plaza", "centre", "center"],
  watchtower: ["watchtower", "tower", "bell"],
  chapel: ["chapel", "church", "priest"],
  school: ["school", "children", "pupils", "teacher", "classroom"],
  market: ["market", "hall", "stall", "trader"],
  bakery: ["bakery", "baker", "bread", "oven"],
  farm: ["farm", "field", "crop", "harvest", "barn"],
  clinic: ["clinic", "doctor", "nurse", "sick", "injured"],
  library: ["library", "books", "archive"],
  tavern: ["tavern", "inn", "ale", "landlord"],
  forge: ["forge", "smith", "anvil", "blacksmith"],
  docks: ["docks", "dock", "quay", "ship", "boat", "harbour", "harbor"],
};

/**
 * The simulation's stand-in for the location question: the place whose name or
 * associated words the broadcast mentions, or the square when it names none.
 * Deterministic, so the same broadcast always sites the same way.
 */
export function simulateLocation(broadcast: string): PlaceId {
  const text = broadcast.toLowerCase();
  let best: PlaceId = DEFAULT_LOCATION;
  let bestScore = 0;

  for (const place of PLACES) {
    const labelWords = place.label
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 3);
    const words = [...labelWords, ...(PLACE_WORDS[place.id] ?? [])];
    const score = words.filter((word) => text.includes(word)).length;
    if (score > bestScore) {
      bestScore = score;
      best = place.id;
    }
  }

  return best;
}
