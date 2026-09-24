import type { Action } from "./actions.ts";
import type { Citizen } from "./citizens.ts";
import { routeLength, routeBetween } from "./routes.ts";
import { DEFAULT_LOCATION } from "./locations.ts";
import { BLOCK_PITCH, getPlace, type Place, type PlaceId } from "./town.ts";

export interface Point {
  x: number;
  y: number;
}

/** Deterministic value in [0, 1) for an integer seed. */
function unit(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * A spot on the street ring that runs around a place's block, so people wait
 * on the road outside a building rather than standing inside its walls.
 * `u` in [0, 1) walks once around the ring; `lane` nudges the spot across the
 * street so a crowd spreads over both pavements instead of one line.
 */
export function ringPoint(place: Place, u: number, lane: number): Point {
  const half = BLOCK_PITCH / 2;
  const t = ((u % 1) + 1) % 1;
  const side = Math.floor(t * 4);
  const along = (t * 4 - side) * 2 - 1; // -1..1 along the side
  const offset = half + lane;
  switch (side) {
    case 0:
      return { x: place.x + along * half, y: place.y - offset };
    case 1:
      return { x: place.x + offset, y: place.y + along * half };
    case 2:
      return { x: place.x - along * half, y: place.y + offset };
    default:
      return { x: place.x - offset, y: place.y - along * half };
  }
}

function laneFor(seed: number): number {
  return (unit(seed) - 0.5) * 2.6;
}

/** Where a citizen stands while nothing is happening: on the street outside their workplace. */
export function postPosition(citizen: Citizen): Point {
  const place = getPlace(citizen.workId);
  return ringPoint(place, unit(citizen.id * 3 + 1), laneFor(citizen.id * 5 + 2));
}

/** Radius of the fountain basin in the middle of Fountain Square, in map units. */
export const FOUNTAIN_RADIUS = 3.2;

/**
 * Where a reaction sends someone. Each of the five actions has its own visually
 * distinct destination, so the shape of the crowd tells you the outcome before
 * you read a single number.
 */
export function destinationFor(citizen: Citizen, action: Action, locationId: PlaceId = DEFAULT_LOCATION): Point {
  // Where the announcement happened. Citizens who go and look head here rather
  // than always converging on the fountain.
  const scene = getPlace(locationId);

  switch (action) {
    case "IGNORE":
      return postPosition(citizen);

    case "JOIN": {
      // A crowd packed in around whatever was announced.
      const angle = (citizen.id * 137.508 * Math.PI) / 180;
      const r = FOUNTAIN_RADIUS + 1.2 + unit(citizen.id * 7 + 3) * 3.6;
      return { x: scene.x + Math.cos(angle) * r, y: scene.y + Math.sin(angle) * r };
    }

    case "INVESTIGATE":
      // A cautious ring on the streets around it, looking in.
      return ringPoint(scene, (citizen.id * 0.618034) % 1, laneFor(citizen.id * 11 + 4));

    case "FLEE":
      return ringPoint(getPlace(citizen.homeId), unit(citizen.id * 11 + 5), laneFor(citizen.id * 13 + 6));

    case "WARN":
      return ringPoint(getPlace("watchtower"), unit(citizen.id * 13 + 7), laneFor(citizen.id * 17 + 8));
  }
}

/** Walking speed, in map units per second. Quick enough that the whole town settles in a couple of seconds. */
export const WALK_SPEED = 42;

/** Travel time in ms along the street route, so distant citizens visibly take longer to arrive. */
export function travelDurationMs(from: Point, to: Point): number {
  const distance = routeLength(routeBetween(from, to));
  if (distance < 0.01) return 0;
  return Math.round(Math.min(4200, 350 + (distance / WALK_SPEED) * 1000));
}
