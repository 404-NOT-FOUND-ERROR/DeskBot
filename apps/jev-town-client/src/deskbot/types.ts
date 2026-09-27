export interface DeskBotLocation {
  location_id: string;
  settlement_id?: string;
  region_id?: string | null;
  location_kind?: string | null;
  world_role?: string | null;
  lore_keys?: string[];
  name: string;
  description: string;
  x: number;
  y: number;
  neighbors: string[];
  current: boolean;
  reachable: boolean;
  arrival_text: string;
}

export interface DeskBotNpc {
  npc_id: string;
  display_name: string;
  role: string;
  location_id: string;
  status: string;
  bio: string;
  temperament: string;
  speech_style: string;
  last_action: string | null;
  last_response?: string | null;
  relationship?: DeskBotNpcRelationship;
}

export interface DeskBotNpcRelationship {
  familiarity: number;
  trust: number;
  encounters: number;
}

export interface DeskBotWorldMap {
  schema: "deskbot.world-map.v0.1";
  world_id: string;
  world_revision: number;
  logical_time: { day: number; minute_of_day: number; tick: number };
  protagonist: { character_id: string; location_id: string };
  world_setting?: {
    setting_id: string;
    version: string;
    display_name: string;
  };
  settlement?: {
    settlement_id: string;
    display_name: string;
    english_name: string;
    setting_id: string;
    type: string;
    status: string;
    description: string;
    narrative_anchor: string;
  };
  locations: DeskBotLocation[];
  npcs: DeskBotNpc[];
  active_event?: { event_id?: string; title?: string; blocks_travel?: boolean } | null;
}

export interface DeskBotWorldRouteLocation {
  location_id: string;
  name: string;
}

export interface DeskBotPresentationPoint {
  x: number;
  y: number;
}

export interface DeskBotWorldRouteStep {
  index: number;
  from_location_id: string;
  from_name: string;
  to_location_id: string;
  to_name: string;
  travel_cost_minutes: number;
  presentation_space?: string;
  presentation_points?: DeskBotPresentationPoint[];
}

export interface DeskBotWorldRoute {
  schema: "deskbot.world-route.v0.1";
  world_id: string;
  world_revision: number;
  character_id: string;
  current_location_id: string;
  destination_location_id: string;
  found: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  locations: DeskBotWorldRouteLocation[];
  steps: DeskBotWorldRouteStep[];
  total_cost_minutes: number;
}

export interface DeskBotWorldRouteResponse {
  schema: "deskbot.world-route-response.v0.1";
  world_revision: number;
  route: DeskBotWorldRoute;
  map: DeskBotWorldMap;
}

export interface DeskBotWorldTravelResponse {
  schema: "deskbot.world-travel-response.v0.1";
  accepted: boolean;
  duplicate: boolean;
  map: DeskBotWorldMap;
  world_mutation?: {
    applied?: boolean;
    mutation?: { details?: { arrival_text?: string | null } };
  };
}

export interface DeskBotChatResult {
  reply: string;
  expressionIntent?: { mode?: string; pace?: string };
}

export interface DeskBotLifeScene {
  scene_id: string;
  title: string;
  narration: string;
  sensory_cue: string;
  opportunity: string;
  location_id: string;
  participants: string[];
  started_at: string;
  expires_at: string;
}

export interface DeskBotLifeWorld {
  schema: "deskbot.world-life.v0.3";
  enabled: boolean;
  world_revision: number;
  current_location_id: string;
  current_scene: DeskBotLifeScene | null;
  recent_scenes: DeskBotLifeScene[];
  recent_experiences: DeskBotExperience[];
  encounters: DeskBotNpc[];
  available_interactions: DeskBotInteractionIntent[];
}

export type DeskBotInteractionIntent = "observe" | "greet" | "chat" | "suggest" | "help" | "invite";

export interface DeskBotRoleDirection {
  direction_id: string;
  label: string;
  life: string;
  cues: string[];
}

export interface DeskBotExperience {
  experience_id: string;
  kind: string;
  npc_id: string;
  npc_name: string | null;
  scene_id: string | null;
  location_id: string;
  intent: DeskBotInteractionIntent;
  summary: string;
  occurred_at: string;
  role_direction: DeskBotRoleDirection | null;
}

export interface DeskBotNpcInteractionRequest {
  npcId: string;
  intent: DeskBotInteractionIntent;
  idea?: string;
  interactionId?: string;
}

export interface DeskBotNpcInteractionResponse {
  schema: "deskbot.npc-interaction-response.v0.2";
  accepted: boolean;
  duplicate: boolean;
  interaction_id: string;
  response: string;
  experience: DeskBotExperience | null;
  role_evidence: {
    status: "observing";
    confidence: number;
    direction: DeskBotRoleDirection | null;
  } | null;
  npc: DeskBotNpc;
  life: DeskBotLifeWorld;
}

export interface DeskBotActionCandidate {
  id: string;
  npcId: string;
  npcName: string;
  title: string;
  rationale: string;
  actionName: string;
  status: string;
  fromLocationId: string;
  locationId?: string;
  worldRevision: number;
}
