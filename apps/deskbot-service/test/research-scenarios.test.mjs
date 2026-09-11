import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import {
  getResearchScenarioCatalog,
  runResearchScenario,
} from '../src/research-scenarios.mjs';

test('catalog fixes five independent multisource scenarios and the L1b draft contract', () => {
  const catalog = getResearchScenarioCatalog();
  assert.equal(catalog.execution_mode, 'isolated_in_memory');
  assert.deepEqual(
    catalog.scenarios.map((scenario) => scenario.dominant_layer),
    ['world_line', 'external_context', 'weather', 'user_profile', 'device_context'],
  );
  assert.equal(new Set(catalog.scenarios.map((scenario) => scenario.scenario_id)).size, 5);
  assert.equal(catalog.l1b_probe_contract.schema, 'foundry.l1b-probe-record.v0.1');
  assert.ok(catalog.input_domains.external_context.includes('news'));
  assert.ok(catalog.input_domains.external_context.includes('major_event'));
});

test('every scenario is deterministic, isolated, attributable and does not fabricate L1b distance', () => {
  for (const scenario of getResearchScenarioCatalog().scenarios) {
    const first = runResearchScenario(scenario.scenario_id);
    const second = runResearchScenario(scenario.scenario_id);
    assert.deepEqual(second, first);
    assert.equal(first.execution.mutates_live_world, false);
    assert.equal(first.revisions.before, 0);
    assert.equal(first.validation.passed, true);
    assert.ok(first.revisions.after >= 1);
    assert.ok(first.steps.every((step) => step.input_layer === scenario.dominant_layer));
    assert.ok(first.steps.every((step) => step.changed_field_paths.length > 0));
    assert.equal(first.l1b_probe.profile.vector, null);
    assert.equal(first.l1b_probe.attribution.total_profile_distance, null);
    assert.ok(first.l1b_probe.attribution.event_contributions.every((item) => item.contribution_share === null));
  }
});

test('preference scenario needs all three consistent observations before stable=true', () => {
  const report = runResearchScenario('user-interest-night-sky');
  assert.equal(report.steps.length, 3);
  assert.equal(report.revisions.after, 3);
  assert.equal(report.final_projection.user_profile.preferences['interests.night_sky'].observations, 3);
  assert.equal(report.final_projection.user_profile.preferences['interests.night_sky'].stable, true);
});

test('research scenario HTTP endpoints expose catalog and isolated report', async (t) => {
  const server = createDeskBotServer({ websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const catalogResponse = await fetch(`${origin}/api/research/scenarios`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.scenarios.length, 5);

  const runResponse = await fetch(`${origin}/api/research/scenarios/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario_id: 'weather-rain-arrival' }),
  });
  assert.equal(runResponse.status, 200);
  const report = await runResponse.json();
  assert.equal(report.validation.passed, true);
  assert.equal(report.scenario.dominant_layer, 'weather');

  const liveWorldResponse = await fetch(`${origin}/api/world`);
  const liveWorld = await liveWorldResponse.json();
  assert.equal(liveWorld.world.world_revision, 0);
  assert.equal(liveWorld.world.weather.snapshot, null);
});
