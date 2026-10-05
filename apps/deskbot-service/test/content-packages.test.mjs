import test from 'node:test';
import assert from 'node:assert/strict';

import { listContentPackages, loadMorrowmereContent } from '../src/content-packages.mjs';
import { DEFAULT_SETTLEMENT } from '../src/world-definition.mjs';
import { listStoryPackages, previewStoryPackage, installStoryPackage } from '../src/story-packages.mjs';

test('Morrowmere compiler returns one canonical, auditable content package', () => {
  const compiled = loadMorrowmereContent();
  assert.equal(compiled.schema, 'deskbot.compiled-content-package.v0.1');
  assert.equal(compiled.settlement.settlement_id, DEFAULT_SETTLEMENT.settlement_id);
  assert.equal(compiled.locations.length, 10);
  assert.equal(compiled.npcs.length, 3);
  assert.equal(compiled.schedules.schedules.length, 3);
  assert.equal(compiled.stories.story_packages[0].id, 'morrowmere-first-day-v1');
  assert.equal(listContentPackages()[0].id, DEFAULT_SETTLEMENT.settlement_id);
  assert.equal(listContentPackages()[0].source, 'world-content/settlements/morrowmere');
});

test('Morrowmere first-day story is content-driven and produces a finite canonical plan', () => {
  const pack = listStoryPackages().find(item => item.id === 'morrowmere-first-day-v1');
  assert.ok(pack);
  assert.equal(pack.source, 'world-content/settlements/morrowmere');
  assert.equal(pack.settlement_id, 'morrowmere');
  assert.deepEqual(pack.step_offsets_hours, [0, 3, 8]);
  assert.ok(pack.step_offsets_hours.at(-1) < 24, 'first-day replay should finish within one in-world day');
  const now = new Date('2026-09-25T00:00:00.000Z');
  const preview = previewStoryPackage(pack.id, { now, plans: [], world: { world_revision: 2 } });
  assert.equal(preview.installable, true);
  assert.equal(preview.steps.length, 3);
  let scheduled;
  const result = installStoryPackage(pack.id, {
    now,
    plans: [],
    world: { world_revision: 2, locations: [] },
    schedule: plan => { scheduled = plan; return plan; },
  });
  assert.equal(result.source, 'world-content/settlements/morrowmere');
  assert.equal(scheduled.steps.length, 5);
  assert.deepEqual(scheduled.steps.map(step => step.payload.action), [
    'apply_world_line_event', 'upsert_npc', 'npc_action', 'apply_world_line_event', 'apply_world_line_event',
  ]);
  assert.equal(scheduled.steps[0].payload.event.event_id, 'morrowmere-first-day-v1:lamp-heard');
  assert.equal(scheduled.steps[2].payload.action_name, 'bring_corner_map');
  assert.equal(scheduled.steps[1].payload.npc.location_id, 'shaping-field-desk');
  assert.equal(scheduled.steps[2].payload.location_id, 'shaping-field-desk');
});
