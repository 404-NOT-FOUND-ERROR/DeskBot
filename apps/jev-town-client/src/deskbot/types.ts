export interface DeskBotLocation {
  location_id: string;
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
}

export interface DeskBotWorldMap {
  schema: "deskbot.world-map.v0.1";
  world_id: string;
  world_revision: number;
  logical_time: { day: number; minute_of_day: number; tick: number };
  protagonist: { character_id: string; location_id: string };
  locations: DeskBotLocation[];
  npcs: DeskBotNpc[];
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
