import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthoredWorldEventCatalog } from '../src/authored-world-events.mjs';
import { loadMorrowmereContent } from '../src/content-packages.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldCandidateStore } from '../src/world-candidates.mjs';

const catalog = createAuthoredWorldEventCatalog();
const event = (overrides = {}) => ({
  schema: 'foundry.event.v0.1', event_id: 'news-lamp-001', type: 'news.observation', source: 'untrusted_observation',
  occurred_at: '2026-10-14T08:00:00.000Z', observed_at: '2026-10-14T08:01:00.000Z', confidence: 0.9,
  payload: { title: '雾灯偏向湿地岔口', summary: '昨晚多盏灯把光投向同一个岔口。', tags: ['雾灯', '岔口'] }, ...overrides,
});

test('authored world event package is content-driven and bounded', () => {
  const packageList = catalog.list();
  assert.equal(packageList.length, 1);
  assert.equal(packageList[0].package_id, 'morrowmere-lamp-drift-event-v1');
  assert.equal(loadMorrowmereContent().worldEvents.packages.length, 1);
  const prepared = catalog.prepare(packageList[0].package_id, event());
  assert.equal(prepared.accepted, true);
  assert.equal(prepared.candidate_event.provenance.authored_package_id, packageList[0].package_id);
  assert.deepEqual(prepared.candidate_event.payload.proposed_actions.map(item => item.action), ['apply_world_line_event']);
  const worldEvent = prepared.candidate_event.payload.proposed_actions[0].payload.event;
  assert.equal(worldEvent.source, 'authored-world-event-package');
  assert.equal(worldEvent.title, '雾灯开始向同一条路偏移');
});

test('authored package rejects unqualified observations without creating a mutation', () => {
  const noTag = catalog.prepare('morrowmere-lamp-drift-event-v1', event({ payload: { summary: '普通交通消息' } }));
  assert.equal(noTag.accepted, false);
  assert.equal(noTag.reason, 'required_tag_missing');
  const lowConfidence = catalog.prepare('morrowmere-lamp-drift-event-v1', event({ confidence: 0.1 }));
  assert.equal(lowConfidence.accepted, false);
  assert.equal(lowConfidence.reason, 'confidence_below_threshold');
  assert.equal(catalog.prepare('unknown-v1', event()).accepted, false);
});

test('evaluation exposes rejected package reasons for audit without writing world state', () => {
  const evaluation = catalog.evaluate(event({ type: 'external.context' }));
  assert.equal(evaluation.matches.length, 0);
  assert.equal(evaluation.rejected[0].reason, 'observation_type_not_allowed');
  assert.equal(evaluation.rule_version, 'authored-world-events.v1');
});

test('prepared authored event enters the existing candidate bridge and canonical ingest only on accept', () => {
  const world = createPersistentWorld({ now: () => new Date('2026-10-14T08:00:00.000Z') });
  const candidates = createWorldCandidateStore({
    now: () => new Date('2026-10-14T08:00:00.000Z'),
    worldSnapshot: () => world.get(),
    ingest: event => world.ingest(event),
    listMutations: options => world.listMutations(options),
  });
  const prepared = catalog.prepare('morrowmere-lamp-drift-event-v1', event());
  const pending = candidates.observe(prepared.candidate_event);
  assert.equal(pending.candidate.status, 'pending');
  const before = world.get();
  const preview = candidates.preview(pending.candidate.candidate_id);
  assert.equal(world.get().world_revision, before.world_revision);
  assert.equal(preview.preview.projected_world_revision, before.world_revision + 1);
  const accepted = candidates.accept(pending.candidate.candidate_id, { expectedWorldRevision: before.world_revision });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.world_mutations.length, 1);
  assert.equal(accepted.world_mutations[0].mutation.action, 'apply_world_line_event');
  assert.equal(world.get().world_revision, before.world_revision + 1);
  assert.equal(world.get().world_line.latest_event.content_package_id, 'morrowmere-lamp-drift-event-v1');
  const repeated = candidates.accept(pending.candidate.candidate_id);
  assert.equal(repeated.duplicate, true);
  assert.equal(world.get().world_revision, before.world_revision + 1);
});
