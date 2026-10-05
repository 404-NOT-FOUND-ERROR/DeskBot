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
  presentation?: { space: string; point: DeskBotPresentationPoint; lot?: DeskBotPresentationPoint; model?: string } | null;
  areas?: DeskBotArea[];
}

export interface DeskBotObject {
  object_id: string;
  area_id: string;
  name: string;
  description: string;
  object_kind: string;
  state_scope: "catalog_only" | "persistent_living";
  state?: DeskBotObjectState;
  status_text?: string;
  resource_names?: Record<string,string>;
}

export interface DeskBotObjectState {
  object_id: string; kind: string; updated_at: string;
  water_level?: number; moisture?: number; health?: number; growth?: number; quantity?: number; dead_quantity?:number; condition?: number;
  stock?: Record<string,number>; capacity?: number;
  project_assets?: {
    floating_seedbed?: { project_id:string; status:'prototype'|'growing'|'ready'|'empty'|'dead'; installed_at:string; accepted_at?:string|null; quantity:number; health:number; moisture:number; growth:number; last_cared_at?:string|null; last_inspected_at?:string|null };
    small_water_pump?: { project_id:string; status:'assembled'|'moved'|'installed_trial'|'ready'|'broken'; assembled_at?:string; carrier_id?:string; installed_at?:string; accepted_at?:string|null; condition?:number; last_used_at?:string|null; use_count?:number };
  };
  project_drafts?:Record<string,{project_id:string;recorded_at:string;inputs:{resource:string;count:number}[];yield_count:number}>;
  recipe_book?:Record<string,{project_id:string;name:string;accepted_at:string;inputs:{resource:string;count:number}[];yield_count:number;feedback?:unknown[]}>;
  project_batches?:Record<string,{batch_id:string;status:'carried'|'served'|'awaiting_taste'|'tasted'|'expired';prepared_at:string;served_at?:string|null;expires_at:string;feedback?:unknown[];remaining_portions:number}>;
}
export interface DeskBotLivingActivity {
  activity_id: string; title: string; kind: "care"|"craft"; target_object_id: string; location_id: string;
  duration_seconds: number; inputs: { resource:string; name:string; count:number; from:string }[];
  output?: { resource:string; name:string; count:number; to:string };
  available:boolean; unavailable_reason:string|null;
}
export interface DeskBotLiving {
  schema:string; simulated_until:string; revision:number; rule_version:string;
  recovery: { pending:boolean; target_at:string };
  resource_names:Record<string,string>; inventory:{stock:Record<string,number>;capacity:number};
  recent_changes: { at:string; text:string; kind:string; task_id?:string; actor_id?:string }[];
  activities:DeskBotLivingActivity[];
  resource_renewal?: { id:string; installed_at:string; source_object_id:string; source_kind:'authored_world_physics'; resource:string; units_per_hour:number; description:string; preserved_existing_stocks_and_tasks:boolean }|null;
  community_supply?: { id:string; installed_at:string; source_kind:'authored_world_physics'; fruit_source_object_id:string; fruit_resource:string; fruit_units_per_hour:number; fruit_capacity:number; description:string; preserved_existing_stocks_and_tasks:boolean }|null;
}
export interface DeskBotAutonomy {
  schema:string;enabled:boolean;installed_at:string;revision:number;policy:string;
  actors:{actor_id:string;display_name:string;location_id:string;energy:number;appetite:number;paused:boolean;next_decision_at:string;
    plan:{plan_id:string;title:string;reason:string;status:string;index:number;steps:{kind:string}[];task_id:string|null;decision?:{source:string;reason:string;model?:string;memory_ids?:string[]}}|null;
    last_feedback:{at:string;text:string;kind:string}|null;inventory:Record<string,number>}[];
  recent:{at:string;actor_id:string;kind:string;text:string;task_id?:string}[];
}

export interface DeskBotMemoryEpisode {
  id:string;kind:'world_fact'|'personal_interpretation'|'hearsay';actor_ids:string[];at:string;text:string;topic:string|null;outcome:string;
  root_outcome_id?:string|null;
  independent_evidence:boolean;evidence_ids?:string[];expires_at?:string;
  source:{kind:string;task_id?:string;commitment_id?:string;label?:string;url?:string|null;model?:string;request_id?:string};
}
export interface DeskBotDevelopmentTopic {
  roots:number;practice:number;completed:number;failed:number;cancelled:number;own:number;invited:number;unknown_trigger:number;
}
export interface DeskBotDevelopmentFacetTopic {
  topic:string;label:string;
  contact:{count:number;source_record_ids:string[];days:string[]};
  interest:{status:string;summary:string;active_roots:string[];invited_roots:string[];obligation_roots:string[];unknown_roots:string[];active_days:string[];active_contexts:string[];bonus:number};
  capability:{status:string;summary:string;success_roots:string[];performance_failure_roots:string[];condition_failure_roots:string[];unknown_failure_roots:string[];cancelled_roots:string[];
    activities:{activity_id:string;successes:number;failures:number;days:string[];status:string}[];root_outcome_ids:string[]};
  self_assessment:{status:string;summary:string;basis:'rules';root_outcome_ids:string[]};
  wish:{status:'not_established';automatic:false;stable_interest:boolean};
}
export interface DeskBotDevelopmentFacets {
  schema:'deskbot.development-facets.v1';enabled:boolean;installed_at:string|null;revision:number;
  actors:{actor_id:string;display_name:string;topics:DeskBotDevelopmentFacetTopic[]}[];
  coverage?:{limitations?:string[];[key:string]:unknown};
}
export interface DeskBotDevelopmentRecord {
  id:string;root_outcome_id:string;actor_ids:string[];topic:string|null;outcome:string;at:string;
  title?:string;activity_id:string|null;location_id:string|null;project_ids:string[];
  source:{kind:string;task_id?:string|null;commitment_id?:string|null;task_kind?:string|null};
  causes:{source_record_ids:string[];source_event_ids:string[];sources:{record_id:string;event_id:string|null;origin_id?:string|null;category:string;input_category?:string|null;attested:boolean}[];
    plan_id:string|null;decision:{source:string|null;model?:string|null;request_id?:string|null;memory_ids?:string[]}|null;trigger:'own'|'invited'|'unknown';
    motivation?:{kind:'need'|'self_continuation'|'invited'|'unknown';basis_score?:number;facet_root_ids?:string[]}};
  effect:{practice:boolean;relationship:boolean;legacy_interest_eligible:boolean;legacy_interest_known?:boolean;completion_effect:string|null};
  views:{memory_ids:string[];project_stages:{project_id:string;stage_id:string|null}[];commitment_ids:string[];linked_task_roots:string[]};
  failure:{reason:string|null;code:string|null;classification?:string}|null;historical_import:boolean;
}
export interface DeskBotDevelopmentEvidence {
  schema:'deskbot.development-evidence.v1';enabled:boolean;installed_at:string|null;revision:number;owner_id:string;
  counts:{roots:number;practice:number;relationship:number;historical_import:number;completed:number;failed:number;cancelled:number};
  actors:{actor_id:string;display_name:string;roots:number;practice:number;relationship:number;topics:Record<string,DeskBotDevelopmentTopic>}[];
  recent:DeskBotDevelopmentRecord[];
  facets?:DeskBotDevelopmentFacets|null;
  coverage:{retention:{max_records:number;counts_scope:'retained_unique_root_outcomes'};historical_import_roots:number;causality_unknown_roots:number;limitations:string[]};
}
export interface DeskBotLivedMemory {
  schema:string;owner_id:string;installed_at:string;revision:number;identity_preserved:boolean;counts:Record<string,number>;
  actors:{actor_id:string;display_name:string;interests:Record<string,{topic:string;days:string[];stage:string;successes:number;setbacks:number;bonus:number;evidence_ids:string[]}>}[];
  own:DeskBotMemoryEpisode[];recent:DeskBotMemoryEpisode[];
  development?:DeskBotDevelopmentEvidence|null;
  planner:{enabled:boolean;policy:string;limits:{per_hour:number;per_day:number;actor_cooldown_minutes:number};attempts_last_hour:number;
    requests:{id:string;actor_id:string;status:string;failure?:string;model?:string;choice?:{goal:string;reason:string;memory_ids:string[]}|null}[];
    recent:{id:string;actor_id:string;at:string;status:string;reason:string;model:string|null;goal:string|null}[]};
}
export interface DeskBotArea {
  area_id: string;
  location_id: string;
  name: string;
  description: string;
  access: "public" | "resident";
  neighbor_area_ids: string[];
  objects?: DeskBotObject[];
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
  resident_version?:string;
  role_label?:string;
  color?:string;
  palette?:number;
  desires?:string[];
  flaws?:string[];
  home_location_id?:string;
  project?:{goal:string;status:string;progress?:Pick<DeskBotResidentProject,'stage_id'|'attempt'|'ready_at'|'completed_at'|'last_outcome'>|null};
}

export interface DeskBotProjectOutcome {
  at:string; text:string; success:boolean; kind:'stage_completed'|'setback'|'cancelled'|'maintenance'|'project_completed';
  task_id:string;activity_id:string;actor_id:string;stage_id:string;attempt:number;reason?:string;
}
export interface DeskBotResidentProject {
  project_id:string;actor_id?:string;owner_id:string;name:string;goal:string;status:'active'|'setback'|'completed';attempt:number;
  stage_id:string;stage_title:string;stage_started_at:string;target_object_id:string|null;location_id:string|null;
  ready_at:string|null;blocked_reason:string|null;last_outcome:DeskBotProjectOutcome|null;
  evidence:{at:string;task_id:string;activity_id:string;actor_id:string;stage_id:string;attempt:number;text:string;details?:Record<string,unknown>}[];
  history:DeskBotProjectOutcome[];completed_at:string|null;retry_count:number;
}
export interface DeskBotResidentProjects {
  schema:string;version:string;installed_at:string;revision:number;projects:DeskBotResidentProject[];
}

export interface DeskBotSocialCommitment {
  id:string;kind:string;title:string;reason:string;status:string;phase:string;
  actors:string[];people:{id:string;name:string}[];location_id:string;location_name:string;
  created_at:string;updated_at:string;deadline_at:string;respond_after:string;finished_at?:string;
  responses:Record<string,string>;delay_count:number;last_note:string;
  changes:{at:string;text:string;task_id?:string}[];
}
export interface DeskBotSocial {
  schema:string;policy:string;installed_at:string;revision:number;
  commitments:DeskBotSocialCommitment[];
  relationships:Record<string,{actors:string[];encounters:number;trust:number;kept:number;missed:number;last_event:{at:string;text:string}|null}>;
  recent:{at:string;kind:string;text:string;commitment_id:string|null;actor_ids:string[]}[];
  notices:{id:string;at:string;author_id:string;kind:string;origin_id:string;source_commitment_id:string;source_task_ids:string[];text:string;verified_by:string}[];
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
  logical_time: { day: number; minute_of_day: number; tick: number; date?: string; time_zone?: string };
  clock?: { mode: string; rate?: number; time_zone?: string };
  environment?: DeskBotEnvironment;
  living?: DeskBotLiving|null;
  autonomy?: DeskBotAutonomy|null;
  memory?:DeskBotLivedMemory|null;
  development?:DeskBotDevelopmentEvidence|null;
  projects?:DeskBotResidentProjects|null;
  social?:DeskBotSocial|null;
  refraction?:DeskBotRefraction|null;
  resident_life?:{version:string;installed_at:string;count:number}|null;
  tasks?: DeskBotWorldTask[];
  content?: { content_id: string; version: string; objects_have_simulated_state: boolean } | null;
  regions?: { region_id: string; name: string; description: string; color: string }[];
  areas?: DeskBotArea[];
  objects?: DeskBotObject[];
  paths?: { passage_id: string | null; from_location_id: string; to_location_id: string; open: boolean; blocked_reason: string | null }[];
  protagonist: { character_id: string; location_id: string; travel_state?: { status: string; task_id?: string; arrival_text?: string | null } };
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

export interface DeskBotRefraction {
  schema:string;policy:string;revision:number;
  suggestions:{id:string;title:string}[];
  source_status:{id:string;name:string;status:string;last_success_at?:string|null;next_attempt_at?:string|null;ttl_ms?:number;error_code?:string|null}[];
  records:{id:string;category:string;source_label:string;source_url:string|null;observed_at:string;expires_at:string;attested:boolean;
    meaning:string;text:string;summary:string;suggestion:string|null;status:string;last_note:string;origin_id:string;plan_id?:string|null;published_at?:string|null;original_text?:string|null;
    decisions:{at:string;selected:boolean;reason:string}[]}[];
}

export interface DeskBotEnvironment {
  schema: "deskbot.world-environment.v1";
  projected_at: string;
  time: { mode:string; time_zone:string; minute_of_day:number; phase:string; synced_at:string|null; lighting_convention:string };
  weather: { status:"fresh"|"stale"|"unavailable"; location:string|null; condition:string|null; provider:string|null;
    observed_at:string|null; expires_at:string|null; temperature_c:number|null; wind_mps:number|null;
    precipitation:"rain"|"snow"|"none"; cloud_cover:number; intensity:number };
}

export interface DeskBotWorldTask {
  task_id: string;
  kind: "travel" | "craft" | "care";
  actor_id: string;
  title: string;
  status: "running" | "paused" | "completed" | "cancelled" | "failed";
  due_at: string;
  remaining_ms: number;
  location_id?: string;
  started_at?: string;
  segment_started_at?: string;
  duration_ms?: number;
  from_location_id?: string;
  to_location_id?: string;
  destination_location_id?: string;
  failure_reason?: string | null;
  activity_id?: string;
  origin?:string;
  life_action?:string;
  role_trial?:{trial_id:string;proposal_id:string;direction_id:string;axis:'form'|'vocation';attempt_id:string;step_role:'primary'|'support';primary_activity_id:string};
  target_object_id?: string;
  completion?: { effect:string; result?:{ success:boolean; text?:string; reason?:string } }|null;
  reservation?: { status: 'held'|'consumed'|'returned'; inputs: { container:string; resource:string; count:number }[] };
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
    mutation?: { details?: { arrival_text?: string | null; departure_text?: string; task?: DeskBotWorldTask } };
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

export type DeskBotRoleWishAxis = 'form' | 'vocation';
export type DeskBotRoleWishChoice = 'try' | 'later' | 'reject';
export type DeskBotPracticalTrialOperation = 'start' | 'pause' | 'resume' | 'adjust' | 'exit';
export interface DeskBotPracticalRoleTrial {
  schema:'deskbot.practical-role-trial.v1';trial_id:string;proposal_id:string;actor_id:string;direction_id:string;axis:DeskBotRoleWishAxis;
  status:'running'|'paused'|'blocked'|'review'|'exited';variant_id:string;variant_label:string;
  variant_choices:{id:string;label:string}[];allowed_actions:Exclude<DeskBotPracticalTrialOperation,'start'>[];
  started_at:string;updated_at:string;
  active_task:null|{task_id:string;title:string;activity_id:string|null;status:string;due_at:string|null;remaining_ms:number|null;step_role:'primary'|'support'};
  current_step:null|{kind:string;activity_id:string|null;location_id:string|null;step_role:'primary'|'support'};
  outcomes:{root_outcome_id:string;at:string;outcome:string;activity_id:string|null;location_id:string|null;step_role:'primary'|'support';attempt_id:string;classification:null|'resource'|'condition'|'route'|'coordination'|'performance'|'unclassified'|'cancelled';failure_code:string|null}[];
  progress:{successful_primary:number;condition_failures:number;performance_failures:number;unknown_failures:number;cancelled:number;primary_days:string[];root_outcome_ids:string[];support_roots:string[];started_attempts:number};
  review:{ready:boolean;reason:null|'repeated_actual_success'|'execution_difficulties';basis:'canonical_unique_task_results';summary:string;quality_proven:false;qualification_proven:false;preference_proven:false;changes_appearance:false};
  blockers:{code:string;label:string;classification:string|null}[];next_step:string;frozen_wish_root_ids:string[];
}
export interface DeskBotPracticalTrialActionResponse {
  schema:'deskbot.practical-role-trial-action-response.v1';accepted:boolean;duplicate:boolean;
  proposal:DeskBotRoleProposal;practical_trial:DeskBotPracticalRoleTrial;world_mutation?:unknown;
}
export interface DeskBotRoleWishReadiness {
  eligible:boolean;
  barriers:{id:string;label:string;scope:'evidence'|'circumstance'}[];
  checks:{id:string;label:string;passed:boolean;actual:unknown;required:unknown}[];
}
export interface DeskBotRoleWishBasis {
  scope:string;root_outcome_ids:string[];active_roots:string[];active_days:string[];active_contexts:string[];
  threshold_root_ids:string[];practice_success_roots:string[];practice_days:string[];invited_practice_roots:string[];
  obligation_roots:string[];condition_failure_roots:string[];performance_failure_roots:string[];unknown_failure_roots:string[];
  counts:Record<string,number>;historical_import_included?:boolean;
}
export interface DeskBotRoleWishDirection {
  direction_id:string;label:string;axis:DeskBotRoleWishAxis;
  readiness:DeskBotRoleWishReadiness;basis:DeskBotRoleWishBasis;
  authored_reason:string;next_step:string;fingerprint:string;
}
export interface DeskBotRoleWishes {
  schema:'deskbot.role-wishes.v1';enabled:boolean;character_id:string;at:string;evidence_revision:number;
  window:{days:number;from:string;until:string;time_zone:string};fingerprint:string;directions:DeskBotRoleWishDirection[];
}
export interface DeskBotRoleProposal {
  proposal_id:string;character_id?:string;direction_id:string;label?:string;life?:string;status:string;
  origin?:string;axis?:DeskBotRoleWishAxis;authored_reason?:string;next_step?:string;
  wish_basis?:DeskBotRoleWishBasis;current_gate?:DeskBotRoleWishReadiness;
  proposal_gate?:{eligible?:boolean;barriers?:{id:string;label:string;scope?:string}[]};
  cooldown_until?:string|null;created_at?:string;updated_at?:string;reason?:string;
  practical_trial_available?:boolean;practical_trial_connected?:boolean;practical_trial?:DeskBotPracticalRoleTrial|null;
  evidence_ids?:string[];trial?:{status:string;started_at?:string;turns_observed:number;max_turns:number;positive_feedback:number;negative_feedback:number}|null;
}
export interface DeskBotRoleEvolution {
  schema:string;wishes?:DeskBotRoleWishes|null;
  development?:{role_wishes?:DeskBotRoleWishes|null;directions?:DeskBotRoleWishDirection[]};
}
export interface DeskBotRoleWishSnapshot {
  evolution:DeskBotRoleEvolution;proposals:DeskBotRoleProposal[];
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
