import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { InputError } from './input-store.mjs';
import { DEFAULT_SETTLEMENT, DEFAULT_WORLD_LOCATIONS } from './world-definition.mjs';

const CONTENT_ROOT = new URL('../../../world-content/settlements/', import.meta.url);
const REQUIRED_NPC_FIELDS = Object.freeze([
  'npc_id', 'identity', 'role', 'desire', 'location_id', 'conditions',
  'legal_actions', 'status',
]);

export class ContentPackageError extends InputError {
  constructor(statusCode, code, message, details = null) {
    super(statusCode, code, message);
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentPackageError(500, 'content_package_invalid', `${field} must be an object`);
  }
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ContentPackageError(500, 'content_package_invalid', `${field} must be non-empty text`);
  }
  return value.trim();
}

function stringArray(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new ContentPackageError(500, 'content_package_invalid', `${field} must be a non-empty string array`);
  }
  return value.map(item => item.trim());
}

function readJson(filename) {
  try {
    return JSON.parse(readFileSync(new URL(filename, CONTENT_ROOT), 'utf8'));
  } catch (error) {
    throw new ContentPackageError(500, 'content_package_unreadable', `Unable to read ${filename}: ${error.message}`);
  }
}

function assertAttached(value, settlementId, settingId, field) {
  const input = object(value, field);
  if (text(input.settlement_id, `${field}.settlement_id`) !== settlementId) {
    throw new ContentPackageError(500, 'content_package_detached', `${field} is attached to another settlement`);
  }
  if (input.setting_id !== undefined && text(input.setting_id, `${field}.setting_id`) !== settingId) {
    throw new ContentPackageError(500, 'content_package_detached', `${field} is attached to another setting`);
  }
  return input;
}

function validateLocations(raw, canonicalLocations, settlementId, settingId) {
  const locations = assertAttached(raw, settlementId, settingId, 'locations.json');
  if (!Array.isArray(locations.locations) || locations.locations.length === 0) {
    throw new ContentPackageError(500, 'content_package_invalid', 'locations.locations must be a non-empty array');
  }
  const canonical = new Map(canonicalLocations.map(item => [item.location_id, item]));
  const seen = new Set();
  const compiled = locations.locations.map((entry, index) => {
    const location = object(entry, `locations.locations[${index}]`);
    const id = text(location.location_id, `locations.locations[${index}].location_id`);
    if (seen.has(id) || !canonical.has(id)) {
      throw new ContentPackageError(500, 'content_package_location_unknown', `Unknown or duplicate canonical location: ${id}`);
    }
    seen.add(id);
    const source = canonical.get(id);
    for (const field of ['region_id', 'location_kind', 'world_role']) {
      if (location[field] !== source[field]) {
        throw new ContentPackageError(500, 'content_package_location_mismatch', `${id}.${field} does not match canonical world`);
      }
    }
    stringArray(location.lore_keys, `locations.locations[${index}].lore_keys`);
    return clone({ ...location, settlement_id: settlementId });
  });
  if (seen.size !== canonical.size) {
    throw new ContentPackageError(500, 'content_package_location_incomplete', 'Content locations must cover every canonical location');
  }
  return compiled;
}

function validateNpcs(raw, locationIds, settlementId) {
  const npcs = assertAttached(raw, settlementId, DEFAULT_SETTLEMENT.setting_id, 'npcs.json');
  if (npcs.npc_model !== 'neva-mind-structured-agent-v0.1') {
    throw new ContentPackageError(500, 'content_package_invalid', 'npcs.npc_model must use the NevaMind structured model');
  }
  const declarations = stringArray(npcs.fields, 'npcs.fields');
  for (const field of REQUIRED_NPC_FIELDS) {
    if (!declarations.includes(field)) {
      throw new ContentPackageError(500, 'content_package_invalid', `npcs.fields is missing ${field}`);
    }
  }
  if (!Array.isArray(npcs.npcs) || npcs.npcs.length === 0) {
    throw new ContentPackageError(500, 'content_package_invalid', 'npcs.npcs must be a non-empty array');
  }
  const seen = new Set();
  return npcs.npcs.map((entry, index) => {
    const npc = object(entry, `npcs.npcs[${index}]`);
    for (const field of REQUIRED_NPC_FIELDS.filter(field => !['conditions', 'legal_actions'].includes(field))) {
      text(npc[field], `npcs.npcs[${index}].${field}`);
    }
    if (seen.has(npc.npc_id)) throw new ContentPackageError(500, 'content_package_invalid', `Duplicate NPC: ${npc.npc_id}`);
    if (!locationIds.has(npc.location_id)) throw new ContentPackageError(500, 'content_package_npc_location_unknown', `NPC ${npc.npc_id} has an unknown location`);
    stringArray(npc.conditions, `npcs.npcs[${index}].conditions`);
    stringArray(npc.legal_actions, `npcs.npcs[${index}].legal_actions`);
    seen.add(npc.npc_id);
    return clone(npc);
  });
}

function validateSchedules(raw, npcIds, locationIds, settlementId) {
  const schedules = assertAttached(raw, settlementId, DEFAULT_SETTLEMENT.setting_id, 'schedules.json');
  if (schedules.time_basis !== 'logical_world_time') {
    throw new ContentPackageError(500, 'content_package_schedule_invalid', 'schedules.time_basis must be logical_world_time');
  }
  const slotMinutes = schedules.slot_minutes;
  if (!Number.isInteger(slotMinutes) || slotMinutes < 1 || slotMinutes > 1440 || 1440 % slotMinutes !== 0) {
    throw new ContentPackageError(500, 'content_package_schedule_invalid', 'schedules.slot_minutes must divide a 24-hour logical day');
  }
  if (!Array.isArray(schedules.schedules) || schedules.schedules.length === 0) {
    throw new ContentPackageError(500, 'content_package_invalid', 'schedules.schedules must be a non-empty array');
  }
  const seen = new Set();
  const compiled = schedules.schedules.map((entry, index) => {
    const schedule = object(entry, `schedules.schedules[${index}]`);
    const npcId = text(schedule.npc_id, `schedules.schedules[${index}].npc_id`);
    if (seen.has(npcId) || !npcIds.has(npcId)) throw new ContentPackageError(500, 'content_package_schedule_invalid', `Schedule must identify a unique known NPC: ${npcId}`);
    const route = stringArray(schedule.route, `schedules.schedules[${index}].route`);
    if (route.some(locationId => !locationIds.has(locationId))) throw new ContentPackageError(500, 'content_package_schedule_invalid', `Schedule ${npcId} has an unknown route location`);
    text(schedule.purpose, `schedules.schedules[${index}].purpose`);
    seen.add(npcId);
    return clone({ ...schedule, slot_minutes: slotMinutes, time_basis: schedules.time_basis });
  });
  if (seen.size !== npcIds.size) throw new ContentPackageError(500, 'content_package_schedule_incomplete', 'Every content NPC must have one schedule');
  return { ...clone(schedules), slot_minutes: slotMinutes, schedules: compiled };
}

function validateStories(raw, npcIds, locationIds, settlementId) {
  const stories = assertAttached(raw, settlementId, DEFAULT_SETTLEMENT.setting_id, 'stories.json');
  object(stories.starter_arc, 'stories.starter_arc');
  text(stories.starter_arc.arc_id, 'stories.starter_arc.arc_id');
  text(stories.starter_arc.title, 'stories.starter_arc.title');
  text(stories.starter_arc.premise, 'stories.starter_arc.premise');
  text(stories.starter_arc.first_person_anchor, 'stories.starter_arc.first_person_anchor');
  const packages = stories.story_packages ?? [];
  if (!Array.isArray(packages)) throw new ContentPackageError(500, 'content_package_invalid', 'stories.story_packages must be an array');
  const seen = new Set();
  const compiled = packages.map((entry, index) => {
    const pack = object(entry, `stories.story_packages[${index}]`);
    const id = text(pack.id, `stories.story_packages[${index}].id`);
    if (seen.has(id)) throw new ContentPackageError(500, 'content_package_invalid', `Duplicate story package: ${id}`);
    if (!/^[-a-z0-9]+-v\d+$/u.test(id)) throw new ContentPackageError(500, 'content_package_invalid', `Story package ${id} must be versioned`);
    text(pack.title, `stories.story_packages[${index}].title`);
    text(pack.premise, `stories.story_packages[${index}].premise`);
    const npcId = text(pack.npc_id, `stories.story_packages[${index}].npc_id`);
    if (!npcIds.has(npcId)) throw new ContentPackageError(500, 'content_package_story_npc_unknown', `Story package ${id} references unknown NPC`);
    if (pack.npc_location_id !== undefined && !locationIds.has(text(pack.npc_location_id, `stories.story_packages[${index}].npc_location_id`))) {
      throw new ContentPackageError(500, 'content_package_story_location_unknown', `Story package ${id} references an unknown NPC arrival location`);
    }
    if (!Array.isArray(pack.days) || pack.days.length < 1 || pack.days.length > 7) throw new ContentPackageError(500, 'content_package_story_invalid', `Story package ${id} needs 1 to 7 days`);
    const offsets = pack.step_offsets_hours ?? pack.days.map((_, stepIndex) => stepIndex * 24);
    if (!Array.isArray(offsets) || offsets.length !== pack.days.length
      || offsets.some((hour, stepIndex) => !Number.isInteger(hour) || hour < 0 || hour > 24 || (stepIndex === 0 && hour !== 0)
        || (stepIndex > 0 && hour <= offsets[stepIndex - 1]))) {
      throw new ContentPackageError(500, 'content_package_story_invalid', `Story package ${id} has invalid step_offsets_hours`);
    }
    const days = pack.days.map((day, dayIndex) => {
      const value = object(day, `stories.story_packages[${index}].days[${dayIndex}]`);
      for (const field of ['key', 'title', 'summary', 'consequence', 'opportunity']) text(value[field], `stories.story_packages[${index}].days[${dayIndex}].${field}`);
      if (value.action && !['world_event', 'npc_action', 'world_consequence'].includes(value.action)) throw new ContentPackageError(500, 'content_package_story_invalid', `Unsupported story action in ${id}`);
      if (value.action === 'npc_action') {
        const action = object(value.npc_action, `stories.story_packages[${index}].days[${dayIndex}].npc_action`);
        text(action.action_name, 'story npc_action.action_name');
        if (action.status !== undefined) text(action.status, 'story npc_action.status');
      }
      if (value.event !== undefined) {
        const event = object(value.event, `stories.story_packages[${index}].days[${dayIndex}].event`);
        if (event.status !== undefined) text(event.status, 'story event.status');
        if (event.outcome !== undefined) text(event.outcome, 'story event.outcome');
      }
      return clone(value);
    });
    seen.add(id);
    return clone({ ...pack, step_offsets_hours: offsets, days });
  });
  return { ...clone(stories), story_packages: compiled };
}

function validateLore(raw, settlementId) {
  const lore = assertAttached(raw, settlementId, DEFAULT_SETTLEMENT.setting_id, 'lore.json');
  if (!Array.isArray(lore.entries)) throw new ContentPackageError(500, 'content_package_invalid', 'lore.entries must be an array');
  lore.entries.forEach((entry, index) => {
    const item = object(entry, `lore.entries[${index}]`);
    text(item.entry_id, `lore.entries[${index}].entry_id`);
    stringArray(item.keys, `lore.entries[${index}].keys`);
    text(item.summary, `lore.entries[${index}].summary`);
    if (!Number.isInteger(item.priority)) throw new ContentPackageError(500, 'content_package_invalid', `lore.entries[${index}].priority must be an integer`);
  });
  return clone(lore);
}

function validateWorldEvents(raw, settlementId) {
  const events = assertAttached(raw, settlementId, DEFAULT_SETTLEMENT.setting_id, 'world-events.json');
  if (!Array.isArray(events.events)) throw new ContentPackageError(500, 'content_package_invalid', 'world-events.events must be an array');
  const seen = new Set();
  const compiled = events.events.map((entry, index) => {
    const event = object(entry, `world-events.events[${index}]`);
    const id = text(event.event_id, `world-events.events[${index}].event_id`);
    if (seen.has(id)) throw new ContentPackageError(500, 'content_package_invalid', `Duplicate world event template: ${id}`);
    text(event.title, `world-events.events[${index}].title`);
    text(event.kind, `world-events.events[${index}].kind`);
    text(event.status, `world-events.events[${index}].status`);
    text(event.summary, `world-events.events[${index}].summary`);
    stringArray(event.allowed_actions, `world-events.events[${index}].allowed_actions`);
    seen.add(id);
    return clone(event);
  });
  text(events.ingestion_boundary, 'world-events.ingestion_boundary');
  return { ...clone(events), events: compiled };
}

let cached;

export function loadMorrowmereContent({ refresh = false } = {}) {
  if (cached && !refresh) return clone(cached);
  const settlement = object(readJson('morrowmere/settlement.json'), 'settlement.json');
  const settlementId = text(settlement.settlement_id, 'settlement.settlement_id');
  const settingId = text(settlement.setting_id, 'settlement.setting_id');
  if (settlementId !== DEFAULT_SETTLEMENT.settlement_id || settingId !== DEFAULT_SETTLEMENT.setting_id) {
    throw new ContentPackageError(500, 'content_package_detached', 'Morrowmere content is detached from the canonical world');
  }
  text(settlement.display_name, 'settlement.display_name');
  text(settlement.english_name, 'settlement.english_name');
  text(settlement.description, 'settlement.description');
  text(settlement.narrative_anchor, 'settlement.narrative_anchor');
  stringArray(settlement.tone, 'settlement.tone');
  stringArray(settlement.rules, 'settlement.rules');
  const locations = validateLocations(readJson('morrowmere/locations.json'), DEFAULT_WORLD_LOCATIONS, settlementId, settingId);
  const locationIds = new Set(locations.map(location => location.location_id));
  const npcs = validateNpcs(readJson('morrowmere/npcs.json'), locationIds, settlementId);
  const npcIds = new Set(npcs.map(npc => npc.npc_id));
  const schedules = validateSchedules(readJson('morrowmere/schedules.json'), npcIds, locationIds, settlementId);
  const stories = validateStories(readJson('morrowmere/stories.json'), npcIds, locationIds, settlementId);
  const lore = validateLore(readJson('morrowmere/lore.json'), settlementId);
  const worldEvents = validateWorldEvents(readJson('morrowmere/world-events.json'), settlementId);
  cached = {
    schema: 'deskbot.compiled-content-package.v0.1',
    source: 'world-content/settlements/morrowmere',
    settlement: clone(settlement),
    locations,
    npcs,
    schedules,
    stories,
    lore,
    worldEvents,
  };
  return clone(cached);
}

export function listContentPackages() {
  const packageData = loadMorrowmereContent();
  return [{
    id: packageData.settlement.settlement_id,
    display_name: packageData.settlement.display_name,
    setting_id: packageData.settlement.setting_id,
    source: packageData.source,
    schema: packageData.schema,
  }];
}

export function getContentRootPath() {
  return fileURLToPath(CONTENT_ROOT);
}
