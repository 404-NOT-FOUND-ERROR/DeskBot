import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { DEFAULT_SETTLEMENT, DEFAULT_WORLD_LOCATIONS } from '../src/world-definition.mjs';

const contentRoot = new URL('../../../world-content/settlements/morrowmere/', import.meta.url);

async function readJson(name) {
  return JSON.parse(await readFile(new URL(name, contentRoot), 'utf8'));
}

test('Morrowmere content contract stays attached to the canonical settlement', async () => {
  const [settlement, locations, npcs, schedules, stories, lore, worldEvents] = await Promise.all([
    readJson('settlement.json'),
    readJson('locations.json'),
    readJson('npcs.json'),
    readJson('schedules.json'),
    readJson('stories.json'),
    readJson('lore.json'),
    readJson('world-events.json'),
  ]);

  assert.equal(settlement.settlement_id, DEFAULT_SETTLEMENT.settlement_id);
  assert.equal(settlement.display_name, DEFAULT_SETTLEMENT.display_name);
  assert.equal(settlement.english_name, DEFAULT_SETTLEMENT.english_name);
  assert.equal(settlement.setting_id, DEFAULT_SETTLEMENT.setting_id);
  for (const packagePart of [locations, npcs, schedules, stories, lore, worldEvents]) {
    assert.equal(packagePart.settlement_id, DEFAULT_SETTLEMENT.settlement_id);
  }

  const canonicalIds = new Set(DEFAULT_WORLD_LOCATIONS.map((location) => location.location_id));
  assert.deepEqual(
    locations.locations.map((location) => location.location_id).sort(),
    [...canonicalIds].sort(),
  );
  for (const location of locations.locations) {
    const canonical = DEFAULT_WORLD_LOCATIONS.find((item) => item.location_id === location.location_id);
    assert.equal(location.region_id, canonical.region_id);
    assert.equal(location.location_kind, canonical.location_kind);
    assert.equal(location.world_role, canonical.world_role);
    assert.deepEqual(location.lore_keys, canonical.lore_keys);
  }

  assert.equal(npcs.npc_model, 'neva-mind-structured-agent-v0.1');
  assert.ok(npcs.fields.includes('identity'));
  assert.ok(npcs.fields.includes('desire'));
  assert.ok(npcs.fields.includes('schedule'));
  assert.ok(npcs.fields.includes('conditions'));
  assert.ok(npcs.fields.includes('legal_actions'));
  assert.equal(npcs.npcs.length, schedules.schedules.length);
  assert.equal(stories.starter_arc.arc_id, 'morrowmere-first-days-v1');
  assert.equal(worldEvents.events[0].status, 'template');
  assert.match(worldEvents.ingestion_boundary, /evidence/);
});
