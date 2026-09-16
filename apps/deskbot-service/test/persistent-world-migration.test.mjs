import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPersistentWorld } from '../src/persistent-world.mjs';

const fixedTime = new Date('2026-09-02T00:00:00.000Z');

function createMemoryPersistence(seedWorld) {
  const records = new Map([
    ['canonical-world.states', new Map([[seedWorld.world_id, structuredClone(seedWorld)]])],
  ]);

  return {
    get(namespace, recordId) {
      const value = records.get(namespace)?.get(recordId);
      return value ? structuredClone(value) : null;
    },
    list(namespace) {
      return [...(records.get(namespace)?.values() ?? [])].map((value) => structuredClone(value));
    },
    put(namespace, recordId, value) {
      if (!records.has(namespace)) records.set(namespace, new Map());
      records.get(namespace).set(recordId, structuredClone(value));
      return value;
    },
  };
}

test('legacy world snapshot migrates to 聚形域 without losing its accumulated history', () => {
  const legacyWorld = {
    schema: 'foundry.canonical-world.v0.1',
    world_id: 'deskbot-small-world',
    name: 'legacy-deskbot-world',
    world_revision: 9,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T01:00:00.000Z',
    logical_time: {
      schema: 'foundry.logical-time.v0.1',
      day: 3,
      minute_of_day: 615,
      tick: 9,
    },
    protagonist: {
      character_id: 'ember-001',
      display_name: 'Ember',
      location_id: 'workshop-desk',
      appearance: {
        schema: 'deskbot.character-appearance.v0.2',
        version: 'appearance-baseline-v0.2',
        state: 'baseline',
        model_label: '喵伴出厂造型',
        generation_layer: { status: 'awaiting_measurement', accessories: [] },
      },
    },
    locations: [{
      location_id: 'workshop-desk',
      name: 'legacy-location',
      description: 'legacy-description',
    }],
    npcs: [],
    active_event: null,
    pending_items: [],
    interaction: {
      user_turn_count: 9,
      last_user_event_id: 'legacy-turn-009',
      last_correlation_id: 'legacy-turn-009',
    },
  };
  const persistence = createMemoryPersistence(legacyWorld);
  const persistentWorld = createPersistentWorld({ now: () => fixedTime, persistence });
  const migrated = persistentWorld.get();

  assert.equal(migrated.name, '聚形域');
  assert.equal(migrated.setting.setting_id, 'shaping-field-v2.1');
  assert.equal(migrated.protagonist.character_id, 'shaping-001');
  assert.equal(migrated.protagonist.display_name, '喵呜');
  assert.equal(migrated.protagonist.display_name_status, 'active_role_stage');
  assert.equal(migrated.protagonist.location_id, 'shaping-field-desk');
  assert.equal(migrated.protagonist.appearance.version, 'appearance-baseline-v0.2');
  assert.equal(migrated.protagonist.appearance.state, 'baseline');
  assert.equal(migrated.protagonist.appearance.model_label, '喵呜猫型第一形态');
  assert.equal(migrated.protagonist.character_profile.version, 'miaowu-expression-v3');
  assert.equal(migrated.protagonist.character_profile.continuity_identity.identity_id, 'shaping-001');
  assert.equal(migrated.protagonist.character_profile.current_role.display_name, '喵呜');
  assert.equal(migrated.protagonist.character_profile.current_form.form_id, 'cat-toy-baseline-v1');
  assert.equal(migrated.protagonist.character_profile.roleplay_contract.version, 'miaowu-roleplay-v2');
  assert.deepEqual(migrated.protagonist.character_id_aliases, ['ember-001']);
  assert.deepEqual(migrated.locations[0].location_id_aliases, ['workshop-desk']);
  assert.equal(migrated.shaping_field.measurement_status, 'unmeasured');
  assert.equal(migrated.world_revision, 9);
  assert.equal(migrated.logical_time.tick, 9);
  assert.equal(migrated.interaction.user_turn_count, 9);
  assert.equal(migrated.setting_migration.to, 'shaping-field-v2.1');

  const stored = persistence.get('canonical-world.states', 'deskbot-small-world');
  assert.equal(stored.protagonist.character_id, 'shaping-001');
  assert.equal(stored.interaction.last_user_event_id, 'legacy-turn-009');
});
